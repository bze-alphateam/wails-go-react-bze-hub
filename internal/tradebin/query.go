// Package tradebin is the Go-side equivalent of the web ui-kit's DEX query layer
// for BZE Hub. It reads the tradebin module's markets, orderbook and orders over
// the REST proxy (the same source the web `packages/ui-kit/src/query/markets.ts`
// uses) and reads 24h stats, trade history and candles from the public DEX
// aggregator (see aggregator.go), mirroring `query/aggregator.ts`.
//
// Two hard rules from the M3 business logic:
//   - On-chain data (markets, orderbook, my orders, params) always comes from the
//     node/proxy, never the aggregator.
//   - The aggregator only serves stats/history/candles the local node cannot; its
//     failures degrade gracefully (markets still list, stats typed unavailable).
package tradebin

import (
	"fmt"
	"net/url"
)

// On-chain REST endpoint paths (tradebin query gateway,
// x/tradebin/types/query.pb.gw.go). Limits mirror the web query client.
const (
	marketsPath          = "/bze/tradebin/all_markets?pagination.limit=1000"
	aggregatedOrdersPath = "/bze/tradebin/market_aggregated_orders"
	userMarketOrdersPath = "/bze/tradebin/user_market_orders/"
	marketOrderPath      = "/bze/tradebin/market_order"
	paramsPath           = "/bze/tradebin/params"

	// orderbookDepth is how many aggregated price levels to pull per side. The
	// web terminal requests 15; the hub pulls deeper so the cumulative depth
	// bars (BHUB-27) have more to draw. Aggregated levels are few, so this is
	// cheap.
	orderbookDepth = 100

	// userOrdersLimit mirrors the web getAddressMarketOrders (100).
	userOrdersLimit = 100
)

// Order-book side identifiers, matching tradebin's OrderTypeBuy/OrderTypeSell.
const (
	OrderTypeBuy  = "buy"
	OrderTypeSell = "sell"
)

// RestClient is the subset of the chain REST proxy this package needs. The
// production implementation is *chain.Client; tests supply a stub. Mirrors the
// internal/amm RestClient interface.
type RestClient interface {
	RestGet(path string) (map[string]interface{}, error)
}

// MarketId builds a tradebin order-book market id from its base/quote denoms.
// The chain's CreateMarketId joins them with "/" (x/tradebin/types/key_market.go),
// and the web createMarketId does the same. This id is what the orderbook, my
// orders and aggregator ticker queries key on.
func MarketId(base, quote string) string {
	return base + "/" + quote
}

// Market is a tradebin order-book market. The chain Market has only base/quote/
// creator; MarketId is derived (base/quote) for convenience, matching the web.
type Market struct {
	MarketId string `json:"marketId"`
	Base     string `json:"base"`
	Quote    string `json:"quote"`
	Creator  string `json:"creator"`
}

// OrderbookLevel is one aggregated price level: a price and the total amount
// resting at it. Amounts are chain-native integer strings (base units); prices
// are chain-native u-price decimal strings. The frontend converts for display.
type OrderbookLevel struct {
	Price  string `json:"price"`
	Amount string `json:"amount"`
}

// Orderbook is the two-sided aggregated book for a market. Buy levels come back
// highest-price-first and sell levels lowest-price-first (the natural spread
// ordering), matching the web getMarketBuyOrders/getMarketSellOrders.
type Orderbook struct {
	MarketId string           `json:"marketId"`
	Buy      []OrderbookLevel `json:"buy"`
	Sell     []OrderbookLevel `json:"sell"`
}

// Order is a single resting order owned by the user (hydrated from an
// OrderReference). Amounts/prices are chain-native strings.
type Order struct {
	Id        string `json:"id"`
	MarketId  string `json:"marketId"`
	OrderType string `json:"orderType"`
	Amount    string `json:"amount"`
	Price     string `json:"price"`
	CreatedAt int64  `json:"createdAt"`
	Owner     string `json:"owner"`
}

