package tradebin

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// mockRest routes RestGet calls through a handler keyed on the request path, so
// tests can match the URL-escaped tradebin paths by substring rather than exact
// string. It records every path for assertions. Mirrors bank_test.go's stub.
type mockRest struct {
	handler func(path string) (map[string]interface{}, error)
	paths   []string
}

func (m *mockRest) RestGet(path string) (map[string]interface{}, error) {
	m.paths = append(m.paths, path)
	if m.handler == nil {
		return map[string]interface{}{}, nil
	}
	return m.handler(path)
}

// jsonMap decodes a JSON object literal into the untyped map RestGet returns.
func jsonMap(t *testing.T, raw string) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatalf("bad fixture JSON: %v", err)
	}
	return m
}

func TestMarketId(t *testing.T) {
	if got := MarketId("ubze", "uusdc"); got != "ubze/uusdc" {
		t.Fatalf("MarketId = %q, want ubze/uusdc", got)
	}
}

func TestFetchMarkets(t *testing.T) {
	rest := &mockRest{handler: func(path string) (map[string]interface{}, error) {
		return jsonMap(t, `{"market":[
			{"base":"ubze","quote":"uusdc","creator":"bze1aaa"},
			{"base":"uatom","quote":"ubze","creator":"bze1bbb"}
		]}`), nil
	}}

	markets, err := FetchMarkets(rest)
	if err != nil {
		t.Fatalf("FetchMarkets: %v", err)
	}
	if len(markets) != 2 {
		t.Fatalf("got %d markets, want 2", len(markets))
	}
	if markets[0].MarketId != "ubze/uusdc" || markets[0].Base != "ubze" || markets[0].Quote != "uusdc" {
		t.Fatalf("market[0] wrong: %+v", markets[0])
	}
	if markets[1].MarketId != "uatom/ubze" {
		t.Fatalf("market[1] id = %q", markets[1].MarketId)
	}
	if !strings.Contains(rest.paths[0], "all_markets") {
		t.Fatalf("unexpected path %q", rest.paths[0])
	}
}

func TestFetchOrderbook(t *testing.T) {
	rest := &mockRest{handler: func(path string) (map[string]interface{}, error) {
		if strings.Contains(path, "order_type=buy") {
			if !strings.Contains(path, "reverse=true") {
				t.Errorf("buy side must be requested reversed: %q", path)
			}
			return jsonMap(t, `{"list":[
				{"price":"10","amount":"100"},
				{"price":"9","amount":"200"}
			]}`), nil
		}
		return jsonMap(t, `{"list":[
			{"price":"11","amount":"50"},
			{"price":"12","amount":"75"}
		]}`), nil
	}}

	ob, err := FetchOrderbook(rest, "ubze/uusdc")
	if err != nil {
		t.Fatalf("FetchOrderbook: %v", err)
	}
	if ob.MarketId != "ubze/uusdc" {
		t.Fatalf("marketId = %q", ob.MarketId)
	}
	if len(ob.Buy) != 2 || ob.Buy[0].Price != "10" || ob.Buy[0].Amount != "100" {
		t.Fatalf("buy side wrong: %+v", ob.Buy)
	}
	if len(ob.Sell) != 2 || ob.Sell[0].Price != "11" {
		t.Fatalf("sell side wrong: %+v", ob.Sell)
	}
	// market id must be URL-escaped in the query (contains a slash)
	for _, p := range rest.paths {
		if strings.Contains(p, "market=ubze/uusdc") {
			t.Fatalf("market id not escaped in %q", p)
		}
	}
}

