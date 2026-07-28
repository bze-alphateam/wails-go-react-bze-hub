package main

import (
	"encoding/json"
	"testing"

	"github.com/bze-alphateam/bze-hub/internal/chain"
	"github.com/bze-alphateam/bze-hub/internal/tradebin"
	tradebintypes "github.com/bze-alphateam/bze/x/tradebin/types"
)

const testAddr = "bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk"

// stubRest serves an empty opposite book so BuildOrderMessages produces a single
// limit order — enough to prove the message JSON is signable end to end.
type stubRest struct{}

func (stubRest) RestGet(path string) (map[string]interface{}, error) {
	return map[string]interface{}{"list": []interface{}{}}, nil
}

// TestBuildOrderMessagesDecodeThroughSigningCodec proves the proto-JSON that
// BuildOrderMessages emits resolves to a concrete *MsgCreateOrder through the
// exact path SignAndBroadcast uses — i.e. the map keys/@type are correct and the
// order is signable.
func TestBuildOrderMessagesDecodeThroughSigningCodec(t *testing.T) {
	msgs, err := tradebin.BuildOrderMessages(stubRest{}, "ubze/uusdc", testAddr, true, "1000", "1.5")
	if err != nil {
		t.Fatalf("BuildOrderMessages: %v", err)
	}
	data, err := json.Marshal(msgs)
	if err != nil {
		t.Fatalf("marshal msgs: %v", err)
	}

	c := chain.NewClient("", "", "", nil)
	decoded, err := c.DecodeMsgsJSON(string(data))
	if err != nil {
		t.Fatalf("decode MsgCreateOrder: %v", err)
	}
	if len(decoded) != 1 {
		t.Fatalf("expected 1 msg, got %d", len(decoded))
	}
	order, ok := decoded[0].(*tradebintypes.MsgCreateOrder)
	if !ok {
		t.Fatalf("expected *MsgCreateOrder, got %T", decoded[0])
	}
	if order.Creator != testAddr || order.MarketId != "ubze/uusdc" ||
		order.OrderType != "buy" || order.Amount != "1000" || order.Price != "1.5" {
		t.Fatalf("decoded order wrong: %+v", order)
	}
}

// TestMsgCancelOrderDecodeThroughSigningCodec proves the frontend-built cancel
// message shape (documented in internal/tradebin/orders.go) is signable.
func TestMsgCancelOrderDecodeThroughSigningCodec(t *testing.T) {
	msgsJSON := `[{
		"@type": "/bze.tradebin.MsgCancelOrder",
		"creator": "` + testAddr + `",
		"market_id": "ubze/uusdc",
		"order_id": "42",
		"order_type": "sell"
	}]`

	c := chain.NewClient("", "", "", nil)
	decoded, err := c.DecodeMsgsJSON(msgsJSON)
	if err != nil {
		t.Fatalf("decode MsgCancelOrder: %v", err)
	}
	cancel, ok := decoded[0].(*tradebintypes.MsgCancelOrder)
	if !ok {
		t.Fatalf("expected *MsgCancelOrder, got %T", decoded[0])
	}
	if cancel.MarketId != "ubze/uusdc" || cancel.OrderId != "42" || cancel.OrderType != "sell" {
		t.Fatalf("decoded cancel wrong: %+v", cancel)
	}
}
