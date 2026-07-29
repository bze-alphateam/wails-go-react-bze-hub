package amm

import (
	"math/big"
	"reflect"
	"testing"
)

// --- decimal engine ---------------------------------------------------------

// TestRoundRatHalfAwayFromZero locks the rounding mode to bignumber.js's default
// ROUND_HALF_UP (nearest, ties away from zero) — the basis of quote parity.
func TestRoundRatHalfAwayFromZero(t *testing.T) {
	cases := []struct {
		num, den int64
		dp       int
		want     string
	}{
		{1, 2, 0, "1"},   // 0.5 -> 1
		{3, 2, 0, "2"},   // 1.5 -> 2
		{-1, 2, 0, "-1"}, // -0.5 -> -1
		{-3, 2, 0, "-2"}, // -1.5 -> -2
		{1, 3, 0, "0"},   // 0.333 -> 0
		{2, 3, 0, "1"},   // 0.667 -> 1
	}
	for _, c := range cases {
		got := roundRat(big.NewRat(c.num, c.den), c.dp).RatString()
		if got != c.want {
			t.Errorf("roundRat(%d/%d, dp=%d) = %s, want %s", c.num, c.den, c.dp, got, c.want)
		}
	}
}

// TestRoundRatTie confirms the ties-away-from-zero direction at a non-zero dp.
func TestRoundRatTie(t *testing.T) {
	// 1.25 to 1 dp: the dropped part is exactly 0.05 (a tie) -> up to 1.3.
	if got := roundRat(big.NewRat(5, 4), 1).RatString(); got != "13/10" {
		t.Errorf("roundRat(1.25, dp=1) = %s, want 13/10", got)
	}
	// 1.35 to 1 dp: tie -> 1.4.
	if got := roundRat(big.NewRat(27, 20), 1).RatString(); got != "7/5" { // 1.4 = 7/5
		t.Errorf("roundRat(1.35, dp=1) = %s, want 7/5", got)
	}
}

// TestQuoRoundsTo20dp verifies division rounds to 20 decimal places like the web.
func TestQuoRoundsTo20dp(t *testing.T) {
	cases := []struct {
		a, b, want string
	}{
		{"1", "3", "0.33333333333333333333"}, // 21st digit 3 -> stays
		{"2", "3", "0.66666666666666666667"}, // 21st digit 6 -> rounds up
		{"1", "4", "0.25"},
		{"1", "8", "0.125"},
		{"10", "4", "2.5"},
	}
	for _, c := range cases {
		a, _ := newDec(c.a)
		b, _ := newDec(c.b)
		got, err := a.quo(b)
		if err != nil {
			t.Fatalf("%s/%s: %v", c.a, c.b, err)
		}
		if got.text() != c.want {
			t.Errorf("%s/%s = %s, want %s", c.a, c.b, got.text(), c.want)
		}
	}
}

// TestQuoByZero ensures division by zero is a reported error, not a panic.
func TestQuoByZero(t *testing.T) {
	a, _ := newDec("1")
	z, _ := newDec("0")
	if _, err := a.quo(z); err == nil {
		t.Fatal("expected division-by-zero error")
	}
}

func TestDecText(t *testing.T) {
	cases := []struct{ in, want string }{
		{"500", "500"},
		{"0", "0"},
		{"-0.5", "-0.5"},
		{"1.2500", "1.25"},
		{"0.100", "0.1"},
	}
	for _, c := range cases {
		d, err := newDec(c.in)
		if err != nil {
			t.Fatalf("newDec(%q): %v", c.in, err)
		}
		if d.text() != c.want {
			t.Errorf("text(%q) = %s, want %s", c.in, d.text(), c.want)
		}
	}
}

// --- router -----------------------------------------------------------------

// pool is a terse test helper for building a Pool.
func pool(id, base, quote, fee, reserveBase, reserveQuote string) Pool {
	return Pool{
		ID:           id,
		Base:         base,
		Quote:        quote,
		Fee:          fee,
		ReserveBase:  reserveBase,
		ReserveQuote: reserveQuote,
	}
}

