// Package amm is the Go-side equivalent of the web ui-kit's AMM layer for BZE
// Hub. It queries the tradebin module's liquidity pools over the REST proxy and
// ports the web AmmRouter (packages/ui-kit/src/service/amm_router.ts) so the hub
// computes multi-hop swap quotes identical to the web dapp.
package amm

import "fmt"

// poolsPath is the tradebin AllLiquidityPools REST endpoint. The limit mirrors
// the web query client (DEFAULT_LIMIT = 1000 in query/liquidity_pools.ts); the
// chain has far fewer pools than that.
const poolsPath = "/bze/tradebin/all_liquidity_pools?pagination.limit=1000"

// RestClient is the subset of the chain REST proxy this package needs. The
// production implementation is *chain.Client; tests supply a stub.
type RestClient interface {
	// RestGet fetches a REST endpoint and returns the parsed JSON object.
	RestGet(path string) (map[string]interface{}, error)
}

// Pool is a tradebin liquidity pool as returned by the chain. Field names and
// shapes mirror the web LiquidityPoolSDKType so the router logic ports directly.
// Amounts are kept as strings (chain-native: reserves are integers, Fee is a
// decimal string) and parsed with exact big-number math by the router.
type Pool struct {
	ID           string `json:"id"`
	Base         string `json:"base"`
	Quote        string `json:"quote"`
	LPDenom      string `json:"lpDenom"`
	Creator      string `json:"creator"`
	Fee          string `json:"fee"`
	// FeeProviders is the fraction of Fee routed to liquidity providers
	// (fee_dest.providers on the chain pool). The frontend uses it to compute
	// pool APR the same way the web does; "" when the pool has no fee split.
	FeeProviders string `json:"feeProviders"`
	ReserveBase  string `json:"reserveBase"`
	ReserveQuote string `json:"reserveQuote"`
	Stable       bool   `json:"stable"`
}

// FetchLiquidityPools returns every tradebin liquidity pool. It is the Go
// equivalent of the web getLiquidityPools() and returns the raw pool list; the
// router consumes it and the frontend can display it.
//
// Note: the tradebin LiquidityPool has no literal "total shares" field — total
// shares is the bank supply of LPDenom. LPDenom is returned so a caller that
// needs the share supply can query it; fetching it per pool is left to pool-stats
// work (BHUB-12) to avoid an extra REST call per pool on the swap path.
func FetchLiquidityPools(rest RestClient) ([]Pool, error) {
	resp, err := rest.RestGet(poolsPath)
	if err != nil {
		return nil, fmt.Errorf("query liquidity pools: %w", err)
	}
	list := asSlice(resp["list"])
	pools := make([]Pool, 0, len(list))
	for _, item := range list {
		m, ok := asMap(item)
		if !ok {
			continue
		}
		pool := Pool{
			ID:           asString(m["id"]),
			Base:         asString(m["base"]),
			Quote:        asString(m["quote"]),
			LPDenom:      asString(m["lp_denom"]),
			Creator:      asString(m["creator"]),
			Fee:          asString(m["fee"]),
			ReserveBase:  asString(m["reserve_base"]),
			ReserveQuote: asString(m["reserve_quote"]),
		}
		if feeDest, ok := asMap(m["fee_dest"]); ok {
			pool.FeeProviders = asString(feeDest["providers"])
		}
		pool.Stable, _ = m["stable"].(bool)
		pools = append(pools, pool)
	}
	return pools, nil
}

// --- untyped-JSON helpers (mirrors internal/assets) -------------------------

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
