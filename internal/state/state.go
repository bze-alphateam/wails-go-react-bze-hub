package state

import (
	"context"
	"sync"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/logging"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// NodeStatus represents the current state of the local node.
type NodeStatus string

const (
	NodeNotStarted NodeStatus = "not_started"
	NodeStarting   NodeStatus = "starting"
	NodeSyncing    NodeStatus = "syncing"
	NodeSynced     NodeStatus = "synced"
	NodeResyncing  NodeStatus = "resyncing"
	NodeError      NodeStatus = "error"
	NodeStopped    NodeStatus = "stopped"
)

// AppState is the central thread-safe shared state for the entire application.
// All background goroutines read/write through this. State changes emit Wails
// events so the React frontend stays in sync without polling.
type AppState struct {
	mu  sync.RWMutex
	ctx context.Context // Wails app context for event emission

	// Node
	nodeStatus       NodeStatus
	nodeHeight       int64
	nodeTargetHeight int64
	proxyTarget      string // "local" or "public"

	// Status tracking — for watchdog
	nodeStatusChangedAt  time.Time // When the node status last changed
	currentWorkChangedAt time.Time // When currentWork last changed

	// Routine heartbeats — routines write these periodically, watchdog checks them
	doctorHeartbeat     time.Time
	healthFastHeartbeat time.Time

	// Wallet
	activeAddress string
	activeLabel   string

	// Background work
	currentWork string // Human-readable: "Downloading node...", "State syncing...", ""
}

// New creates a new AppState. Call SetContext() once the Wails context is available.
func New() *AppState {
	now := time.Now()
	return &AppState{
		nodeStatus:          NodeNotStarted,
		nodeStatusChangedAt: now,
		proxyTarget:         "public",
	}
}

// SetContext sets the Wails app context used for event emission.
// Must be called during app startup before any state changes.
func (s *AppState) SetContext(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ctx = ctx
}

// --- Node ---

func (s *AppState) GetNodeStatus() NodeStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.nodeStatus
}

func (s *AppState) SetNodeStatus(status NodeStatus) {
	s.mu.Lock()
	prev := s.nodeStatus
	if prev != status {
		s.nodeStatusChangedAt = time.Now()
		logging.Debug("state", "node status: %s → %s", prev, status)
	}
	s.nodeStatus = status
	ctx := s.ctx
	s.mu.Unlock()

	s.emit(ctx, "state:node-changed", s.GetNodeSnapshot())
}

func (s *AppState) GetNodeHeight() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.nodeHeight
}

func (s *AppState) SetNodeHeight(height int64) {
	s.mu.Lock()
	prev := s.nodeHeight
	s.nodeHeight = height
	ctx := s.ctx
	s.mu.Unlock()

	if prev != height {
		logging.Debug("state", "node height: %d → %d", prev, height)
	}

	s.emit(ctx, "state:node-changed", s.GetNodeSnapshot())
}

func (s *AppState) SetNodeTargetHeight(height int64) {
	s.mu.Lock()
	prev := s.nodeTargetHeight
	s.nodeTargetHeight = height
	s.mu.Unlock()

	if prev != height {
		logging.Debug("state", "target height: %d → %d", prev, height)
	}
}

// --- Proxy ---

func (s *AppState) GetProxyTarget() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.proxyTarget
}

func (s *AppState) SetProxyTarget(target string) {
	s.mu.Lock()
	prev := s.proxyTarget
	s.proxyTarget = target
	ctx := s.ctx
	s.mu.Unlock()

	if prev != target {
		logging.Debug("state", "proxy target: %s → %s", prev, target)
	}

	s.emit(ctx, "state:node-changed", s.GetNodeSnapshot())
}

// --- Wallet ---

func (s *AppState) GetActiveAddress() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.activeAddress
}

func (s *AppState) SetActiveAccount(address, label string) {
	s.mu.Lock()
	prev := s.activeAddress
	s.activeAddress = address
	s.activeLabel = label
	ctx := s.ctx
	s.mu.Unlock()

	if prev != address {
		logging.Debug("state", "active account: %s (%s) → %s (%s)", prev, "", address, label)
	}

	s.emit(ctx, "state:account-changed", map[string]string{
		"address": address,
		"label":   label,
	})
}

// --- Background work ---

func (s *AppState) GetCurrentWork() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.currentWork
}

func (s *AppState) SetCurrentWork(work string) {
	s.mu.Lock()
	prev := s.currentWork
	if prev != work {
		s.currentWorkChangedAt = time.Now()
		if work != "" {
			logging.Debug("state", "current work: '%s' → '%s'", prev, work)
		} else {
			logging.Debug("state", "current work cleared (was: '%s')", prev)
		}
	}
	s.currentWork = work
	ctx := s.ctx
	s.mu.Unlock()

	s.emit(ctx, "state:work-changed", work)
}

// --- Status age + heartbeats (for watchdog) ---

// NodeStatusAge returns how long the current node status has been unchanged.
func (s *AppState) NodeStatusAge() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return time.Since(s.nodeStatusChangedAt)
}

// CurrentWorkAge returns how long the current work text has been unchanged.
func (s *AppState) CurrentWorkAge() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.currentWork == "" {
		return 0
	}
	return time.Since(s.currentWorkChangedAt)
}

// RecordDoctorHeartbeat marks the doctor routine as alive.
func (s *AppState) RecordDoctorHeartbeat() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.doctorHeartbeat = time.Now()
}

// DoctorHeartbeatAge returns time since the doctor last checked in.
func (s *AppState) DoctorHeartbeatAge() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.doctorHeartbeat.IsZero() {
		return time.Since(s.nodeStatusChangedAt) // Use start time as proxy
	}
	return time.Since(s.doctorHeartbeat)
}

// RecordHealthFastHeartbeat marks the fast health loop as alive.
func (s *AppState) RecordHealthFastHeartbeat() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.healthFastHeartbeat = time.Now()
}

// HealthFastHeartbeatAge returns time since the fast health loop last checked in.
func (s *AppState) HealthFastHeartbeatAge() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.healthFastHeartbeat.IsZero() {
		return time.Since(s.nodeStatusChangedAt)
	}
	return time.Since(s.healthFastHeartbeat)
}

// --- Snapshots (for frontend) ---

// NodeSnapshot returns a copy of all node-related state for the frontend.
type NodeSnapshot struct {
	Status       string `json:"status"`
	Height       int64  `json:"height"`
	TargetHeight int64  `json:"targetHeight"`
	ProxyTarget  string `json:"proxyTarget"`
	CurrentWork  string `json:"currentWork"`
}

func (s *AppState) GetNodeSnapshot() NodeSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return NodeSnapshot{
		Status:       string(s.nodeStatus),
		Height:       s.nodeHeight,
		TargetHeight: s.nodeTargetHeight,
		ProxyTarget:  s.proxyTarget,
		CurrentWork:  s.currentWork,
	}
}

// --- Internal ---

func (s *AppState) emit(ctx context.Context, event string, data interface{}) {
	if ctx == nil {
		return
	}
	runtime.EventsEmit(ctx, event, data)
}
