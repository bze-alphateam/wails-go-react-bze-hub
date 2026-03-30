package routines

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Manager tracks all background goroutines and provides graceful shutdown.
// Every background goroutine should be launched via Go() so it's tracked.
type Manager struct {
	wg     sync.WaitGroup
	ctx    context.Context
	cancel context.CancelFunc
}

// NewManager creates a new routine manager with a cancellable context.
func NewManager(parent context.Context) *Manager {
	ctx, cancel := context.WithCancel(parent)
	return &Manager{
		ctx:    ctx,
		cancel: cancel,
	}
}

// Context returns the manager's context. Goroutines should check ctx.Done()
// in their loops to know when to exit.
func (m *Manager) Context() context.Context {
	return m.ctx
}

// Go launches a named goroutine and tracks it for graceful shutdown.
// The function receives the manager's context and should exit when ctx.Done() fires.
func (m *Manager) Go(name string, fn func(ctx context.Context)) {
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		fmt.Printf("[routines] started: %s\n", name)
		fn(m.ctx)
		fmt.Printf("[routines] stopped: %s\n", name)
	}()
}

// Shutdown signals all goroutines to stop and waits up to timeout for them to finish.
// Returns true if all goroutines stopped cleanly, false if timed out.
func (m *Manager) Shutdown(timeout time.Duration) bool {
	fmt.Println("[routines] shutdown initiated")
	m.cancel()

	done := make(chan struct{})
	go func() {
		m.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		fmt.Println("[routines] all goroutines stopped cleanly")
		return true
	case <-time.After(timeout):
		fmt.Println("[routines] shutdown timed out — some goroutines may still be running")
		return false
	}
}
