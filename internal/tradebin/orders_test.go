package tradebin

import (
	"errors"
	"strings"
	"testing"
)

// orderbookRest returns a mockRest that serves the given buy/sell aggregated
// levels, routed by the order_type query param (matching fetchAggregatedOrders).
func orderbookRest(t *testing.T, buy, sell string) *mockRest {
	return &mockRest{handler: func(path string) (map[string]interface{}, error) {
		if strings.Contains(path, "order_type=sell") {
			return jsonMap(t, sell), nil
		}
		return jsonMap(t, buy), nil
	}}
}

// msgAt is a compact assertion on a built order message.
func assertMsg(t *testing.T, m map[string]interface{}, wantType, wantAmount, wantPrice string) {
	t.Helper()
	if m["@type"] != MsgCreateOrderType {
		t.Fatalf("@type = %v", m["@type"])
	}
	if m["order_type"] != wantType {
		t.Fatalf("order_type = %v, want %s", m["order_type"], wantType)
	}
	if m["amount"] != wantAmount {
		t.Fatalf("amount = %v, want %s", m["amount"], wantAmount)
	}
	if m["price"] != wantPrice {
		t.Fatalf("price = %v, want %s", m["price"], wantPrice)
	}
}

func TestBuildOrderMessages_NoCrossing(t *testing.T) {
	// Buy limit 9 is below every resting sell → a single limit order.
	sell := `{"list":[{"price":"10","amount":"100"},{"price":"11","amount":"200"}]}`
	rest := orderbookRest(t, `{"list":[]}`, sell)

	msgs, err := BuildOrderMessages(rest, "ubze/uusdc", "bze1a", true, "500", "9")
	if err != nil {
		t.Fatalf("BuildOrderMessages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("got %d msgs, want 1", len(msgs))
	}
	assertMsg(t, msgs[0], "buy", "500", "9")
	if msgs[0]["market_id"] != "ubze/uusdc" || msgs[0]["creator"] != "bze1a" {
		t.Fatalf("msg meta wrong: %+v", msgs[0])
	}
}

func TestBuildOrderMessages_PartialFillWithLeftover(t *testing.T) {
	// Buy 500 @ limit 11.5: crosses sells 10/100 and 11/200 (12 is above limit).
	// Fills 100@10, 200@11, then rests 200@11.5.
	sell := `{"list":[{"price":"10","amount":"100"},{"price":"11","amount":"200"},{"price":"12","amount":"50"}]}`
	rest := orderbookRest(t, `{"list":[]}`, sell)

	msgs, err := BuildOrderMessages(rest, "m", "bze1a", true, "500", "11.5")
	if err != nil {
		t.Fatalf("BuildOrderMessages: %v", err)
	}
	if len(msgs) != 3 {
		t.Fatalf("got %d msgs, want 3: %+v", len(msgs), msgs)
	}
	assertMsg(t, msgs[0], "buy", "100", "10")
	assertMsg(t, msgs[1], "buy", "200", "11")
	assertMsg(t, msgs[2], "buy", "200", "11.5") // leftover at limit
}

func TestBuildOrderMessages_FullFillNoLeftover(t *testing.T) {
	// Buy 300 @ limit 11.5: fills 100@10 and 200@11 exactly, no leftover.
	sell := `{"list":[{"price":"10","amount":"100"},{"price":"11","amount":"200"},{"price":"12","amount":"50"}]}`
	rest := orderbookRest(t, `{"list":[]}`, sell)

	msgs, err := BuildOrderMessages(rest, "m", "bze1a", true, "300", "11.5")
	if err != nil {
		t.Fatalf("BuildOrderMessages: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("got %d msgs, want 2: %+v", len(msgs), msgs)
	}
	assertMsg(t, msgs[0], "buy", "100", "10")
	assertMsg(t, msgs[1], "buy", "200", "11")
}

func TestBuildOrderMessages_CapAtLevel(t *testing.T) {
	// Buy 50 @ limit 11.5: only partially consumes the first sell level (100).
	sell := `{"list":[{"price":"10","amount":"100"},{"price":"11","amount":"200"}]}`
	rest := orderbookRest(t, `{"list":[]}`, sell)

	msgs, err := BuildOrderMessages(rest, "m", "bze1a", true, "50", "11.5")
	if err != nil {
		t.Fatalf("BuildOrderMessages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("got %d msgs, want 1: %+v", len(msgs), msgs)
	}
	assertMsg(t, msgs[0], "buy", "50", "10") // capped to remaining, at level price
}

func TestBuildOrderMessages_SellSideCrossesBuys(t *testing.T) {
	// Sell 120 @ limit 9: crosses buys 10/100 and 9.5/50 (8 is below limit).
	// Fills 100@10, then caps 20@9.5, no leftover.
	buy := `{"list":[{"price":"10","amount":"100"},{"price":"9.5","amount":"50"},{"price":"8","amount":"200"}]}`
	rest := orderbookRest(t, buy, `{"list":[]}`)

	msgs, err := BuildOrderMessages(rest, "m", "bze1a", false, "120", "9")
	if err != nil {
		t.Fatalf("BuildOrderMessages: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("got %d msgs, want 2: %+v", len(msgs), msgs)
	}
	assertMsg(t, msgs[0], "sell", "100", "10")
	assertMsg(t, msgs[1], "sell", "20", "9.5")
}

func TestValidateOrderInput(t *testing.T) {
	cases := []struct {
		name             string
		marketId, amount string
		price            string
		wantErr          error
	}{
		{"valid", "ubze/uusdc", "100", "1.5", nil},
		{"empty market", "", "100", "1.5", ErrMarketIdRequired},
		{"zero amount", "m", "0", "1.5", ErrInvalidOrderAmount},
		{"negative amount", "m", "-5", "1.5", ErrInvalidOrderAmount},
		{"non-int amount", "m", "1.5", "1.5", ErrInvalidOrderAmount},
		{"unparseable price", "m", "100", "abc", ErrInvalidOrderPrice},
		{"price at minimum", "m", "100", "0.0000000001", ErrInvalidOrderPrice},
		{"below min amount", "m", "1", "100", ErrAmountBelowMinimum}, // min = ceil(1/100)*2 = 2
		{"at min amount", "m", "2", "100", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateOrderInput(tc.marketId, true, tc.amount, tc.price)
			if tc.wantErr == nil {
				if err != nil {
					t.Fatalf("want nil, got %v", err)
				}
				return
			}
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("want %v, got %v", tc.wantErr, err)
			}
		})
	}
}