// TestQuote covers the router with hand-computed constant-product fixtures. The
// web AmmRouter has no tests, so every expected value here is derived by hand
// from out = amountInAfterFee*reserveOut/(reserveIn+amountInAfterFee).
func TestQuote(t *testing.T) {
	tests := []struct {
		name       string
		pools      []Pool
		in, out    string
		amountIn   string
		wantRoutes []string
		wantPath   []string
		wantOut    string
		wantImpact string
		wantFees   string   // totalFees (theoretical mid-price fee)
		wantPerHop []string // feesPerHop (actual input fee amounts)
	}{
		{
			// Single hop, no fee. out = 1000*1000/(1000+1000) = 500.
			// midPrice = 1; withoutFees = withFees = 1000; impact = (1000-500)/1000*100 = 50.
			name:       "single hop no fee",
			pools:      []Pool{pool("1", "A", "B", "0", "1000", "1000")},
			in:         "A",
			out:        "B",
			amountIn:   "1000",
			wantRoutes: []string{"1"},
			wantPath:   []string{"A", "B"},
			wantOut:    "500",
			wantImpact: "50",
			wantFees:   "0",
			wantPerHop: []string{"0"},
		},
		{
			// Fee 20%. feeAmount = 100*0.2 = 20; amountInAfterFee = 80.
			// out = 80*100/(20+80) = 80. midPrice = 100/20 = 5.
			// withoutFees = 100*5 = 500; withFees = 100*0.8*5 = 400.
			// totalFees = 100; impact = (400-80)/400*100 = 80.
			name:       "fee math single hop",
			pools:      []Pool{pool("7", "A", "B", "0.2", "20", "100")},
			in:         "A",
			out:        "B",
			amountIn:   "100",
			wantRoutes: []string{"7"},
			wantPath:   []string{"A", "B"},
			wantOut:    "80",
			wantImpact: "80",
			wantFees:   "100",
			wantPerHop: []string{"20"},
		},
		{
			// 2-hop A->B->C (out 4500) must beat the worse direct A->C (out 500).
			// Hop1 A->B: 1000*9000/(1000+1000) = 4500.
			// Hop2 B->C: 4500*9000/(4500+4500) = 4500.
			// Direct A->C: 1000*1000/(1000+1000) = 500.
			// midPrices 9 and 2; withoutFees = withFees = 1000*9*2 = 18000.
			// impact = (18000-4500)/18000*100 = 75.
			name: "two hop beats worse direct",
			pools: []Pool{
				pool("10", "A", "B", "0", "1000", "9000"),
				pool("11", "B", "C", "0", "4500", "9000"),
				pool("12", "A", "C", "0", "1000", "1000"),
			},
			in:         "A",
			out:        "C",
			amountIn:   "1000",
			wantRoutes: []string{"10", "11"},
			wantPath:   []string{"A", "B", "C"},
			wantOut:    "4500",
			wantImpact: "75",
			wantFees:   "0",
			wantPerHop: []string{"0", "0"},
		},
		{
			// Repeating decimal exercises the 20-dp rounding on the swap path.
			// out = 1*1/(2+1) = 1/3 = 0.333...(20 threes).
			// midPrice = 1/2 = 0.5; withoutFees = withFees = 0.5.
			// impact = (0.5 - 0.333...33)/0.5*100 = 33.333...34.
			name:       "repeating decimal rounds to 20dp",
			pools:      []Pool{pool("3", "A", "B", "0", "2", "1")},
			in:         "A",
			out:        "B",
			amountIn:   "1",
			wantRoutes: []string{"3"},
			wantPath:   []string{"A", "B"},
			wantOut:    "0.33333333333333333333",
			wantImpact: "33.333333333333333334",
			wantFees:   "0",
			wantPerHop: []string{"0"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q, err := Quote(tt.pools, tt.in, tt.out, tt.amountIn)
			if err != nil {
				t.Fatalf("Quote: %v", err)
			}
			if q.NoRoute {
				t.Fatal("expected a route, got NoRoute")
			}
			if !reflect.DeepEqual(q.Routes, tt.wantRoutes) {
				t.Errorf("routes = %v, want %v", q.Routes, tt.wantRoutes)
			}
			if !reflect.DeepEqual(q.Path, tt.wantPath) {
				t.Errorf("path = %v, want %v", q.Path, tt.wantPath)
			}
			if q.ExpectedOut != tt.wantOut {
				t.Errorf("expectedOut = %s, want %s", q.ExpectedOut, tt.wantOut)
			}
			if q.PriceImpact != tt.wantImpact {
				t.Errorf("priceImpact = %s, want %s", q.PriceImpact, tt.wantImpact)
			}
			if q.TotalFees != tt.wantFees {
				t.Errorf("totalFees = %s, want %s", q.TotalFees, tt.wantFees)
			}
			if !reflect.DeepEqual(q.FeesPerHop, tt.wantPerHop) {
				t.Errorf("feesPerHop = %v, want %v", q.FeesPerHop, tt.wantPerHop)
			}
		})
	}
}

// TestQuoteNoRoute covers every typed "no route" path — none may be an error.
func TestQuoteNoRoute(t *testing.T) {
	ab := []Pool{pool("1", "A", "B", "0", "1000", "1000")}
	tests := []struct {
		name     string
		pools    []Pool
		in, out  string
		amountIn string
	}{
		{"unknown destination denom", ab, "A", "Z", "1000"},
		{"unknown source denom", ab, "Z", "B", "1000"},
		{"same denom", ab, "A", "A", "1000"},
		{"empty pool set", nil, "A", "B", "1000"},
		{"zero amount", ab, "A", "B", "0"},
		{"zero liquidity", []Pool{pool("9", "A", "B", "0", "0", "1000")}, "A", "B", "1000"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q, err := Quote(tt.pools, tt.in, tt.out, tt.amountIn)
			if err != nil {
				t.Fatalf("Quote: %v", err)
			}
			if !q.NoRoute {
				t.Fatalf("expected NoRoute, got %+v", q)
			}
			if q.Routes != nil {
				t.Errorf("expected nil routes, got %v", q.Routes)
			}
		})
	}
}