func TestFetchMyOrders(t *testing.T) {
	rest := &mockRest{handler: func(path string) (map[string]interface{}, error) {
		switch {
		case strings.Contains(path, "user_market_orders"):
			return jsonMap(t, `{"list":[
				{"id":"5","market_id":"ubze/uusdc","order_type":"buy"},
				{"id":"6","market_id":"ubze/uusdc","order_type":"sell"}
			]}`), nil
		case strings.Contains(path, "order_id=5"):
			return jsonMap(t, `{"order":{"id":"5","market_id":"ubze/uusdc","order_type":"buy","amount":"100","price":"9.5","created_at":"1720000000","owner":"bze1aaa"}}`), nil
		case strings.Contains(path, "order_id=6"):
			return jsonMap(t, `{"order":{"id":"6","market_id":"ubze/uusdc","order_type":"sell","amount":"40","price":"12","created_at":"1720000100","owner":"bze1aaa"}}`), nil
		}
		return nil, fmt.Errorf("unexpected path %q", path)
	}}

	orders, err := FetchMyOrders(rest, "ubze/uusdc", "bze1aaa")
	if err != nil {
		t.Fatalf("FetchMyOrders: %v", err)
	}
	if len(orders) != 2 {
		t.Fatalf("got %d orders, want 2", len(orders))
	}
	if orders[0].Id != "5" || orders[0].Amount != "100" || orders[0].Price != "9.5" || orders[0].CreatedAt != 1720000000 {
		t.Fatalf("order[0] hydrated wrong: %+v", orders[0])
	}
	if orders[1].OrderType != "sell" || orders[1].Amount != "40" {
		t.Fatalf("order[1] wrong: %+v", orders[1])
	}
}

func TestFetchMyOrdersEmpty(t *testing.T) {
	rest := &mockRest{handler: func(path string) (map[string]interface{}, error) {
		return jsonMap(t, `{"list":[]}`), nil
	}}
	orders, err := FetchMyOrders(rest, "ubze/uusdc", "bze1aaa")
	if err != nil {
		t.Fatalf("FetchMyOrders: %v", err)
	}
	if len(orders) != 0 {
		t.Fatalf("got %d orders, want 0", len(orders))
	}
}

func TestFetchMyOpenOrderCount(t *testing.T) {
	rest := &mockRest{handler: func(path string) (map[string]interface{}, error) {
		if strings.Contains(path, "market=") {
			t.Errorf("count query must not filter by market: %q", path)
		}
		return jsonMap(t, `{"list":[
			{"id":"1","market_id":"ubze/uusdc","order_type":"buy"},
			{"id":"2","market_id":"uatom/ubze","order_type":"sell"},
			{"id":"3","market_id":"ubze/uusdc","order_type":"sell"}
		]}`), nil
	}}
	n, err := FetchMyOpenOrderCount(rest, "bze1aaa")
	if err != nil {
		t.Fatalf("FetchMyOpenOrderCount: %v", err)
	}
	if n != 3 {
		t.Fatalf("count = %d, want 3", n)
	}
}

func TestFetchMarketParams(t *testing.T) {
	// camelCase keys (as the proto v2 Params fields are written)
	rest := &mockRest{handler: func(path string) (map[string]interface{}, error) {
		return jsonMap(t, `{"params":{
			"createMarketFee":{"denom":"ubze","amount":"1000000"},
			"marketMakerFee":{"denom":"ubze","amount":"10"},
			"marketTakerFee":{"denom":"ubze","amount":"20"}
		}}`), nil
	}}
	params, err := FetchMarketParams(rest)
	if err != nil {
		t.Fatalf("FetchMarketParams: %v", err)
	}
	if params.CreateMarketFee.Amount != "1000000" || params.CreateMarketFee.Denom != "ubze" {
		t.Fatalf("createMarketFee wrong: %+v", params.CreateMarketFee)
	}
	if params.MakerFee.Amount != "10" || params.TakerFee.Amount != "20" {
		t.Fatalf("fees wrong: maker=%+v taker=%+v", params.MakerFee, params.TakerFee)
	}
}

func TestFetchMarketParamsSnakeCase(t *testing.T) {
	// snake_case fallback keys (defensive against a gateway marshaler change)
	rest := &mockRest{handler: func(path string) (map[string]interface{}, error) {
		return jsonMap(t, `{"params":{
			"create_market_fee":{"denom":"ubze","amount":"1000000"},
			"market_maker_fee":{"denom":"ubze","amount":"10"},
			"market_taker_fee":{"denom":"ubze","amount":"20"}
		}}`), nil
	}}
	params, err := FetchMarketParams(rest)
	if err != nil {
		t.Fatalf("FetchMarketParams: %v", err)
	}
	if params.CreateMarketFee.Amount != "1000000" || params.TakerFee.Amount != "20" {
		t.Fatalf("snake-case params not parsed: %+v", params)
	}
}
