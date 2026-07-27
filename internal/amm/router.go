package amm

import "sort"

// Router computes multi-hop swap quotes over a set of liquidity pools. It is a
// port of the web AmmRouter (packages/ui-kit/src/service/amm_router.ts): an
// undirected adjacency map over pools plus a best-amount graph search. The
// per-route caching the web keeps is intentionally omitted — quotes are computed
// on demand from fresh pool data, so a stale cache can never make hub and web
// disagree.
type Router struct {
	routeMap map[string]*orderedNeighbors
}

// poolInfo is a pool with its numeric fields pre-parsed into exact decimals.
type poolInfo struct {
	id           string
	base         string
	quote        string
	fee          dec
	reserveBase  dec
	reserveQuote dec
}

// neighbor is one edge of the adjacency map: the pool reachable and the
// counterparty denom it leads to.
type neighbor struct {
	denom string
	pool  poolInfo
}

// orderedNeighbors keeps neighbors keyed by denom (last pool for a pair wins,
// matching the web Map.set) while preserving first-seen insertion order, so the
// search visits edges in the same order as the web routeMap and ties break
// identically.
type orderedNeighbors struct {
	order   []string
	byDenom map[string]poolInfo
}

func newOrderedNeighbors() *orderedNeighbors {
	return &orderedNeighbors{byDenom: map[string]poolInfo{}}
}

func (o *orderedNeighbors) set(denom string, p poolInfo) {
	if _, ok := o.byDenom[denom]; !ok {
		o.order = append(o.order, denom)
	}
	o.byDenom[denom] = p
}

func (o *orderedNeighbors) entries() []neighbor {
	out := make([]neighbor, 0, len(o.order))
	for _, d := range o.order {
		out = append(out, neighbor{denom: d, pool: o.byDenom[d]})
	}
	return out
}

// NewRouter builds a router over the given pools.
func NewRouter(pools []Pool) *Router {
	r := &Router{}
	r.UpdatePools(pools)
	return r
}

// UpdatePools rebuilds the adjacency map from pools. Pools whose numeric fields
// fail to parse are skipped (chain data is always well-formed; this is
// defensive). Mirrors the web updatePools.
func (r *Router) UpdatePools(pools []Pool) {
	rm := map[string]*orderedNeighbors{}
	add := func(from, to string, p poolInfo) {
		on := rm[from]
		if on == nil {
			on = newOrderedNeighbors()
			rm[from] = on
		}
		on.set(to, p)
	}
	for _, p := range pools {
		info, ok := toPoolInfo(p)
		if !ok {
			continue
		}
		add(info.base, info.quote, info)
		add(info.quote, info.base, info)
	}
	r.routeMap = rm
}

func toPoolInfo(p Pool) (poolInfo, bool) {
	fee, err := newDec(p.Fee)
	if err != nil {
		return poolInfo{}, false
	}
	rb, err := newDec(p.ReserveBase)
	if err != nil {
		return poolInfo{}, false
	}
	rq, err := newDec(p.ReserveQuote)
	if err != nil {
		return poolInfo{}, false
	}
	return poolInfo{
		id:           p.ID,
		base:         p.Base,
		quote:        p.Quote,
		fee:          fee,
		reserveBase:  rb,
		reserveQuote: rq,
	}, true
}

// SwapRouteResult is a computed route. Numeric fields are decimal strings (exact,
// matching the web BigNumber values). Route holds pool ids in the order they are
// traversed — directly usable as the routes of a tradebin MsgMultiSwap.
type SwapRouteResult struct {
	Route       []string `json:"route"`
	Path        []string `json:"path"`
	ExpectedOut string   `json:"expectedOut"`
	PriceImpact string   `json:"priceImpact"`
	TotalFees   string   `json:"totalFees"`
	FeesPerHop  []string `json:"feesPerHop"`
}

type routeNode struct {
	denom  string
	amount dec
	path   []string
	pools  []poolInfo
	fees   []dec
	hops   int
}

