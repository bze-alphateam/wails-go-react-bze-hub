package node

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/logging"
	"github.com/bze-alphateam/bze-hub/internal/state"
)

// HealthConfig holds configurable parameters for the health monitor.
type HealthConfig struct {
	FastIntervalSec      int // How often to poll local /status (default: 5)
	SlowIntervalSec      int // How often to cross-check + re-sync check (default: 3600)
	MaxBlockAgeSec       int // Max block age before considering node out of sync (default: 18)
	ResyncBlockThreshold int // Block range triggering re-sync (default: 28800)
	CrossCheckDelta      int // Max blocks behind public before flagging (default: 2)
}

// LocalNodeStatus holds parsed data from the local node's /status endpoint.
type LocalNodeStatus struct {
	CatchingUp          bool
	LatestBlockHeight   int64
	EarliestBlockHeight int64
	LatestBlockTime     time.Time
}

// HealthMonitor monitors the local node and updates AppState.
type HealthMonitor struct {
	appState    *state.AppState
	nodeProcess *NodeProcess
	cfg         HealthConfig
	remoteCfg   *RemoteConfig
	ports       PortSet

	// For re-sync callback
	onResyncNeeded func()
	// For force re-init callback (stalled on public too long)
	onForceReInit func()

	// Tracks how long we've been on public endpoints
	publicSince time.Time
}

// NewHealthMonitor creates a health monitor.
func NewHealthMonitor(
	appState *state.AppState,
	nodeProcess *NodeProcess,
	cfg HealthConfig,
	remoteCfg *RemoteConfig,
	ports PortSet,
	onResyncNeeded func(),
	onForceReInit func(),
) *HealthMonitor {
	return &HealthMonitor{
		appState:       appState,
		nodeProcess:    nodeProcess,
		cfg:            cfg,
		remoteCfg:      remoteCfg,
		ports:          ports,
		onForceReInit:  onForceReInit,
		publicSince:    time.Now(),
		onResyncNeeded: onResyncNeeded,
	}
}

// FastLoop polls the local node every few seconds and updates AppState.
// Run this in a goroutine via RoutineManager.
func (hm *HealthMonitor) FastLoop(ctx context.Context) {
	interval := time.Duration(hm.cfg.FastIntervalSec) * time.Second
	if interval <= 0 {
		interval = 5 * time.Second
	}

	logging.Info("health", "fast loop started (interval: %s)", interval)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logging.Info("health", "fast loop stopped")
			return
		case <-ticker.C:
			hm.appState.RecordHealthFastHeartbeat()
			hm.fastCheck()
		}
	}
}

// SlowLoop runs periodic cross-checks and re-sync evaluation.
// Run this in a goroutine via RoutineManager.
func (hm *HealthMonitor) SlowLoop(ctx context.Context) {
	interval := time.Duration(hm.cfg.SlowIntervalSec) * time.Second
	if interval <= 0 {
		interval = time.Hour
	}

	logging.Info("health", "slow loop started (interval: %s)", interval)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logging.Info("health", "slow loop stopped")
			return
		case <-ticker.C:
			hm.slowCheck()
		}
	}
}

// --- Fast check (every 5s) ---

func (hm *HealthMonitor) fastCheck() {
	logging.Debug("health", "fast check tick (proxy: %s, status: %s)", hm.appState.GetProxyTarget(), hm.appState.GetNodeStatus())

	if !hm.nodeProcess.IsRunning() {
		// Even if our process tracker says not running, try polling anyway
		// The node might be running from a previous session
		status, err := hm.pollLocalStatus()
		if err != nil {
			logging.Debug("health", "fast check: node not running and not reachable")
			return // Truly not running
		}
		// Node is responding even though we don't track the process — update state
		logging.Debug("health", "fast check: node responding without tracked process (height: %d, catching_up: %v)", status.LatestBlockHeight, status.CatchingUp)
		hm.updateFromStatus(status)
		return
	}

	status, err := hm.pollLocalStatus()
	if err != nil {
		logging.Debug("health", "fast check: node running but not reachable: %v", err)
		// Node not reachable — might be starting up
		currentState := hm.appState.GetNodeStatus()
		if currentState != state.NodeStopped && currentState != state.NodeResyncing && currentState != state.NodeStarting {
			hm.appState.SetNodeStatus(state.NodeError)
			hm.appState.SetProxyTarget("public")
			hm.checkPublicStallWatchdog()
		}
		return
	}

	logging.Debug("health", "fast check: height=%d catching_up=%v block_age=%.1fs",
		status.LatestBlockHeight, status.CatchingUp, time.Since(status.LatestBlockTime).Seconds())
	hm.updateFromStatus(status)
}