// Coin is a denom+amount pair as the chain returns it (amount is an integer
// string).
type Coin struct {
	Denom  string `json:"denom"`
	Amount string `json:"amount"`
}

// MarketParams are the tradebin fee parameters a form needs to display and
// validate order costs. Sourced from the module's v2 Params.
type MarketParams struct {
	CreateMarketFee Coin `json:"createMarketFee"`
	MakerFee        Coin `json:"makerFee"`
	TakerFee        Coin `json:"takerFee"`
}

// FetchMarkets returns every tradebin order-book market. Go equivalent of the
// web getMarkets(). The AllMarkets response field is "market" (repeated Market).
func FetchMarkets(rest RestClient) ([]Market, error) {
	resp, err := rest.RestGet(marketsPath)
	if err != nil {
		return nil, fmt.Errorf("query markets: %w", err)
	}
	list := asSlice(resp["market"])
	markets := make([]Market, 0, len(list))
	for _, item := range list {
		m, ok := asMap(item)
		if !ok {
			continue
		}
		base := asString(m["base"])
		quote := asString(m["quote"])
		markets = append(markets, Market{
			MarketId: MarketId(base, quote),
			Base:     base,
			Quote:    quote,
			Creator:  asString(m["creator"]),
		})
	}
	return markets, nil
}

// FetchOrderbook returns the aggregated buy and sell levels for a market. Both
// sides come from the node (never the aggregator). Port of the web
// getMarketBuyOrders/getMarketSellOrders — one MarketAggregatedOrders query per
// side. The buy side is requested reversed so it arrives highest-price-first.
func FetchOrderbook(rest RestClient, marketId string) (Orderbook, error) {
	buy, err := fetchAggregatedOrders(rest, marketId, OrderTypeBuy)
	if err != nil {
		return Orderbook{}, err
	}
	sell, err := fetchAggregatedOrders(rest, marketId, OrderTypeSell)
	if err != nil {
		return Orderbook{}, err
	}
	return Orderbook{MarketId: marketId, Buy: buy, Sell: sell}, nil
}

func fetchAggregatedOrders(rest RestClient, marketId, orderType string) ([]OrderbookLevel, error) {
	path := fmt.Sprintf("%s?market=%s&order_type=%s&pagination.limit=%d",
		aggregatedOrdersPath, url.QueryEscape(marketId), orderType, orderbookDepth)
	// Buy levels reversed → highest bid first (web parity: reversed = isBuy).
	if orderType == OrderTypeBuy {
		path += "&pagination.reverse=true"
	}
	resp, err := rest.RestGet(path)
	if err != nil {
		return nil, fmt.Errorf("query %s orders for %s: %w", orderType, marketId, err)
	}
	list := asSlice(resp["list"])
	levels := make([]OrderbookLevel, 0, len(list))
	for _, item := range list {
		m, ok := asMap(item)
		if !ok {
			continue
		}
		levels = append(levels, OrderbookLevel{
			Price:  asString(m["price"]),
			Amount: asString(m["amount"]),
		})
	}
	return levels, nil
}

// FetchMyOrders returns the user's resting orders on a market, fully hydrated
// (side, price, amount). Port of the web getAddressFullMarketOrders: query the
// user's order references, then look each up by id. Always node-sourced.
func FetchMyOrders(rest RestClient, marketId, address string) ([]Order, error) {
	path := fmt.Sprintf("%s%s?market=%s&pagination.limit=%d",
		userMarketOrdersPath, url.PathEscape(address), url.QueryEscape(marketId), userOrdersLimit)
	resp, err := rest.RestGet(path)
	if err != nil {
		return nil, fmt.Errorf("query user orders for %s: %w", marketId, err)
	}
	refs := asSlice(resp["list"])
	orders := make([]Order, 0, len(refs))
	for _, item := range refs {
		ref, ok := asMap(item)
		if !ok {
			continue
		}
		order, err := fetchMarketOrder(rest, asString(ref["market_id"]), asString(ref["order_type"]), asString(ref["id"]))
		if err != nil {
			return nil, err
		}
		if order != nil {
			orders = append(orders, *order)
		}
	}
	return orders, nil
}

