package tradebin

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseTickers(t *testing.T) {
	data := []byte(`[
		{"base":"ubze","quote":"uusdc","market_id":"ubze/uusdc","last_price":1.5,"base_volume":"1000","quote_volume":1500,"bid":1.4,"ask":1.6,"high":2,"low":1,"open_price":1.2,"change":25},
		{"base":"ubze","quote":"uusdc","market_id":"ubze_uusdc","last_price":1.51,"base_volume":50,"quote_volume":75,"change":-3}
	]`)
	tickers, err := parseTickers(data)
	if err != nil {
		t.Fatalf("parseTickers: %v", err)
	}
	if len(tickers) != 2 {
		t.Fatalf("got %d tickers, want 2", len(tickers))
	}
	// number and string inputs both surface as strings (flexString)
	s := tickers[0].stats()
	if s.LastPrice != "1.5" || s.BaseVolume != "1000" || s.QuoteVolume != "1500" || s.Change != "25" {
		t.Fatalf("ticker[0] stats wrong: %+v", s)
	}
}

func TestParseHistoryMixedTypes(t *testing.T) {
	// price string, volumes numeric, order_id numeric — all coerce to strings
	data := []byte(`[
		{"order_id":42,"price":"1.5","base_volume":100,"quote_volume":"150","executed_at":"2026-07-27T10:00:00Z","order_type":"buy","maker":"bze1m","taker":"bze1t"}
	]`)
	trades, err := parseHistory(data)
	if err != nil {
		t.Fatalf("parseHistory: %v", err)
	}
	if len(trades) != 1 {
		t.Fatalf("got %d trades, want 1", len(trades))
	}
	tr := trades[0]
	if tr.OrderId != "42" || tr.Price != "1.5" || tr.BaseVolume != "100" || tr.QuoteVolume != "150" {
		t.Fatalf("trade coercion wrong: %+v", tr)
	}
	if tr.OrderType != "buy" || tr.ExecutedAt != "2026-07-27T10:00:00Z" {
		t.Fatalf("trade fields wrong: %+v", tr)
	}
}

func TestParseCandles(t *testing.T) {
	data := []byte(`[
		{"time":"1720000000","low":1,"open":1.2,"high":1.5,"close":1.4,"value":1000},
		{"time":"1720000300","low":1.4,"open":1.4,"high":1.6,"close":1.55,"value":"2000"}
	]`)
	candles, err := parseCandles(data)
	if err != nil {
		t.Fatalf("parseCandles: %v", err)
	}
	if len(candles) != 2 {
		t.Fatalf("got %d candles, want 2", len(candles))
	}
	if candles[0].Time != "1720000000" || candles[0].Open != "1.2" || candles[0].Close != "1.4" || candles[0].Value != "1000" {
		t.Fatalf("candle[0] wrong: %+v", candles[0])
	}
	if candles[1].Value != "2000" {
		t.Fatalf("candle[1] value = %q", candles[1].Value)
	}
}

func TestMergeMarketStats(t *testing.T) {
	markets := []Market{
		{MarketId: "ubze/uusdc", Base: "ubze", Quote: "uusdc"},
		{MarketId: "uatom/ubze", Base: "uatom", Quote: "ubze"},
	}
	tickers := []rawTicker{
		{Base: "ubze", Quote: "uusdc", MarketID: "ubze/uusdc", LastPrice: "1.5", Change: "10"},
	}
	merged := MergeMarketStats(markets, tickers)
	if len(merged) != 2 {
		t.Fatalf("got %d merged, want 2", len(merged))
	}
	if !merged[0].StatsAvailable || merged[0].Stats == nil || merged[0].Stats.LastPrice != "1.5" {
		t.Fatalf("market[0] should have stats: %+v", merged[0])
	}
	if merged[1].StatsAvailable || merged[1].Stats != nil {
		t.Fatalf("market[1] should have no stats: %+v", merged[1])
	}
}

func TestMergeMarketStatsAggregatorDown(t *testing.T) {
	markets := []Market{{MarketId: "ubze/uusdc", Base: "ubze", Quote: "uusdc"}}
	merged := MergeMarketStats(markets, nil)
	if len(merged) != 1 {
		t.Fatalf("got %d merged, want 1", len(merged))
	}
	if merged[0].StatsAvailable || merged[0].Stats != nil {
		t.Fatalf("aggregator-down market must have no stats: %+v", merged[0])
	}
	if merged[0].MarketId != "ubze/uusdc" {
		t.Fatalf("market still listed wrong: %+v", merged[0])
	}
}

