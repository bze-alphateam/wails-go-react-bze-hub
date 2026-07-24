package assets

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestIndexUSDPrices(t *testing.T) {
	raw := []aggPrice{
		{Denom: "BzEdge", Price: 0.00046927, PriceDenom: "usd"}, // id lowercased
		{Denom: "osmosis", Price: 0.5, PriceDenom: "usd"},
		{Denom: "bzedge", Price: 999, PriceDenom: "eur"}, // non-USD → dropped
		{Denom: "ghost", Price: 0, PriceDenom: "usd"},    // non-positive → dropped
	}
	m := indexUSDPrices(raw)

	if got := m["bzedge"]; got != 0.00046927 {
		t.Errorf("bzedge = %v, want 0.00046927", got)
	}
	if got := m["osmosis"]; got != 0.5 {
		t.Errorf("osmosis = %v, want 0.5", got)
	}
	if _, ok := m["ghost"]; ok {
		t.Error("zero-price id should be dropped")
	}
	if len(m) != 2 {
		t.Errorf("len = %d, want 2", len(m))
	}
}

// TestPriceForAsset checks the coingecko-id → USD mapping against on-chain denoms,
// including the IBC-voucher and stablecoin cases the naive base-keyed map got wrong.
func TestPriceForAsset(t *testing.T) {
	eng, err := NewEngine(&mockRest{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	eng.prices.set(map[string]float64{"bzedge": 0.0005, "osmosis": 0.5}, time.Now())
	reg := testRegistry(t)

	// Native BZE: registry base == on-chain denom → priced.
	nativeAsset, _ := eng.newResolver().resolve("ubze")
	if got := eng.priceForAsset("ubze", nativeAsset); got != "0.0005" {
		t.Errorf("ubze price = %q, want 0.0005", got)
	}

	// Factory VDL: has a coingecko id but no aggregator price and isn't stable → none.
	uvdl := "factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl"
	vdlAsset, _ := eng.newResolver().resolve(uvdl)
	if got := eng.priceForAsset(uvdl, vdlAsset); got != "" {
		t.Errorf("VDL price = %q, want empty (never $0)", got)
	}

	// Stablecoin USDC: its on-chain denom is the ibc voucher (in StableCoins) with no
	// aggregator price → pinned to $1. Build the resolved IBC asset by hand so we don't
	// depend on live trace REST.
	usdcVoucher := "ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4"
	if !IsStable(usdcVoucher) {
		t.Fatal("test precondition: USDC voucher should be a known stablecoin")
	}
	usdcAsset := Asset{Denom: usdcVoucher, Type: TypeIBC, IBC: &IBCInfo{
		Counterparty: IBCCounterpt{BaseDenom: "uusdc"},
	}}
	if got := eng.priceForAsset(usdcVoucher, usdcAsset); got != "1" {
		t.Errorf("USDC price = %q, want 1 (stable pin)", got)
	}

	// An IBC OSMO voucher resolves to origin base uosmo → coingecko osmosis → priced.
	osmoAsset := Asset{Denom: "ibc/OSMOHASH", Type: TypeIBC, IBC: &IBCInfo{
		Counterparty: IBCCounterpt{BaseDenom: "uosmo"},
	}}
	if got := eng.priceForAsset("ibc/OSMOHASH", osmoAsset); got != "0.5" {
		t.Errorf("OSMO voucher price = %q, want 0.5", got)
	}
	_ = reg
}

func TestPriceStoreTTL(t *testing.T) {
	s := newPriceStore()
	start := time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)

	// Empty store always needs a refresh.
	if !s.needsRefresh(start, priceTTL) {
		t.Fatal("empty store should need refresh")
	}

	s.set(map[string]float64{"bzedge": 0.0005}, start)

	// Within the TTL window: no refresh needed.
	if s.needsRefresh(start.Add(priceTTL-time.Second), priceTTL) {
		t.Error("store within TTL should not need refresh")
	}
	// At/after the TTL boundary: refresh needed.
	if !s.needsRefresh(start.Add(priceTTL), priceTTL) {
		t.Error("store at TTL boundary should need refresh")
	}

	if p, ok := s.priceForID("BZEDGE"); !ok || p != 0.0005 {
		t.Errorf("priceForID(BZEDGE) = %v (ok=%v), want 0.0005", p, ok)
	}
	if _, ok := s.priceForID("unknown"); ok {
		t.Error("unknown id should not be present")
	}
}

func TestRefreshPricesThrottlesAndEmits(t *testing.T) {
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"denom":"bzedge","price":0.0005,"price_denom":"usd"}]`))
	}))
	defer srv.Close()

	var events []string
	eng, err := NewEngine(&mockRest{}, func(event string, _ interface{}) {
		events = append(events, event)
	})
	if err != nil {
		t.Fatal(err)
	}
	eng.SetPriceURL(srv.URL)

	eng.RefreshPrices(nil)
	if hits != 1 {
		t.Fatalf("first refresh hits = %d, want 1", hits)
	}
	if p, ok := eng.prices.priceForID("bzedge"); !ok || p != 0.0005 {
		t.Errorf("bzedge price = %v (ok=%v), want 0.0005", p, ok)
	}
	if eng.prices.size() != 1 {
		t.Errorf("store size = %d, want 1", eng.prices.size())
	}
	if len(events) != 1 || events[0] != UpdatedEvent {
		t.Errorf("events = %v, want one %q", events, UpdatedEvent)
	}

	// A second immediate refresh is within the TTL window → no HTTP hit, no event.
	eng.RefreshPrices(nil)
	if hits != 1 {
		t.Errorf("second refresh hits = %d, want 1 (throttled)", hits)
	}
	if len(events) != 1 {
		t.Errorf("events after throttled refresh = %v, want 1", events)
	}
}

func TestRefreshPricesFailureKeepsCache(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	emitted := false
	eng, err := NewEngine(&mockRest{}, func(string, interface{}) { emitted = true })
	if err != nil {
		t.Fatal(err)
	}
	eng.SetPriceURL(srv.URL)
	eng.RefreshPrices(nil)

	if emitted {
		t.Error("failed price refresh should not emit")
	}
	if eng.prices.size() != 0 {
		t.Error("failed refresh should leave prices empty")
	}
}
