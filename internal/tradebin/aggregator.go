package tradebin

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultAggregatorHost is the public DEX aggregator the web dapp uses
// (packages/ui-kit/src/constants/endpoints.ts getAggregatorHost). It serves 24h
// tickers, trade history, candles and pool volumes that the local node cannot.
// Overridable via the AggregatorHost app setting.
const DefaultAggregatorHost = "https://getbze.com"

// historyLimit is how many recent trades to pull for a market's history feed.
// The web recent-trades panel pulls a page of history; 50 is a comfortable feed.
const historyLimit = 50

// addressHistoryLimit mirrors the web getAddressHistory (100).
const addressHistoryLimit = 100

// Aggregator queries the public DEX aggregator over HTTP. It is separate from
// the chain REST proxy: the aggregator is an external service, so it has its own
// client and never routes through the node. All methods degrade to an error the
// caller can swallow into "stats unavailable" rather than propagate.
type Aggregator struct {
	host string
	http *http.Client
}

// NewAggregator builds an aggregator client for host. An empty host falls back
// to DefaultAggregatorHost. A trailing slash is trimmed so path joins are clean.
func NewAggregator(host string) *Aggregator {
	host = strings.TrimRight(strings.TrimSpace(host), "/")
	if host == "" {
		host = DefaultAggregatorHost
	}
	return &Aggregator{
		host: host,
		http: &http.Client{Timeout: 15 * time.Second},
	}
}

// MarketStats are the 24h ticker stats for one market, as chain-native decimal
// strings (big-number-safe for the frontend). Sourced from /api/dex/tickers.
type MarketStats struct {
	LastPrice   string `json:"lastPrice"`
	BaseVolume  string `json:"baseVolume"`
	QuoteVolume string `json:"quoteVolume"`
	Bid         string `json:"bid"`
	Ask         string `json:"ask"`
	High        string `json:"high"`
	Low         string `json:"low"`
	OpenPrice   string `json:"openPrice"`
	Change      string `json:"change"`
}

// MarketWithStats is a market merged with its 24h stats. When the aggregator is
// unreachable, StatsAvailable is false and Stats is nil — the market still lists.
type MarketWithStats struct {
	MarketId       string       `json:"marketId"`
	Base           string       `json:"base"`
	Quote          string       `json:"quote"`
	Creator        string       `json:"creator"`
	StatsAvailable bool         `json:"statsAvailable"`
	Stats          *MarketStats `json:"stats"`
}

// PoolStat is a liquidity pool's 24h aggregator stats. Full TVL/APR are composed
// frontend-side (BHUB-30) from these volumes plus pool reserves and USD prices,
// exactly as the web getPoolData does — the aggregator only serves the volumes.
type PoolStat struct {
	PoolId      string `json:"poolId"`
	Base        string `json:"base"`
	Quote       string `json:"quote"`
	LastPrice   string `json:"lastPrice"`
	BaseVolume  string `json:"baseVolume"`
	QuoteVolume string `json:"quoteVolume"`
	Change      string `json:"change"`
}

// Trade is one executed trade from the aggregator history feed. Amounts/price
// are strings (big-number-safe).
type Trade struct {
	OrderId     string `json:"orderId"`
	Price       string `json:"price"`
	BaseVolume  string `json:"baseVolume"`
	QuoteVolume string `json:"quoteVolume"`
	ExecutedAt  string `json:"executedAt"`
	OrderType   string `json:"orderType"`
	Maker       string `json:"maker"`
	Taker       string `json:"taker"`
}

// Candle is one TradingView-shaped interval (aggregator format=tv). Values are
// strings for the chart layer to parse.
type Candle struct {
	Time  string `json:"time"`
	Open  string `json:"open"`
	High  string `json:"high"`
	Low   string `json:"low"`
	Close string `json:"close"`
	Value string `json:"value"` // interval volume
}

// --- aggregator JSON shapes (raw, as the API returns them) ------------------

// flexString unmarshals a JSON value that the aggregator types as `string |
// number` (prices, volumes, order ids) into a Go string without losing
// precision. Numbers are kept verbatim; strings are taken as-is.
type flexString string

