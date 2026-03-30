package node

import (
	"context"
	"fmt"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/logging"
	"github.com/bze-alphateam/bze-hub/internal/state"
)

// Doctor monitors the node process and attempts recovery on unexpected exits.
type Doctor struct {
	appState    *state.AppState
	nodeProcess *NodeProcess
	retryDelays []time.Duration
}

// NewDoctor creates a doctor with configurable retry delays.
func NewDoctor(appState *state.AppState, nodeProcess *NodeProcess, retryDelaysSec []int) *Doctor {
	delays := make([]time.Duration, len(retryDelaysSec))
	for i, sec := range retryDelaysSec {
		delays[i] = time.Duration(sec) * time.Second
	}
	if len(delays) == 0 {
		delays = []time.Duration{5 * time.Second, 30 * time.Second, 2 * time.Minute, 5 * time.Minute}
	}
	return &Doctor{
		appState:    appState,
		nodeProcess: nodeProcess,
		retryDelays: delays,
	}
}

// Watch waits for the node to exit and attempts recovery.
// Run this in a goroutine via RoutineManager. It blocks until ctx is cancelled.
func (d *Doctor) Watch(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		if !d.nodeProcess.IsRunning() {
			// Node isn't running — wait a bit and check again
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
				continue
			}
		}

		// Wait for the node process to exit
		err := d.nodeProcess.WaitForExit()

		// Check if we're shutting down
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Check if the stop was intentional (state is Stopped or Resyncing)
		currentState := d.appState.GetNodeStatus()
		if currentState == state.NodeStopped || currentState == state.NodeResyncing {
			logging.Info("doctor", "node stopped intentionally, not recovering")
			continue
		}

		// Unexpected exit — attempt recovery
		logging.Info("doctor", "node exited unexpectedly: %v", err)
		d.appState.SetNodeStatus(state.NodeError)
		d.appState.SetProxyTarget("public")

		if d.recover(ctx) {
			logging.Info("doctor", "node recovered successfully")
		} else {
			logging.Info("doctor", "all recovery attempts failed — node remains stopped")
			d.appState.SetCurrentWork("Node crashed — manual restart needed")
			time.Sleep(5 * time.Second)
			d.appState.SetCurrentWork("")
		}
	}
}

// recover attempts to restart the node with exponential backoff.
// Returns true if the node was successfully restarted.
func (d *Doctor) recover(ctx context.Context) bool {
	for attempt, delay := range d.retryDelays {
		select {
		case <-ctx.Done():
			return false
		default:
		}

		logging.Info("doctor", "attempt %d/%d — waiting %s before restart", attempt+1, len(d.retryDelays), delay)
		d.appState.SetCurrentWork(fmt.Sprintf("Node recovery attempt %d/%d...", attempt+1, len(d.retryDelays)))

		select {
		case <-ctx.Done():
			return false
		case <-time.After(delay):
		}

		// Try to restart
		if err := d.nodeProcess.Start(); err != nil {
			logging.Info("doctor", "restart attempt %d failed: %v", attempt+1, err)
			continue
		}

		// Wait a bit and check if node stays up
		select {
		case <-ctx.Done():
			return false
		case <-time.After(10 * time.Second):
		}

		if d.nodeProcess.IsRunning() {
			d.appState.SetNodeStatus(state.NodeStarting)
			d.appState.SetCurrentWork("")
			return true
		}

		logging.Info("doctor", "node crashed again after restart attempt %d", attempt+1)
	}

	return false
}