// FetchMyOpenOrderCount returns how many resting orders an address has across
// ALL order-book markets. It is cheap — a single query of the user's order
// references with no per-order hydration. Passing no market to
// user_market_orders makes the chain return every market's references
// (keeper: getUserOrderByAddressStore), so the Simple view can surface "N open
// orders" without scanning markets one by one.
func FetchMyOpenOrderCount(rest RestClient, address string) (int, error) {
	path := fmt.Sprintf("%s%s?pagination.limit=%d", userMarketOrdersPath, url.PathEscape(address), userOrdersLimit)
	resp, err := rest.RestGet(path)
	if err != nil {
		return 0, fmt.Errorf("query user open orders: %w", err)
	}
	return len(asSlice(resp["list"])), nil
}

func fetchMarketOrder(rest RestClient, marketId, orderType, orderID string) (*Order, error) {
	path := fmt.Sprintf("%s?market=%s&order_type=%s&order_id=%s",
		marketOrderPath, url.QueryEscape(marketId), orderType, url.QueryEscape(orderID))
	resp, err := rest.RestGet(path)
	if err != nil {
		return nil, fmt.Errorf("query order %s/%s/%s: %w", marketId, orderType, orderID, err)
	}
	m, ok := asMap(resp["order"])
	if !ok {
		return nil, nil
	}
	return &Order{
		Id:        asString(m["id"]),
		MarketId:  asString(m["market_id"]),
		OrderType: asString(m["order_type"]),
		Amount:    asString(m["amount"]),
		Price:     asString(m["price"]),
		CreatedAt: asInt64(m["created_at"]),
		Owner:     asString(m["owner"]),
	}, nil
}

// FetchMarketParams returns the tradebin fee parameters. The v2 Params proto
// fields are written in mixed case (createMarketFee, native_denom, …); the REST
// gateway emits proto field names as-is, so keys are looked up defensively
// against both camelCase and snake_case to survive a gateway marshaler change.
func FetchMarketParams(rest RestClient) (MarketParams, error) {
	resp, err := rest.RestGet(paramsPath)
	if err != nil {
		return MarketParams{}, fmt.Errorf("query market params: %w", err)
	}
	params, ok := asMap(resp["params"])
	if !ok {
		return MarketParams{}, fmt.Errorf("query market params: missing params in response")
	}
	return MarketParams{
		CreateMarketFee: asCoin(pick(params, "createMarketFee", "create_market_fee")),
		MakerFee:        asCoin(pick(params, "marketMakerFee", "market_maker_fee")),
		TakerFee:        asCoin(pick(params, "marketTakerFee", "market_taker_fee")),
	}, nil
}

// --- untyped-JSON helpers (mirrors internal/amm) ----------------------------

func asMap(v interface{}) (map[string]interface{}, bool) {
	m, ok := v.(map[string]interface{})
	return m, ok
}

func asSlice(v interface{}) []interface{} {
	s, _ := v.([]interface{})
	return s
}

func asString(v interface{}) string {
	s, _ := v.(string)
	return s
}

// asInt64 coerces a JSON number (float64) or numeric string into int64. Chain
// int64 fields (created_at) serialize as JSON strings over REST; guarded both
// ways.
func asInt64(v interface{}) int64 {
	switch t := v.(type) {
	case float64:
		return int64(t)
	case string:
		var n int64
		fmt.Sscan(t, &n)
		return n
	}
	return 0
}

// asCoin parses a {denom, amount} object.
func asCoin(v interface{}) Coin {
	m, ok := asMap(v)
	if !ok {
		return Coin{}
	}
	return Coin{Denom: asString(m["denom"]), Amount: asString(m["amount"])}
}

// pick returns the first present key from m, so a value can be read regardless
// of the gateway's field-name casing.
func pick(m map[string]interface{}, keys ...string) interface{} {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			return v
		}
	}
	return nil
}
