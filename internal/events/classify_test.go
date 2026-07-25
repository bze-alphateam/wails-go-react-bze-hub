package events

import (
	"encoding/json"
	"reflect"
	"testing"
)

func decode(t *testing.T, raw string) *rpcMessage {
	t.Helper()
	var msg rpcMessage
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return &msg
}

func TestClassifyBlock(t *testing.T) {
	raw := `{"jsonrpc":"2.0","id":1,"result":{
		"query":"tm.event='NewBlock'",
		"data":{"type":"tendermint/event/NewBlock","value":{"block":{"header":{"height":"12345"}}}},
		"events":{"tm.event":["NewBlock"]}
	}}`
	evs := NewRegistry().Classify(decode(t, raw))

	if len(evs) != 1 {
		t.Fatalf("got %d events, want 1", len(evs))
	}
	if evs[0].Name != BlockEvent {
		t.Errorf("name = %q, want %q", evs[0].Name, BlockEvent)
	}
	if evs[0].Data["height"] != "12345" {
		t.Errorf("height = %v, want 12345", evs[0].Data["height"])
	}
}

func TestClassifyTxExtractsAddresses(t *testing.T) {
	raw := `{"jsonrpc":"2.0","id":2,"result":{
		"query":"tm.event='Tx'",
		"data":{"type":"tendermint/event/Tx","value":{"TxResult":{"height":"777"}}},
		"events":{
			"tm.event":["Tx"],
			"tx.height":["777"],
			"message.sender":["bze1sender"],
			"transfer.recipient":["bze1recipient"],
			"transfer.sender":["bze1sender"],
			"coin_received.receiver":["bze1recipient"],
			"coin_spent.spender":["bze1sender"]
		}
	}}`
	evs := NewRegistry().Classify(decode(t, raw))

	if len(evs) != 1 || evs[0].Name != TxEvent {
		t.Fatalf("got %+v, want one chain:tx", evs)
	}
	if evs[0].Data["height"] != "777" {
		t.Errorf("height = %v, want 777", evs[0].Data["height"])
	}
	// Deduped across keys and sorted deterministically.
	got := evs[0].Data["addresses"].([]string)
	want := []string{"bze1recipient", "bze1sender"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("addresses = %v, want %v", got, want)
	}
}

func TestClassifyTxNoAddresses(t *testing.T) {
	raw := `{"jsonrpc":"2.0","id":2,"result":{
		"data":{"type":"tendermint/event/Tx","value":{}},
		"events":{"tm.event":["Tx"],"tx.height":["9"]}
	}}`
	evs := NewRegistry().Classify(decode(t, raw))
	if len(evs) != 1 {
		t.Fatalf("got %d, want 1", len(evs))
	}
	if addrs := evs[0].Data["addresses"].([]string); len(addrs) != 0 {
		t.Errorf("addresses = %v, want empty", addrs)
	}
}

func TestClassifyIgnoresAckAndUnknown(t *testing.T) {
	// Empty-result subscription ack.
	if evs := NewRegistry().Classify(decode(t, `{"jsonrpc":"2.0","id":1,"result":{}}`)); len(evs) != 0 {
		t.Errorf("ack produced %d events, want 0", len(evs))
	}
	// Unknown data type.
	raw := `{"result":{"data":{"type":"tendermint/event/ValidatorSetUpdates","value":{}}}}`
	if evs := NewRegistry().Classify(decode(t, raw)); len(evs) != 0 {
		t.Errorf("unknown type produced %d events, want 0", len(evs))
	}
}

// A later-milestone-style custom classifier plugs in without touching the core.
func TestRegistryIsExtensible(t *testing.T) {
	reg := NewRegistry()
	reg.Register(func(msg *rpcMessage) []Event {
		if _, ok := msg.Result.Events["bze.tradebin.OrderExecutedEvent.market_id"]; !ok {
			return nil
		}
		return []Event{{Name: "chain:order-executed", Data: map[string]interface{}{}}}
	})

	raw := `{"result":{
		"data":{"type":"tendermint/event/Tx","value":{}},
		"events":{"tx.height":["5"],"bze.tradebin.OrderExecutedEvent.market_id":["1"]}
	}}`
	evs := reg.Classify(decode(t, raw))

	names := map[string]bool{}
	for _, e := range evs {
		names[e.Name] = true
	}
	if !names[TxEvent] || !names["chain:order-executed"] {
		t.Errorf("expected both core tx and custom event, got %v", names)
	}
}