func TestPoolStatsFromTickers(t *testing.T) {
	tickers := []rawTicker{
		// order-book market: market_id == base/quote → excluded
		{Base: "ubze", Quote: "uusdc", MarketID: "ubze/uusdc", QuoteVolume: "100"},
		// pool: market_id != base/quote (base_quote) → included
		{Base: "ubze", Quote: "uusdc", MarketID: "ubze_uusdc", LastPrice: "1.5", BaseVolume: "10", QuoteVolume: "15", Change: "2"},
	}
	pools := poolStatsFromTickers(tickers)
	if len(pools) != 1 {
		t.Fatalf("got %d pools, want 1", len(pools))
	}
	if pools[0].PoolId != "ubze_uusdc" || pools[0].QuoteVolume != "15" || pools[0].LastPrice != "1.5" {
		t.Fatalf("pool stat wrong: %+v", pools[0])
	}
}

// TestFetchMarketsWithStatsAggregatorDown verifies the graceful-degradation
// rule: when the aggregator errors, markets still list with StatsAvailable=false
// and no error surfaces.
func TestFetchMarketsWithStatsAggregatorDown(t *testing.T) {
	rest := &mockRest{handler: func(path string) (map[string]interface{}, error) {
		return jsonMap(t, `{"market":[{"base":"ubze","quote":"uusdc","creator":"bze1a"}]}`), nil
	}}
	// aggregator server that always 500s
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	markets, err := FetchMarketsWithStats(rest, NewAggregator(srv.URL))
	if err != nil {
		t.Fatalf("aggregator-down must not error: %v", err)
	}
	if len(markets) != 1 || markets[0].StatsAvailable {
		t.Fatalf("expected 1 market without stats, got %+v", markets)
	}
}

// TestFetchMarketsWithStatsHappyPath verifies markets + tickers merge end to end
// over HTTP.
func TestFetchMarketsWithStatsHappyPath(t *testing.T) {
	rest := &mockRest{handler: func(path string) (map[string]interface{}, error) {
		return jsonMap(t, `{"market":[{"base":"ubze","quote":"uusdc","creator":"bze1a"}]}`), nil
	}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/api/dex/tickers") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"base":"ubze","quote":"uusdc","market_id":"ubze/uusdc","last_price":1.5,"quote_volume":"1500","change":10}]`))
	}))
	defer srv.Close()

	markets, err := FetchMarketsWithStats(rest, NewAggregator(srv.URL))
	if err != nil {
		t.Fatalf("FetchMarketsWithStats: %v", err)
	}
	if len(markets) != 1 || !markets[0].StatsAvailable {
		t.Fatalf("expected 1 market with stats, got %+v", markets)
	}
	if markets[0].Stats.LastPrice != "1.5" || markets[0].Stats.QuoteVolume != "1500" {
		t.Fatalf("stats merged wrong: %+v", markets[0].Stats)
	}
}

func TestNewAggregatorDefaultHost(t *testing.T) {
	if a := NewAggregator(""); a.host != DefaultAggregatorHost {
		t.Fatalf("empty host should default to %q, got %q", DefaultAggregatorHost, a.host)
	}
	if a := NewAggregator("https://example.com/"); a.host != "https://example.com" {
		t.Fatalf("trailing slash not trimmed: %q", a.host)
	}
}

// TestAggregatorEndpoints checks each aggregator method hits the right path/params.
func TestAggregatorEndpoints(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.String()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer srv.Close()
	agg := NewAggregator(srv.URL)

	if _, err := agg.MarketHistory("ubze/uusdc"); err != nil {
		t.Fatalf("MarketHistory: %v", err)
	}
	if !strings.Contains(gotPath, "/api/dex/history") || !strings.Contains(gotPath, "market_id=ubze%2Fuusdc") {
		t.Fatalf("history path wrong: %q", gotPath)
	}

	if _, err := agg.Candles("ubze/uusdc", 15, 100); err != nil {
		t.Fatalf("Candles: %v", err)
	}
	if !strings.Contains(gotPath, "/api/dex/intervals") || !strings.Contains(gotPath, "minutes=15") ||
		!strings.Contains(gotPath, "limit=100") || !strings.Contains(gotPath, "format=tv") {
		t.Fatalf("intervals path wrong: %q", gotPath)
	}

	if _, err := agg.AddressMarketHistory("ubze/uusdc", "bze1a"); err != nil {
		t.Fatalf("AddressMarketHistory: %v", err)
	}
	if !strings.Contains(gotPath, "address=bze1a") || !strings.Contains(gotPath, "market_id=ubze%2Fuusdc") {
		t.Fatalf("address history path wrong: %q", gotPath)
	}
}
