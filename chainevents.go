package main

import (
	"fmt"

	"github.com/bze-alphateam/bze-hub/internal/events"
	"github.com/bze-alphateam/bze-hub/internal/logging"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// initEventStream starts the chain event stream: a single WebSocket subscription
// to the RPC proxy's /websocket, re-emitting classified NewBlock/Tx activity as
// Wails events ("chain:block", "chain:tx"). It connects to the proxy — not a node
// directly — so local↔public failover and node restarts are handled transparently
// by the proxy and just look like a reconnect here. Idempotent: safe to call from
// either node-setup path once the proxy ports are known.
func (a *App) initEventStream() {
	if a.eventStream != nil {
		return
	}

	wsURL := fmt.Sprintf("ws://127.0.0.1:%d/websocket", a.ports.ProxyRPC)
	a.eventStream = events.NewStream(wsURL, func(name string, data interface{}) {
		wailsRuntime.EventsEmit(a.ctx, name, data)
	}, nil)

	// Runs under the routine manager for clean shutdown; reconnects on its own.
	a.routines.Go("chain-events", a.eventStream.Run)
	logging.Info("events", "chain event stream started (%s)", wsURL)
}
