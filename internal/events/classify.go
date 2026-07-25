package events

import (
	"encoding/json"
	"sort"
)

// addressAttributeKeys are the CometBFT composite-event keys that carry a bech32
// account address involved in a tx. The frontend filters chain:tx by the active
// account against the union of these. Mirrors the web listener, which subscribes
// on transfer.recipient/transfer.sender; we also include the message sender and
// the bank coin_received/coin_spent attributes so a balance change is never
// missed (ticket: "message sender + transfer recipient attributes").
var addressAttributeKeys = []string{
	"transfer.recipient",
	"transfer.sender",
	"message.sender",
	"coin_received.receiver",
	"coin_spent.spender",
}

// Classifier turns a decoded subscription message into zero or more Events.
type Classifier func(msg *rpcMessage) []Event

// Registry holds classifiers, run in registration order. The core registers the
// block and tx classifiers; later milestones call Register to add typed ones
// (order-executed, burn, raffle, epoch) without modifying the core.
type Registry struct {
	classifiers []Classifier
}

// NewRegistry returns a registry preloaded with the core block + tx classifiers.
func NewRegistry() *Registry {
	r := &Registry{}
	r.Register(classifyBlock)
	r.Register(classifyTx)
	return r
}

// Register appends a classifier. Not safe for concurrent use with Classify;
// register everything before the stream starts.
func (r *Registry) Register(c Classifier) {
	r.classifiers = append(r.classifiers, c)
}

// Classify runs every classifier and concatenates their events.
func (r *Registry) Classify(msg *rpcMessage) []Event {
	var out []Event
	for _, c := range r.classifiers {
		out = append(out, c(msg)...)
	}
	return out
}

// classifyBlock emits chain:block for a NewBlock message, carrying the height.
func classifyBlock(msg *rpcMessage) []Event {
	if msg.Result.Data.Type != typeNewBlock {
		return nil
	}
	return []Event{{
		Name: BlockEvent,
		Data: map[string]interface{}{"height": blockHeight(msg.Result.Data.Value)},
	}}
}

// classifyTx emits chain:tx for a Tx message, carrying the height and the set of
// account addresses the tx touched (deduped, sorted for deterministic payloads).
func classifyTx(msg *rpcMessage) []Event {
	if msg.Result.Data.Type != typeTx {
		return nil
	}
	height := ""
	if h := msg.Result.Events["tx.height"]; len(h) > 0 {
		height = h[0]
	}
	return []Event{{
		Name: TxEvent,
		Data: map[string]interface{}{
			"height":    height,
			"addresses": extractAddresses(msg.Result.Events),
		},
	}}
}

// blockHeight pulls block.header.height out of a NewBlock data value.
func blockHeight(value json.RawMessage) string {
	var v struct {
		Block struct {
			Header struct {
				Height string `json:"height"`
			} `json:"header"`
		} `json:"block"`
	}
	if err := json.Unmarshal(value, &v); err != nil {
		return ""
	}
	return v.Block.Header.Height
}

// extractAddresses collects the deduped, sorted set of account addresses from the
// address-bearing composite-event keys.
func extractAddresses(events map[string][]string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, key := range addressAttributeKeys {
		for _, v := range events[key] {
			if v == "" || seen[v] {
				continue
			}
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Strings(out)
	return out
}
