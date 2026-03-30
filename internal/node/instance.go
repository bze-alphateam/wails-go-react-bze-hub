package node

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/config"
)

// Instance holds the state of a running BZE Hub instance.
// Stored in {appdata}/config/instance.json.
type Instance struct {
	PID       int     `json:"pid"`
	StartedAt string  `json:"startedAt"`
	Ports     PortSet `json:"ports"`
}

const instanceFilename = "instance.json"

func instancePath() string {
	return filepath.Join(config.ConfigDir(), instanceFilename)
}

// LoadInstance reads the instance file from disk.
// Returns nil if the file doesn't exist.
func LoadInstance() *Instance {
	data, err := os.ReadFile(instancePath())
	if err != nil {
		return nil
	}
	var inst Instance
	if err := json.Unmarshal(data, &inst); err != nil {
		return nil
	}
	return &inst
}

// SaveInstance writes the current instance state to disk.
func SaveInstance(inst *Instance) error {
	data, err := json.MarshalIndent(inst, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(instancePath(), data, 0600)
}

// RemoveInstance deletes the instance file.
func RemoveInstance() {
	os.Remove(instancePath())
}

// CreateInstance creates a new instance record for this process.
func CreateInstance(ports PortSet) *Instance {
	return &Instance{
		PID:       os.Getpid(),
		StartedAt: time.Now().UTC().Format(time.RFC3339),
		Ports:     ports,
	}
}

// IsProcessAlive checks if a process with the given PID is still running.
func IsProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}

	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}

	// On Unix, FindProcess always succeeds. Send signal 0 to check if alive.
	if runtime.GOOS != "windows" {
		err = process.Signal(syscall.Signal(0))
		return err == nil
	}

	// On Windows, FindProcess fails if the process doesn't exist
	return true
}

// HealthCheckInstance checks if another instance's node and proxies are responsive.
// Returns true if at least the proxy REST endpoint responds.
func HealthCheckInstance(inst *Instance) bool {
	if inst == nil {
		return false
	}

	// Try connecting to the proxy REST port
	addr := fmt.Sprintf("127.0.0.1:%d", inst.Ports.ProxyREST)
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		return false
	}
	conn.Close()

	// Try an actual HTTP request to confirm it's our proxy
	client := &http.Client{Timeout: 3 * time.Second}
	url := fmt.Sprintf("http://127.0.0.1:%d/cosmos/base/tendermint/v1beta1/node_info", inst.Ports.ProxyREST)
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	resp.Body.Close()

	return resp.StatusCode == http.StatusOK
}

// CheckExistingInstance determines what to do based on an existing instance file.
// Returns:
//   - instance, true  → another instance is alive and healthy, use its ports
//   - instance, false → stale instance, take over
//   - nil, false      → no instance file, fresh setup
func CheckExistingInstance() (*Instance, bool) {
	inst := LoadInstance()
	if inst == nil {
		return nil, false
	}

	// Check if the PID is our own process (re-launch after crash without cleanup)
	if inst.PID == os.Getpid() {
		return inst, false // It's us, take over
	}

	// Check if the process is still alive
	if !IsProcessAlive(inst.PID) {
		fmt.Printf("[node] stale instance (PID %d dead), taking over\n", inst.PID)
		return inst, false
	}

	// Process is alive — check if its services are healthy
	if HealthCheckInstance(inst) {
		fmt.Printf("[node] another instance (PID %d) is alive and healthy\n", inst.PID)
		return inst, true // Use existing instance
	}

	// Process alive but services unhealthy — could be starting up. Wait and retry.
	fmt.Printf("[node] instance PID %d alive but unhealthy, waiting...\n", inst.PID)
	time.Sleep(5 * time.Second)

	if HealthCheckInstance(inst) {
		fmt.Printf("[node] instance PID %d now healthy after wait\n", inst.PID)
		return inst, true
	}

	// Still unhealthy — take over
	fmt.Printf("[node] instance PID %d still unhealthy, taking over\n", inst.PID)
	return inst, false
}