// FindOptimalRoute searches for the route from fromDenom to toDenom that yields
// the most output for amountIn, exploring up to maxHops. It returns ok=false when
// no route exists (including from==to or zero liquidity). Port of the web
// findOptimalRoute / findOptimalSwapRoute.
func (r *Router) FindOptimalRoute(fromDenom, toDenom string, amountIn dec, maxHops int) (SwapRouteResult, bool) {
	if fromDenom == toDenom {
		return SwapRouteResult{}, false
	}

	queue := []routeNode{{
		denom:  fromDenom,
		amount: amountIn,
		path:   []string{fromDenom},
		pools:  nil,
		fees:   nil,
		hops:   0,
	}}

	bestAmounts := map[string]dec{fromDenom: amountIn}
	var bestRoute *routeNode

	for len(queue) > 0 {
		// Re-sort by amount descending (stable, so ties keep insertion order —
		// matching the web's stable Array.sort) and take the best-so-far node.
		sort.SliceStable(queue, func(i, j int) bool {
			return queue[i].amount.cmp(queue[j].amount) > 0
		})
		current := queue[0]
		queue = queue[1:]

		if current.denom == toDenom {
			if bestRoute == nil || current.amount.gt(bestRoute.amount) {
				c := current
				bestRoute = &c
			}
			continue
		}

		if current.hops >= maxHops {
			continue
		}

		neighbors := r.routeMap[current.denom]
		if neighbors == nil {
			continue
		}

		for _, n := range neighbors.entries() {
			nextDenom := n.denom
			if contains(current.path, nextDenom) {
				continue
			}

			isBaseToQuote := n.pool.base == current.denom
			amountOut, fee, ok := calculateSwapOutput(n.pool, current.amount, isBaseToQuote)
			if !ok || amountOut.sign() <= 0 {
				continue
			}

			if prev, seen := bestAmounts[nextDenom]; seen && amountOut.lte(prev) {
				continue
			}
			bestAmounts[nextDenom] = amountOut

			next := routeNode{
				denom:  nextDenom,
				amount: amountOut,
				path:   append(appendCopy(current.path), nextDenom),
				pools:  append(appendCopyPools(current.pools), n.pool),
				fees:   append(appendCopyDecs(current.fees), fee),
				hops:   current.hops + 1,
			}
			queue = append(queue, next)
		}
	}

	if bestRoute == nil {
		return SwapRouteResult{}, false
	}

	withoutFees, withFees := calculateTheoreticalOutputs(bestRoute.pools, bestRoute.path, amountIn)
	totalFees := withoutFees.sub(withFees)

	priceImpact := decInt(0)
	if !withFees.isZero() {
		// (theoreticalWithFees - expectedOut) / theoreticalWithFees * 100
		impact, err := withFees.sub(bestRoute.amount).quo(withFees)
		if err == nil {
			priceImpact = impact.mul(decInt(100))
		}
	}

	route := make([]string, len(bestRoute.pools))
	for i, p := range bestRoute.pools {
		route[i] = p.id
	}
	fees := make([]string, len(bestRoute.fees))
	for i, f := range bestRoute.fees {
		fees[i] = f.text()
	}

	return SwapRouteResult{
		Route:       route,
		Path:        bestRoute.path,
		ExpectedOut: bestRoute.amount.text(),
		PriceImpact: priceImpact.text(),
		TotalFees:   totalFees.text(),
		FeesPerHop:  fees,
	}, true
}

// calculateSwapOutput computes the constant-product output of a single hop with
// the pool fee applied, plus the fee amount taken. Port of the web
// calculateSwapOutput:
//
//	feeAmount        = amountIn * fee
//	amountInAfterFee = amountIn - feeAmount
//	amountOut        = amountInAfterFee * reserveOut / (reserveIn + amountInAfterFee)
//
// ok=false signals the pool cannot produce output (a reserve is zero, i.e. no
// liquidity) — the web never guards this because real pools always hold both
// reserves; guarding here keeps a degenerate/empty pool from panicking on a
// zero divisor and routes around it, honoring "zero liquidity → no route".
func calculateSwapOutput(pool poolInfo, amountIn dec, isBaseToQuote bool) (amountOut dec, fee dec, ok bool) {
	reserveIn, reserveOut := pool.reserveQuote, pool.reserveBase
	if isBaseToQuote {
		reserveIn, reserveOut = pool.reserveBase, pool.reserveQuote
	}
	if reserveIn.isZero() || reserveOut.isZero() {
		return dec{}, dec{}, false
	}

	feeAmount := amountIn.mul(pool.fee)
	amountInAfterFee := amountIn.sub(feeAmount)

	out, err := amountInAfterFee.mul(reserveOut).quo(reserveIn.add(amountInAfterFee))
	if err != nil {
		return dec{}, dec{}, false
	}
	return out, feeAmount, true
}

// calculateTheoreticalOutputs computes the fee-free and fee-only outputs along a
// route using each hop's mid-price (reserveOut/reserveIn). The gap between them
// is the total fee; the gap between the fee-inclusive theoretical output and the
// actual constant-product output is the price impact. Port of the web
// calculateTheoreticalOutputs.
func calculateTheoreticalOutputs(pools []poolInfo, path []string, amountIn dec) (withoutFees, withFees dec) {
	withoutFees = amountIn
	withFees = amountIn
	one := decInt(1)

	for i, pool := range pools {
		currentDenom := path[i]
		isBaseToQuote := pool.base == currentDenom

		reserveIn, reserveOut := pool.reserveQuote, pool.reserveBase
		if isBaseToQuote {
			reserveIn, reserveOut = pool.reserveBase, pool.reserveQuote
		}
		midPrice, err := reserveOut.quo(reserveIn)
		if err != nil {
			// reserveIn == 0; a chosen route never contains such a hop
			// (calculateSwapOutput rejects zero-reserve pools), so this is
			// unreachable in practice. Skip the hop rather than panic.
			continue
		}

		withoutFees = withoutFees.mul(midPrice)
		withFees = withFees.mul(one.sub(pool.fee)).mul(midPrice)
	}
	return withoutFees, withFees
}

func contains(ss []string, s string) bool {
	for _, v := range ss {
		if v == s {
			return true
		}
	}
	return false
}

// appendCopy / appendCopyPools / appendCopyDecs return a fresh copy of the slice
// so branching route nodes never share backing arrays (the web builds new arrays
// per branch with the spread operator).
func appendCopy(ss []string) []string {
	out := make([]string, len(ss), len(ss)+1)
	copy(out, ss)
	return out
}

func appendCopyPools(ps []poolInfo) []poolInfo {
	out := make([]poolInfo, len(ps), len(ps)+1)
	copy(out, ps)
	return out
}

func appendCopyDecs(ds []dec) []dec {
	out := make([]dec, len(ds), len(ds)+1)
	copy(out, ds)
	return out
}
