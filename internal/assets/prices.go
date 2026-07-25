package assets

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DefaultPriceURL is the BZE aggregator prices endpoint (same source the web
// apps use via NEXT_PUBLIC_AGG_API_HOST). It returns an array of
// {denom, price, price_denom} entries where denom is a coingecko-style id.
const DefaultPriceURL = "https://getbze.com/api/prices"

// priceTTL is how long a fetched price set is considered fresh. Matches the web
// (5 minutes); stale prices are served while a refresh runs, never blocking.
const priceTTL = 5 * time.Minute

// usdPriceDenom is the aggregator's price_denom for USD-quoted prices.
const usdPriceDenom = "usd"

// aggPrice is one entry of the aggregator /api/prices response.
type aggPrice struct {
	Denom      string  `json:"denom"`       // coingecko id, e.g. "bzedge"
	Price      float64 `json:"price"`       // price in price_denom
	PriceDenom string  `json:"price_denom"` // e.g. "usd"
}

// fetchAggregatorPrices GETs and decodes the aggregator price array. Any failure
// (network, non-200, bad JSON) is returned as an error so callers keep their
// current (possibly stale) prices.
func fetchAggregatorPrices(client *http.Client, url string) ([]aggPrice, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("fetch prices: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch prices: status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // 4 MiB cap
	if err != nil {
		return nil, fmt.Errorf("read prices: %w", err)
	}

	var out []aggPrice
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("parse prices: %w", err)
	}
	return out, nil
}

// indexUSDPrices reduces the aggregator response to a lowercased coingecko-id →
// USD price map, keeping only positive USD-quoted entries. The mapping from a
// coingecko id to a concrete BZE on-chain denom happens later, per asset (see
// Engine.priceForAsset), because an asset's on-chain denom (e.g. an ibc/<hash>
// voucher) differs from its origin-chain registry base.
func indexUSDPrices(raw []aggPrice) map[string]float64 {
	byID := make(map[string]float64, len(raw))
	for _, p := range raw {
		if !strings.EqualFold(p.PriceDenom, usdPriceDenom) {
			continue
		}
		if p.Price <= 0 {
			continue
		}
		byID[strings.ToLower(p.Denom)] = p.Price
	}
	return byID
}

// priceStore holds the latest coingecko-id → USD price map with the time it was
// fetched. Safe for concurrent use; the map is only ever replaced, never mutated.
type priceStore struct {
	mu        sync.RWMutex
	byID      map[string]float64
	fetchedAt time.Time
}

func newPriceStore() *priceStore {
	return &priceStore{byID: map[string]float64{}}
}

// set replaces the price map and records the fetch time.
func (s *priceStore) set(byID map[string]float64, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byID = byID
	s.fetchedAt = at
}

// priceForID returns the USD price for a coingecko id (case-insensitive),
// ok=false if unknown.
func (s *priceStore) priceForID(coingeckoID string) (float64, bool) {
	if coingeckoID == "" {
		return 0, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.byID[strings.ToLower(coingeckoID)]
	return p, ok
}

// size returns the number of known prices (used by tests/logging).
func (s *priceStore) size() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.byID)
}

// needsRefresh reports whether the store is empty or older than ttl at time now.
// Pure and time-injected so the TTL policy is unit-testable without sleeps.
func (s *priceStore) needsRefresh(now time.Time, ttl time.Duration) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.byID) == 0 || s.fetchedAt.IsZero() {
		return true
	}
	return now.Sub(s.fetchedAt) >= ttl
}

// formatPrice renders a USD unit price as a minimal decimal string for the
// frontend (which re-parses it with BigNumber).
func formatPrice(p float64) string {
	return strconv.FormatFloat(p, 'f', -1, 64)
}