// TestQuoteInvalidAmountErrors: a malformed amount is the one error case.
func TestQuoteInvalidAmountErrors(t *testing.T) {
	ab := []Pool{pool("1", "A", "B", "0", "1000", "1000")}
	if _, err := Quote(ab, "A", "B", "not-a-number"); err == nil {
		t.Fatal("expected an error for a malformed amount")
	}
}

// TestReverseDirectionQuote checks a swap entered from the quote side (quote ->
// base), exercising the isBaseToQuote=false branch.
func TestReverseDirectionQuote(t *testing.T) {
	// Pool base=A quote=B, reserves 1000/1000, no fee. Swap B->A.
	// reserveIn = reserveQuote = 1000, reserveOut = reserveBase = 1000.
	// out = 1000*1000/(1000+1000) = 500.
	pools := []Pool{pool("1", "A", "B", "0", "1000", "1000")}
	q, err := Quote(pools, "B", "A", "1000")
	if err != nil {
		t.Fatalf("Quote: %v", err)
	}
	if q.NoRoute || q.ExpectedOut != "500" {
		t.Fatalf("got %+v, want expectedOut 500", q)
	}
	if !reflect.DeepEqual(q.Path, []string{"B", "A"}) {
		t.Errorf("path = %v, want [B A]", q.Path)
	}
}

// --- pool query -------------------------------------------------------------

type mockRest struct {
	resp map[string]interface{}
	path string
	err  error
}

func (m *mockRest) RestGet(path string) (map[string]interface{}, error) {
	m.path = path
	if m.err != nil {
		return nil, m.err
	}
	return m.resp, nil
}

// TestFetchLiquidityPools verifies the endpoint used and the parse of a
// tradebin AllLiquidityPools REST response (raw proto-JSON shape).
func TestFetchLiquidityPools(t *testing.T) {
	m := &mockRest{
		resp: map[string]interface{}{
			"list": []interface{}{
				map[string]interface{}{
					"id":            "1",
					"base":          "ubze",
					"quote":         "uvdl",
					"lp_denom":      "amm/1",
					"creator":       "bze1creator",
					"fee":           "0.003000000000000000",
					"reserve_base":  "1000000",
					"reserve_quote": "2000000",
					"stable":        false,
					"fee_dest": map[string]interface{}{
						"providers": "0.800000000000000000",
						"treasury":  "0.100000000000000000",
						"burner":    "0.100000000000000000",
					},
				},
				map[string]interface{}{
					"id":            "2",
					"base":          "uvdl",
					"quote":         "uusdc",
					"lp_denom":      "amm/2",
					"fee":           "0.001000000000000000",
					"reserve_base":  "500",
					"reserve_quote": "500",
					"stable":        true,
				},
			},
		},
	}

	pools, err := FetchLiquidityPools(m)
	if err != nil {
		t.Fatalf("FetchLiquidityPools: %v", err)
	}
	if m.path != poolsPath {
		t.Errorf("path = %q, want %q", m.path, poolsPath)
	}
	if len(pools) != 2 {
		t.Fatalf("got %d pools, want 2", len(pools))
	}

	want0 := Pool{
		ID: "1", Base: "ubze", Quote: "uvdl", LPDenom: "amm/1", Creator: "bze1creator",
		Fee: "0.003000000000000000", FeeProviders: "0.800000000000000000",
		ReserveBase: "1000000", ReserveQuote: "2000000", Stable: false,
	}
	if pools[0] != want0 {
		t.Errorf("pool[0] = %+v, want %+v", pools[0], want0)
	}
	if !pools[1].Stable {
		t.Errorf("pool[1].Stable = false, want true")
	}

	// The parsed pools must drive the router end-to-end.
	q, err := Quote(pools, "ubze", "uvdl", "1000")
	if err != nil {
		t.Fatalf("Quote over fetched pools: %v", err)
	}
	if q.NoRoute || !reflect.DeepEqual(q.Routes, []string{"1"}) {
		t.Errorf("expected route [1], got %+v", q)
	}
}

// TestFetchLiquidityPoolsError propagates REST errors.
func TestFetchLiquidityPoolsError(t *testing.T) {
	m := &mockRest{err: errRest}
	if _, err := FetchLiquidityPools(m); err == nil {
		t.Fatal("expected error to propagate")
	}
}

var errRest = &restError{}

type restError struct{}

func (*restError) Error() string { return "rest boom" }