func (f *flexString) UnmarshalJSON(b []byte) error {
	if len(b) == 0 || string(b) == "null" {
		*f = ""
		return nil
	}
	if b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		*f = flexString(s)
		return nil
	}
	*f = flexString(strings.TrimSpace(string(b)))
	return nil
}

func (f flexString) String() string { return string(f) }

type rawTicker struct {
	Base        string     `json:"base"`
	Quote       string     `json:"quote"`
	MarketID    string     `json:"market_id"`
	LastPrice   flexString `json:"last_price"`
	BaseVolume  flexString `json:"base_volume"`
	QuoteVolume flexString `json:"quote_volume"`
	Bid         flexString `json:"bid"`
	Ask         flexString `json:"ask"`
	High        flexString `json:"high"`
	Low         flexString `json:"low"`
	OpenPrice   flexString `json:"open_price"`
	Change      flexString `json:"change"`
}

type rawHistory struct {
	OrderID     flexString `json:"order_id"`
	Price       flexString `json:"price"`
	BaseVolume  flexString `json:"base_volume"`
	QuoteVolume flexString `json:"quote_volume"`
	ExecutedAt  string     `json:"executed_at"`
	OrderType   string     `json:"order_type"`
	Maker       string     `json:"maker"`
	Taker       string     `json:"taker"`
}

type rawCandle struct {
	Time  flexString `json:"time"`
	Low   flexString `json:"low"`
	Open  flexString `json:"open"`
	High  flexString `json:"high"`
	Close flexString `json:"close"`
	Value flexString `json:"value"`
}

// --- pure parsers (fixture-testable, no HTTP) -------------------------------

func parseTickers(data []byte) ([]rawTicker, error) {
	var out []rawTicker
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("parse tickers: %w", err)
	}
	return out, nil
}

func parseHistory(data []byte) ([]Trade, error) {
	var raw []rawHistory
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse history: %w", err)
	}
	trades := make([]Trade, 0, len(raw))
	for _, r := range raw {
		trades = append(trades, Trade{
			OrderId:     r.OrderID.String(),
			Price:       r.Price.String(),
			BaseVolume:  r.BaseVolume.String(),
			QuoteVolume: r.QuoteVolume.String(),
			ExecutedAt:  r.ExecutedAt,
			OrderType:   r.OrderType,
			Maker:       r.Maker,
			Taker:       r.Taker,
		})
	}
	return trades, nil
}

func parseCandles(data []byte) ([]Candle, error) {
	var raw []rawCandle
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse candles: %w", err)
	}
	candles := make([]Candle, 0, len(raw))
	for _, r := range raw {
		candles = append(candles, Candle{
			Time:  r.Time.String(),
			Open:  r.Open.String(),
			High:  r.High.String(),
			Low:   r.Low.String(),
			Close: r.Close.String(),
			Value: r.Value.String(),
		})
	}
	return candles, nil
}

func (r rawTicker) stats() MarketStats {
	return MarketStats{
		LastPrice:   r.LastPrice.String(),
		BaseVolume:  r.BaseVolume.String(),
		QuoteVolume: r.QuoteVolume.String(),
		Bid:         r.Bid.String(),
		Ask:         r.Ask.String(),
		High:        r.High.String(),
		Low:         r.Low.String(),
		OpenPrice:   r.OpenPrice.String(),
		Change:      r.Change.String(),
	}
}

// --- HTTP methods -----------------------------------------------------------

