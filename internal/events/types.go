// Package events maintains a single CometBFT WebSocket subscription to the RPC
// proxy and re-emits classified chain activity as Wails events for the frontend.
//
// It is the Go-side equivalent of the web apps' CometBFT WebSocket singleton
// (ui-kit ws_rpc_client + per-app useBlockchainListener): one connection,
// NewBlock + Tx subscriptions, resilient reconnect, and a small classifier
// registry so later milestones can plug in typed events (order-executed, burn,
// raffle, epoch) without touching the core.
package events

import "encoding/json"

// Wails event names re-emitted to the frontend. Later milestones add typed names
// (e.g. "chain:order-executed") via their own classifiers.
const (
	// BlockEvent fires once per new block; payload {height}.
	BlockEvent = "chain:block"
	// TxEvent fires per delivered tx; payload {height, addresses} — the involved
	// account addresses so the frontend can filter for the active wallet.
	TxEvent = "chain:tx"
)

// CometBFT subscription queries. One connection multiplexes both.
const (
	queryNewBlock = "tm.event='NewBlock'"
	queryTx       = "tm.event='Tx'"
)

// Data-type discriminants CometBFT sets on subscription result messages.
const (
	typeNewBlock = "tendermint/event/NewBlock"
	typeTx       = "tendermint/event/Tx"
)

// rpcMessage is a CometBFT JSON-RPC WebSocket frame: either a subscription ack
// (empty result) or an event notification. CometBFT echoes the request id, and
// includes the flattened composite events map used for query matching — that map
// is where indexed attributes like transfer.recipient live (plain UTF-8 strings
// in CometBFT v0.50, no base64).
type rpcMessage struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      int       `json:"id"`
	Result  rpcResult `json:"result"`
	Error   *rpcError `json:"error,omitempty"`
}

type rpcResult struct {
	Query  string              `json:"query"`
	Data   rpcData             `json:"data"`
	Events map[string][]string `json:"events"`
}

type rpcData struct {
	Type  string          `json:"type"`
	Value json.RawMessage `json:"value"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

// Event is a classified chain event ready to re-emit to the frontend.
type Event struct {
	Name string
	Data map[string]interface{}
}
