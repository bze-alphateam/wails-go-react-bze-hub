package proxy

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/bze-alphateam/bze-hub/internal/state"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins (localhost proxy)
	},
}

// WebSocketProxy handles WebSocket connections for the RPC proxy.
// It determines the target (local or public) at connection time and creates
// a bidirectional pipe. On disconnect, the client reconnects and gets a
// fresh routing decision.
type WebSocketProxy struct {
	appState     *state.AppState
	cb           *circuitBreaker
	localWSAddr  string // e.g., "ws://localhost:26657"
	publicWSAddr string // e.g., "wss://rpc.getbze.com"
}

// NewWebSocketProxy creates a WebSocket proxy.
func NewWebSocketProxy(appState *state.AppState, cb *circuitBreaker, localRPCAddr, publicRPCAddr string) *WebSocketProxy {
	// Convert http(s) URLs to ws(s)
	localWS := strings.Replace(localRPCAddr, "http://", "ws://", 1)
	localWS = strings.Replace(localWS, "https://", "wss://", 1)
	publicWS := strings.Replace(publicRPCAddr, "http://", "ws://", 1)
	publicWS = strings.Replace(publicWS, "https://", "wss://", 1)

	return &WebSocketProxy{
		appState:     appState,
		cb:           cb,
		localWSAddr:  localWS,
		publicWSAddr: publicWS,
	}
}

// Handle upgrades an HTTP connection to WebSocket and proxies to the target.
func (wsp *WebSocketProxy) Handle(w http.ResponseWriter, r *http.Request) {
	// Determine target
	useLocal := wsp.appState.GetNodeStatus() == state.NodeSynced && wsp.cb.isLocalSafe()

	var targetAddr string
	if useLocal {
		targetAddr = wsp.localWSAddr + r.URL.Path
	} else {
		targetAddr = wsp.publicWSAddr + r.URL.Path
	}

	fmt.Printf("[proxy] WebSocket connecting to %s\n", targetAddr)

	// Connect to target
	targetConn, _, err := websocket.DefaultDialer.Dial(targetAddr, nil)
	if err != nil {
		fmt.Printf("[proxy] WebSocket target connect failed: %v\n", err)
		if useLocal {
			// Try public as fallback
			wsp.cb.recordFailure(true)
			targetAddr = wsp.publicWSAddr + r.URL.Path
			fmt.Printf("[proxy] WebSocket falling back to %s\n", targetAddr)
			targetConn, _, err = websocket.DefaultDialer.Dial(targetAddr, nil)
			if err != nil {
				http.Error(w, "WebSocket proxy: both targets failed", http.StatusBadGateway)
				return
			}
		} else {
			http.Error(w, "WebSocket proxy: connection failed", http.StatusBadGateway)
			return
		}
	}
	defer targetConn.Close()

	// Upgrade client connection
	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Printf("[proxy] WebSocket upgrade failed: %v\n", err)
		return
	}
	defer clientConn.Close()

	// Bidirectional pipe
	done := make(chan struct{}, 2)

	// Client → Target
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			msgType, msg, err := clientConn.ReadMessage()
			if err != nil {
				if !isWSCloseError(err) {
					fmt.Printf("[proxy] WebSocket client read error: %v\n", err)
				}
				return
			}
			if err := targetConn.WriteMessage(msgType, msg); err != nil {
				return
			}
		}
	}()

	// Target → Client
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			msgType, msg, err := targetConn.ReadMessage()
			if err != nil {
				if !isWSCloseError(err) {
					fmt.Printf("[proxy] WebSocket target read error: %v\n", err)
				}
				return
			}
			if err := clientConn.WriteMessage(msgType, msg); err != nil {
				return
			}
		}
	}()

	// Wait for either side to close
	<-done
}

func isWSCloseError(err error) bool {
	if err == nil {
		return false
	}
	if err == io.EOF {
		return true
	}
	return websocket.IsCloseError(err,
		websocket.CloseNormalClosure,
		websocket.CloseGoingAway,
		websocket.CloseNoStatusReceived,
	)
}