func (a *Aggregator) get(path string) ([]byte, error) {
	resp, err := a.http.Get(a.host + path)
	if err != nil {
		return nil, fmt.Errorf("aggregator GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("aggregator GET %s: status %d", path, resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("aggregator read %s: %w", path, err)
	}
	return body, nil
}

// tickers fetches every market/pool ticker from /api/dex/tickers.
func (a *Aggregator) tickers() ([]rawTicker, error) {
	body, err := a.get("/api/dex/tickers")
	if err != nil {
		return nil, err
	}
	return parseTickers(body)
}

// MarketHistory returns recent trades for a market from /api/dex/history.
func (a *Aggregator) MarketHistory(marketId string) ([]Trade, error) {
	path := fmt.Sprintf("/api/dex/history?market_id=%s&limit=%d", url.QueryEscape(marketId), historyLimit)
	body, err := a.get(path)
	if err != nil {
		return nil, err
	}
	return parseHistory(body)
}

// AddressMarketHistory returns a specific address's trades on a market.
func (a *Aggregator) AddressMarketHistory(marketId, address string) ([]Trade, error) {
	path := fmt.Sprintf("/api/dex/history?address=%s&market_id=%s&limit=%d",
		url.QueryEscape(address), url.QueryEscape(marketId), addressHistoryLimit)
	body, err := a.get(path)
	if err != nil {
		return nil, err
	}
	return parseHistory(body)
}

// Candles returns TradingView-shaped candles for a market at the given interval
// (minutes) and count (limit) from /api/dex/intervals.
func (a *Aggregator) Candles(marketId string, minutes, limit int) ([]Candle, error) {
	path := fmt.Sprintf("/api/dex/intervals?market_id=%s&minutes=%d&limit=%d&format=tv",
		url.QueryEscape(marketId), minutes, limit)
	body, err := a.get(path)
	if err != nil {
		return nil, err
	}
	return parseCandles(body)
}

// PoolsStats returns per-pool 24h stats. The aggregator's /api/dex/tickers
// carries both order-book markets and liquidity pools; a ticker is a pool when
// its market_id is NOT the order-book id (base/quote) — pools key by base_quote
// (createPoolId). Mirrors the web doUpdateLiquidityPools ticker filter.
func (a *Aggregator) PoolsStats() ([]PoolStat, error) {
	raw, err := a.tickers()
	if err != nil {
		return nil, err
	}
	return poolStatsFromTickers(raw), nil
}

func poolStatsFromTickers(raw []rawTicker) []PoolStat {
	pools := make([]PoolStat, 0)
	for _, t := range raw {
		if t.MarketID == MarketId(t.Base, t.Quote) {
			// order-book market, not a pool
			continue
		}
		pools = append(pools, PoolStat{
			PoolId:      t.MarketID,
			Base:        t.Base,
			Quote:       t.Quote,
			LastPrice:   t.LastPrice.String(),
			BaseVolume:  t.BaseVolume.String(),
			QuoteVolume: t.QuoteVolume.String(),
			Change:      t.Change.String(),
		})
	}
	return pools
}

// MergeMarketStats joins order-book markets with their aggregator ticker stats
// by market id. When tickers is empty (aggregator down), every market comes back
// with StatsAvailable=false — never an error. Port of the web marketsMap +
// marketsDataMap join.
func MergeMarketStats(markets []Market, tickers []rawTicker) []MarketWithStats {
	byId := make(map[string]rawTicker, len(tickers))
	for _, t := range tickers {
		byId[t.MarketID] = t
	}
	out := make([]MarketWithStats, 0, len(markets))
	for _, m := range markets {
		mws := MarketWithStats{
			MarketId: m.MarketId,
			Base:     m.Base,
			Quote:    m.Quote,
			Creator:  m.Creator,
		}
		if t, ok := byId[m.MarketId]; ok {
			stats := t.stats()
			mws.Stats = &stats
			mws.StatsAvailable = true
		}
		out = append(out, mws)
	}
	return out
}

// FetchMarketsWithStats fetches order-book markets from the node and merges 24h
// stats from the aggregator. A node failure is a hard error; an aggregator
// failure is swallowed (markets list with stats unavailable), honoring the
// graceful-degradation rule.
func FetchMarketsWithStats(rest RestClient, agg *Aggregator) ([]MarketWithStats, error) {
	markets, err := FetchMarkets(rest)
	if err != nil {
		return nil, err
	}
	tickers, err := agg.tickers()
	if err != nil {
		// aggregator down — return markets without stats, not an error
		return MergeMarketStats(markets, nil), nil
	}
	return MergeMarketStats(markets, tickers), nil
}