func (hm *HealthMonitor) updateFromStatus(status *LocalNodeStatus) {
	prevStatus := hm.appState.GetNodeStatus()

	// Update height
	hm.appState.SetNodeHeight(status.LatestBlockHeight)

	if status.CatchingUp {
		if prevStatus != state.NodeSyncing {
			logging.Info("health", "node is catching up (height: %d) — proxy using public", status.LatestBlockHeight)
		}
		hm.appState.SetNodeStatus(state.NodeSyncing)
		hm.appState.SetProxyTarget("public")
		hm.checkPublicStallWatchdog()
		return
	}

	// Check block freshness
	blockAge := time.Since(status.LatestBlockTime)
	maxAge := time.Duration(hm.cfg.MaxBlockAgeSec) * time.Second
	if maxAge <= 0 {
		maxAge = 18 * time.Second
	}

	if blockAge > maxAge {
		if prevStatus != state.NodeSyncing {
			logging.Info("health", "node block stale (age: %.1fs, threshold: %.1fs, height: %d) — proxy using public",
				blockAge.Seconds(), maxAge.Seconds(), status.LatestBlockHeight)
		}
		hm.appState.SetNodeStatus(state.NodeSyncing)
		hm.appState.SetProxyTarget("public")
		hm.checkPublicStallWatchdog()
		return
	}

	// Node is synced and fresh
	if prevStatus != state.NodeSynced {
		logging.Info("health", "node synced — switching proxy to local (height: %d, block age: %.1fs)",
			status.LatestBlockHeight, blockAge.Seconds())
	}
	hm.appState.SetNodeStatus(state.NodeSynced)
	hm.appState.SetProxyTarget("local")
	// Reset public watchdog — we're on local now
	hm.publicSince = time.Time{}
	// Clear any lingering "Node syncing..." work text
	if hm.appState.GetCurrentWork() != "" {
		hm.appState.SetCurrentWork("")
	}
}

const (
	publicStallTimeout   = 10 * time.Minute
	statusStallTimeout   = 10 * time.Minute
	heartbeatDeadTimeout = 3 * time.Minute  // If a routine hasn't heartbeated in 3x the fast interval
	workStallTimeout     = 10 * time.Minute // If currentWork hasn't changed in 10 min
)

// checkPublicStallWatchdog is the top-level safety net.
// It assumes everything can fail and checks multiple signals:
// 1. Have we been on public endpoints too long?
// 2. Has the node status been stuck for too long?
// 3. Has currentWork been stuck (download/init stalled)?
// 4. Are the doctor/health routines still alive (heartbeats)?
func (hm *HealthMonitor) checkPublicStallWatchdog() {
	if hm.publicSince.IsZero() {
		hm.publicSince = time.Now()
	}

	// Don't trigger if already resyncing or reinitializing
	currentState := hm.appState.GetNodeStatus()
	if currentState == state.NodeResyncing || currentState == state.NodeStopped {
		return
	}

	// Check if currentWork is stuck (e.g., "Downloading..." for 10+ minutes)
	workAge := hm.appState.CurrentWorkAge()
	if workAge > workStallTimeout {
		logging.Info("watchdog", "currentWork stuck for %.0f min ('%s') — triggering force re-init",
			workAge.Minutes(), hm.appState.GetCurrentWork())
		hm.triggerForceReInit()
		return
	}

	// Don't check further if there's active work happening
	if hm.appState.GetCurrentWork() != "" {
		return
	}

	// Check if node status hasn't changed for too long while not synced
	statusAge := hm.appState.NodeStatusAge()
	if currentState != state.NodeSynced && statusAge > statusStallTimeout {
		logging.Info("watchdog", "node stuck in '%s' for %.0f min — triggering force re-init",
			currentState, statusAge.Minutes())
		hm.triggerForceReInit()
		return
	}

	// Check if we've been on public endpoints too long
	stalled := time.Since(hm.publicSince)
	if stalled > publicStallTimeout {
		logging.Info("watchdog", "stuck on public endpoints for %.0f min — triggering force re-init", stalled.Minutes())
		hm.triggerForceReInit()
		return
	}

	// Check doctor heartbeat — is the doctor routine alive?
	doctorAge := hm.appState.DoctorHeartbeatAge()
	if doctorAge > heartbeatDeadTimeout {
		logging.Info("watchdog", "doctor heartbeat stale (%.0fs ago) — routines may be dead, triggering force re-init",
			doctorAge.Seconds())
		hm.triggerForceReInit()
		return
	}

	logging.Debug("watchdog", "checks OK: public=%.0fs, status=%s (%.0fs), doctor heartbeat=%.0fs ago",
		stalled.Seconds(), currentState, statusAge.Seconds(), doctorAge.Seconds())
}

