package node

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/config"
	"github.com/bze-alphateam/bze-hub/internal/logging"
)

// NodeProcess manages the bzed child process.
type NodeProcess struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	process *os.Process
	running bool
	ports   PortSet
}

// NewNodeProcess creates a new process manager.
func NewNodeProcess(ports PortSet) *NodeProcess {
	return &NodeProcess{ports: ports}
}

// Start launches the bzed node as a child process.
// Returns immediately after the process is started. Use WaitForExit() to detect termination.
func (np *NodeProcess) Start() error {
	np.mu.Lock()
	defer np.mu.Unlock()

	if np.running {
		return fmt.Errorf("node already running")
	}

	binary := BinaryPath()
	home := NodeHome()

	np.cmd = exec.Command(binary, "start", "--home", home)

	// Pipe stdout and stderr to the unified logger with [node] tag
	np.cmd.Stdout = logging.NodeWriter(false)
	np.cmd.Stderr = logging.NodeWriter(true)

	if err := np.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start node: %w", err)
	}

	np.process = np.cmd.Process
	np.running = true

	// Write PID file
	writePIDFile(np.process.Pid)

	fmt.Printf("[node] started (PID %d)\n", np.process.Pid)
	return nil
}

// Stop gracefully stops the node process.
func (np *NodeProcess) Stop() error {
	np.mu.Lock()
	defer np.mu.Unlock()

	if !np.running || np.process == nil {
		return nil
	}

	fmt.Println("[node] stopping...")

	// Send SIGTERM (Unix) or Kill (Windows)
	if runtime.GOOS == "windows" {
		np.process.Kill()
	} else {
		np.process.Signal(syscall.SIGTERM)
	}

	// Wait with timeout
	done := make(chan error, 1)
	go func() {
		if np.cmd != nil {
			done <- np.cmd.Wait()
		} else {
			done <- nil
		}
	}()

	select {
	case <-done:
		fmt.Println("[node] stopped gracefully")
	case <-time.After(30 * time.Second):
		fmt.Println("[node] force killing after 30s timeout")
		np.process.Kill()
	}

	np.running = false
	np.process = nil
	np.cmd = nil
	removePIDFile()

	return nil
}

// WaitForExit blocks until the node process exits. Returns the exit error (nil if clean exit).
// Call this in a goroutine to detect crashes.
func (np *NodeProcess) WaitForExit() error {
	np.mu.Lock()
	cmd := np.cmd
	np.mu.Unlock()

	if cmd == nil {
		return fmt.Errorf("no process to wait for")
	}

	err := cmd.Wait()

	np.mu.Lock()
	np.running = false
	np.process = nil
	np.cmd = nil
	removePIDFile()
	np.mu.Unlock()

	return err
}

// IsRunning returns true if the node process is currently running.
func (np *NodeProcess) IsRunning() bool {
	np.mu.Lock()
	defer np.mu.Unlock()
	return np.running
}

// Restart stops and starts the node.
func (np *NodeProcess) Restart() error {
	if err := np.Stop(); err != nil {
		return fmt.Errorf("stop failed: %w", err)
	}
	time.Sleep(2 * time.Second) // Brief pause between stop and start
	return np.Start()
}

// UnsafeResetAll runs `bzed tendermint unsafe-reset-all --keep-addr-book` to clear state data.
// The node must be stopped first.
func UnsafeResetAll() error {
	binary := BinaryPath()
	home := NodeHome()

	fmt.Println("[node] running unsafe-reset-all...")
	cmd := exec.Command(binary, "tendermint", "unsafe-reset-all", "--home", home, "--keep-addr-book")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("unsafe-reset-all failed: %w\noutput: %s", err, string(output))
	}
	fmt.Println("[node] unsafe-reset-all completed")
	return nil
}

// --- PID file ---

func pidFilePath() string {
	return filepath.Join(config.ConfigDir(), "node.pid")
}

func writePIDFile(pid int) {
	os.WriteFile(pidFilePath(), []byte(strconv.Itoa(pid)), 0600)
}

func removePIDFile() {
	os.Remove(pidFilePath())
}

// CleanupOrphanNode checks for a leftover node process from a previous session.
// Instead of killing it, it adopts it by returning the PID if alive.
// Returns the PID if an orphan was found and is alive, 0 otherwise.
func CleanupOrphanNode() int {
	data, err := os.ReadFile(pidFilePath())
	if err != nil {
		return 0 // No PID file
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		os.Remove(pidFilePath())
		return 0
	}

	if !IsProcessAlive(pid) {
		fmt.Printf("[node] stale PID file (PID %d dead), removing\n", pid)
		os.Remove(pidFilePath())
		return 0
	}

	fmt.Printf("[node] found running node process (PID %d) from previous session\n", pid)
	return pid
}

// KillNodeByPIDFile reads the PID file and kills the node process.
func KillNodeByPIDFile() {
	data, err := os.ReadFile(pidFilePath())
	if err != nil {
		return
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		os.Remove(pidFilePath())
		return
	}
	if IsProcessAlive(pid) {
		KillOrphanNode(pid)
	} else {
		os.Remove(pidFilePath())
	}
}

// KillOrphanNode kills a node process by PID.
func KillOrphanNode(pid int) {
	fmt.Printf("[node] killing orphan node process (PID %d)\n", pid)
	process, err := os.FindProcess(pid)
	if err == nil {
		if runtime.GOOS != "windows" {
			process.Signal(syscall.SIGTERM)
		} else {
			process.Kill()
		}
		time.Sleep(5 * time.Second)
	}
	os.Remove(pidFilePath())
}
