package amm

// MaxHops is the maximum number of pools a swap route may traverse. Matches the
// web dapp, which calls findOptimalRoute with maxHops = 3.
const MaxHops = 3

// SwapQuote is the result of QuoteSwap, shaped for the frontend. Routes holds the
// pool ids in traversal order and is directly usable as the `routes` field of a
// tradebin MsgMultiSwap. When no route exists (unknown denoms, same denom, or
// zero liquidity) NoRoute is true and the remaining fields are empty — this is a
// typed result, never an error.
type SwapQuote struct {
	NoRoute     bool     `json:"noRoute"`
	Routes      []string `json:"routes"`
	Path        []string `json:"path"`
	ExpectedOut string   `json:"expectedOut"`
	PriceImpact string   `json:"priceImpact"`
	TotalFees   string   `json:"totalFees"`
	FeesPerHop  []string `json:"feesPerHop"`
}

// Quote finds the best swap route for amountIn (in base units) from denomIn to
// denomOut over the given pools and returns a SwapQuote. It errors only on a
// malformed amountIn; a missing route yields a NoRoute quote. Mirrors the web
// path of updatePools() followed by findOptimalRoute(..., 3).
func Quote(pools []Pool, denomIn, denomOut, amountIn string) (SwapQuote, error) {
	amt, err := newDec(amountIn)
	if err != nil {
		return SwapQuote{}, err
	}
	if amt.sign() <= 0 {
		return SwapQuote{NoRoute: true}, nil
	}

	router := NewRouter(pools)
	result, ok := router.FindOptimalRoute(denomIn, denomOut, amt, MaxHops)
	if !ok {
		return SwapQuote{NoRoute: true}, nil
	}

	return SwapQuote{
		Routes:      result.Route,
		Path:        result.Path,
		ExpectedOut: result.ExpectedOut,
		PriceImpact: result.PriceImpact,
		TotalFees:   result.TotalFees,
		FeesPerHop:  result.FeesPerHop,
	}, nil
}
