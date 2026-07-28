package events

import "testing"

// eventNames runs the default registry over a raw frame and returns the set of
// emitted event names plus a map of name→first marketId payload.
func classifyRaw(t *testing.T, raw string) ([]Event, map[string]bool) {
	t.Helper()
	evs := NewRegistry().Classify(decode(t, raw))
	names := map[string]bool{}
	for _, e := range evs {
		names[e.Name] = true
	}
	return evs, names
}

func TestClassifyOrderbookOnOrderSaved(t *testing.T) {
	// A placed order emits OrderSavedEvent → chain:orderbook, not chain:trade.
	raw := `{"result":{
		"data":{"type":"tendermint/event/Tx","value":{}},
		"events":{"tx.height":["7"],"bze.tradebin.OrderSavedEvent.market_id":["\"ubze/uusdc\""]}
	}}`
	evs, names := classifyRaw(t, raw)
	if !names[OrderbookEvent] {
		t.Fatalf("expected %s, got %v", OrderbookEvent, names)
	}
	if names[TradeEvent] {
		t.Fatalf("did not expect %s for a saved order", TradeEvent)
	}
	// payload carries the unquoted market id
	for _, e := range evs {
		if e.Name == OrderbookEvent && e.Data["marketId"] != "ubze/uusdc" {
			t.Fatalf("marketId payload = %v", e.Data["marketId"])
		}
	}
}

func TestClassifyTradeOnOrderExecuted(t *testing.T) {
	// A fill emits OrderExecutedEvent → BOTH chain:trade and chain:orderbook.
	raw := `{"result":{
		"data":{"type":"tendermint/event/Tx","value":{}},
		"events":{"tx.height":["7"],"bze.tradebin.OrderExecutedEvent.market_id":["\"ubze/uusdc\""]}
	}}`
	_, names := classifyRaw(t, raw)
	if !names[TradeEvent] || !names[OrderbookEvent] {
		t.Fatalf("expected both %s and %s, got %v", TradeEvent, OrderbookEvent, names)
	}
}

func TestClassifyCancelCamelCaseMarketId(t *testing.T) {
	// OrderCancelMessageEvent spells the attribute camelCase (marketId).
	raw := `{"result":{
		"data":{"type":"tendermint/event/Tx","value":{}},
		"events":{"tx.height":["7"],"bze.tradebin.OrderCancelMessageEvent.marketId":["\"uatom/ubze\""]}
	}}`
	evs, names := classifyRaw(t, raw)
	if !names[OrderbookEvent] {
		t.Fatalf("expected %s, got %v", OrderbookEvent, names)
	}
	found := false
	for _, e := range evs {
		if e.Name == OrderbookEvent && e.Data["marketId"] == "uatom/ubze" {
			found = true
		}
	}
	if !found {
		t.Fatalf("camelCase marketId not extracted: %+v", evs)
	}
}

func TestClassifyNoTradebinEvents(t *testing.T) {
	// A plain bank transfer must NOT emit orderbook/trade events.
	raw := `{"result":{
		"data":{"type":"tendermint/event/Tx","value":{}},
		"events":{"tx.height":["7"],"transfer.recipient":["bze1abc"]}
	}}`
	_, names := classifyRaw(t, raw)
	if names[OrderbookEvent] || names[TradeEvent] {
		t.Fatalf("unrelated tx should emit no market events, got %v", names)
	}
	if !names[TxEvent] {
		t.Fatalf("core tx event should still fire, got %v", names)
	}
}

func TestClassifyDistinctMarketsOnce(t *testing.T) {
	// Multiple executions on the same market → a single chain:trade for it.
	raw := `{"result":{
		"data":{"type":"tendermint/event/Tx","value":{}},
		"events":{"tx.height":["7"],"bze.tradebin.OrderExecutedEvent.market_id":["\"ubze/uusdc\"","\"ubze/uusdc\"","\"uatom/ubze\""]}
	}}`
	evs, _ := classifyRaw(t, raw)
	trades := 0
	for _, e := range evs {
		if e.Name == TradeEvent {
			trades++
		}
	}
	if trades != 2 {
		t.Fatalf("expected 2 distinct trade events, got %d", trades)
	}
}