func (hm *HealthMonitor) triggerForceReInit() {
	hm.publicSince = time.Now() // Reset to avoid rapid re-triggers
	if hm.onForceReInit != nil {
		hm.onForceReInit()
	}
}

// --- Slow check (every hour) ---

func (hm *HealthMonitor) slowCheck() {
	logging.Debug("health", "slow check running")

	if !hm.nodeProcess.IsRunning() {
		logging.Debug("health", "slow check: node not running, skipping")
		return
	}

	currentState := hm.appState.GetNodeStatus()
	if currentState == state.NodeStopped || currentState == state.NodeResyncing || currentState == state.NodeStarting {
		logging.Debug("health", "slow check: node in state %s, skipping", currentState)
		return
	}

	status, err := hm.pollLocalStatus()
	if err != nil {
		logging.Debug("health", "slow check: failed to poll local status: %v", err)
		return
	}

	logging.Debug("health", "slow check: height=%d earliest=%d range=%d",
		status.LatestBlockHeight, status.EarliestBlockHeight, status.LatestBlockHeight-status.EarliestBlockHeight)

	// 1. Cross-check against public endpoints
	hm.crossCheck(status)

	// 2. Check if re-sync is needed based on block range
	threshold := int64(hm.cfg.ResyncBlockThreshold)
	if threshold <= 0 {
		threshold = 28800
	}

	blockRange := status.LatestBlockHeight - status.EarliestBlockHeight
	if blockRange > threshold {
		logging.Info("health", "block range %d exceeds threshold %d — triggering re-sync", blockRange, threshold)
		if hm.onResyncNeeded != nil {
			hm.onResyncNeeded()
		}
		return
	}

	// 3. Update target height from public RPC
	if len(hm.remoteCfg.StateSyncRPCServers) > 0 {
		rpcURL := cleanRPCURL(hm.remoteCfg.StateSyncRPCServers[0])
		pubHeight, err := getLatestBlockHeight(rpcURL)
		if err == nil {
			hm.appState.SetNodeTargetHeight(pubHeight)
			logging.Debug("health", "public chain height: %d (local: %d)", pubHeight, status.LatestBlockHeight)
		}
	}

	logging.Debug("health", "slow check complete")
}

func (hm *HealthMonitor) crossCheck(local *LocalNodeStatus) {
	delta := int64(hm.cfg.CrossCheckDelta)
	if delta <= 0 {
		delta = 2
	}

	for _, server := range hm.remoteCfg.StateSyncRPCServers {
		rpcURL := cleanRPCURL(server)
		pubHeight, err := getLatestBlockHeight(rpcURL)
		if err != nil {
			logging.Debug("health", "cross-check: %s unreachable: %v", rpcURL, err)
			continue
		}

		behind := pubHeight - local.LatestBlockHeight
		if behind > delta {
			logging.Info("health", "local node is %d blocks behind %s (local: %d, public: %d)",
				behind, rpcURL, local.LatestBlockHeight, pubHeight)
		} else {
			logging.Debug("health", "cross-check OK: %d blocks behind %s (within delta %d)",
				behind, rpcURL, delta)
		}
		return // Only check against one public endpoint
	}
}

// --- Poll local node ---

func (hm *HealthMonitor) pollLocalStatus() (*LocalNodeStatus, error) {
	url := fmt.Sprintf("http://127.0.0.1:%d/status", hm.ports.NodeRPC)
	client := &http.Client{Timeout: 3 * time.Second}

	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Result struct {
			SyncInfo struct {
				CatchingUp          bool   `json:"catching_up"`
				LatestBlockHeight   string `json:"latest_block_height"`
				EarliestBlockHeight string `json:"earliest_block_height"`
				LatestBlockTime     string `json:"latest_block_time"`
			} `json:"sync_info"`
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	si := result.Result.SyncInfo

	var latestHeight, earliestHeight int64
	fmt.Sscanf(si.LatestBlockHeight, "%d", &latestHeight)
	fmt.Sscanf(si.EarliestBlockHeight, "%d", &earliestHeight)

	blockTime, _ := time.Parse(time.RFC3339Nano, si.LatestBlockTime)

	return &LocalNodeStatus{
		CatchingUp:          si.CatchingUp,
		LatestBlockHeight:   latestHeight,
		EarliestBlockHeight: earliestHeight,
		LatestBlockTime:     blockTime,
	}, nil
}

// --- Helpers ---

func cleanRPCURL(server string) string {
	url := strings.TrimSuffix(server, ":443")
	if !strings.HasPrefix(url, "http") {
		url = "https://" + url
	}
	return url
}
