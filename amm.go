package main

import (
	"fmt"

	"github.com/bze-alphateam/bze-hub/internal/amm"
)

// GetLiquidityPools returns every tradebin liquidity pool (base/quote, reserves,
// fee, pool id, lp denom). Bound to the frontend via Wails. Pools are fetched
// fresh from the chain REST proxy on each call — the set is small and this keeps
// swap quotes off any stale cache.
func (a *App) GetLiquidityPools() ([]amm.Pool, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}
	return amm.FetchLiquidityPools(a.chainClient)
}

// QuoteSwap computes the best multi-hop swap route from denomIn to denomOut for
// amountIn (in base units), identical to the web dapp's AMM router. The returned
// SwapQuote's Routes field is directly usable as the routes of a tradebin
// MsgMultiSwap. A missing route (unknown/same denom, or zero liquidity) comes
// back as a NoRoute quote, not an error. Bound to the frontend via Wails.
func (a *App) QuoteSwap(denomIn, denomOut, amountIn string) (amm.SwapQuote, error) {
	if a.chainClient == nil {
		return amm.SwapQuote{}, fmt.Errorf("chain client not initialized")
	}
	pools, err := amm.FetchLiquidityPools(a.chainClient)
	if err != nil {
		return amm.SwapQuote{}, err
	}
	return amm.Quote(pools, denomIn, denomOut, amountIn)
}
