package assets

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/logging"
)

// DefaultRefreshURL is the remote chain-registry snapshot the engine refreshes
// from. It lives in bze-configs alongside the app's remote node config. If the
// file is absent or unreachable the engine keeps its embedded/cached snapshot —
// the refresh is always best-effort.
const DefaultRefreshURL = "https://raw.githubusercontent.com/bze-alphateam/bze-configs/refs/heads/main/bze-hub/assets-registry.json"

// UpdatedEvent is emitted to the frontend after a successful registry refresh.
const UpdatedEvent = "assets:updated"

// Engine is the asset resolution service. It holds a chain-registry snapshot
// (embedded → cache → remote, most recent wins) and resolves denoms against it
// plus live on-chain data via the REST proxy. Safe for concurrent use.
type Engine struct {
	mu       sync.RWMutex
	registry *Registry

	rest       RestClient
	emit       func(event string, data interface{})
	http       *http.Client
	refreshURL string

	prices   *priceStore
	logos    *logoCache
	priceURL string
}

// NewEngine builds an engine that is usable immediately: it loads the embedded
// snapshot synchronously (no network), then prefers an on-disk cache from a prior
// refresh when present. emit may be nil (events are simply not sent).
func NewEngine(rest RestClient, emit func(event string, data interface{})) (*Engine, error) {
	reg, err := LoadEmbedded()
	if err != nil {
		return nil, err
	}
	// A cached snapshot from a previous run overrides the embed. A corrupt or
	// missing cache is ignored — the embed is the guaranteed fallback.
	if cached, err := loadCache(); err != nil {
		logging.Debug("assets", "ignoring unreadable registry cache: %v", err)
	} else if cached != nil {
		reg = cached
		logging.Debug("assets", "loaded registry cache (version %s)", cached.Version)
	}

	client := defaultHTTPClient()
	return &Engine{
		registry:   reg,
		rest:       rest,
		emit:       emit,
		http:       client,
		refreshURL: DefaultRefreshURL,
		prices:     newPriceStore(),
		logos:      newLogoCache(client),
		priceURL:   DefaultPriceURL,
	}, nil
}

// SetRefreshURL overrides the remote snapshot URL (used in tests).
func (e *Engine) SetRefreshURL(url string) { e.refreshURL = url }

// SetPriceURL overrides the aggregator price URL (used in tests).
func (e *Engine) SetPriceURL(url string) { e.priceURL = url }

// snapshot returns the current registry pointer. The pointer is only ever
// replaced (never mutated in place), so callers can use it without holding the
// lock during slow REST calls.
func (e *Engine) snapshot() *Registry {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.registry
}

func (e *Engine) newResolver() *resolver {
	return &resolver{reg: e.snapshot(), rest: e.rest}
}

// Refresh fetches the remote snapshot once and, on success, persists it to the
// cache, swaps it in, and emits UpdatedEvent. On any failure the current snapshot
// is kept and no event is emitted. Intended to be launched in a background
// goroutine so startup never blocks on it.
func (e *Engine) Refresh(ctx context.Context) {
	if e.refreshURL == "" {
		return
	}
	logging.Debug("assets", "refreshing registry from %s", e.refreshURL)

	reg, data, err := fetchRemote(e.refreshURL, e.http)
	if err != nil {
		logging.Info("assets", "registry refresh skipped (using embedded/cache): %v", err)
		return
	}
	if ctx != nil && ctx.Err() != nil {
		return
	}

	if err := saveCache(data); err != nil {
		logging.Debug("assets", "failed to write registry cache: %v", err)
	}

	e.mu.Lock()
	e.registry = reg
	e.mu.Unlock()

	logging.Info("assets", "registry refreshed (version %s)", reg.Version)
	if e.emit != nil {
		e.emit(UpdatedEvent, map[string]interface{}{"version": reg.Version})
	}
}

// RefreshPrices fetches the aggregator price set once (throttled by priceTTL:
// a call within the TTL window is a no-op so the periodic ticker and event-driven
// calls can't hammer the endpoint), maps it onto chain denoms, stores it, and
// emits UpdatedEvent so the frontend re-reads prices. On any fetch failure the
// current (stale) prices are kept and no event is emitted. Best-effort — safe to
// launch in a background goroutine.
func (e *Engine) RefreshPrices(ctx context.Context) {
	if e.priceURL == "" {
		return
	}
	if !e.prices.needsRefresh(time.Now(), priceTTL) {
		return
	}
	logging.Debug("assets", "refreshing prices from %s", e.priceURL)

	raw, err := fetchAggregatorPrices(e.http, e.priceURL)
	if err != nil {
		logging.Info("assets", "price refresh skipped (using cached): %v", err)
		return
	}
	if ctx != nil && ctx.Err() != nil {
		return
	}

	byID := indexUSDPrices(raw)
	e.prices.set(byID, time.Now())
	logging.Debug("assets", "prices refreshed (%d ids)", len(byID))
	if e.emit != nil {
		e.emit(UpdatedEvent, map[string]interface{}{"prices": len(byID)})
	}
}

// priceForAsset returns the USD unit price for an asset given its BZE on-chain
// denom and resolved identity. It looks up the asset's coingecko id (native and
// factory denoms match a registry base directly; IBC vouchers via their origin
// base denom) against the aggregator prices, falling back to a $1 pin for known
// stablecoins. Returns "" when no price is known — the UI shows USD only for
// priced assets, never "$0".
func (e *Engine) priceForAsset(onChainDenom string, resolved Asset) string {
	reg := e.snapshot()

	var coingeckoID string
	switch resolved.Type {
	case TypeIBC:
		if resolved.IBC != nil && resolved.IBC.Counterparty.BaseDenom != "" {
			if ra, _, ok := reg.FindByBase(resolved.IBC.Counterparty.BaseDenom); ok {
				coingeckoID = ra.CoingeckoID
			}
		}
	default: // native, factory
		if ra, _, ok := reg.FindByBase(onChainDenom); ok {
			coingeckoID = ra.CoingeckoID
		}
	}

	if p, ok := e.prices.priceForID(coingeckoID); ok {
		return formatPrice(p)
	}
	// No live price: pin known stablecoins to $1, like the web does for USDC.
	if IsStable(onChainDenom) {
		return "1"
	}
	return ""
}

// Prices returns the current BZE on-chain denom → USD unit price map (decimal
// strings) for the GetPrices binding. Only denoms with a known price appear.
func (e *Engine) Prices() (map[string]string, error) {
	all, err := e.AllAssets("")
	if err != nil {
		return nil, err
	}
	out := make(map[string]string)
	for _, a := range all {
		if a.Price != "" {
			out[a.Denom] = a.Price
		}
	}
	return out, nil
}

// LogoDataURL returns a data URL for a denom's logo, downloading and caching it
// on first request. Returns "" when the denom has no registry logo or every
// candidate download fails — the frontend then falls back to its placeholder.
func (e *Engine) LogoDataURL(denom string) string {
	if url, ok := e.logos.get(denom); ok {
		return url
	}
	candidates := e.logoCandidates(denom)
	if len(candidates) == 0 {
		return e.logos.fetch(denom, nil) // memoises known-missing
	}
	return e.logos.fetch(denom, candidates)
}

// logoCandidates returns a denom's logo source URLs in priority order by finding
// its registry asset. Native/factory denoms match a registry base directly; IBC
// vouchers are resolved to their origin-chain base denom first. LP tokens have no
// registry logo.
func (e *Engine) logoCandidates(denom string) []string {
	reg := e.snapshot()
	switch ClassifyType(denom) {
	case TypeNative, TypeFactory:
		if ra, _, ok := reg.FindByBase(denom); ok {
			return ra.LogoCandidates()
		}
	case TypeIBC:
		asset, _ := e.newResolver().resolve(denom)
		if asset.IBC != nil && asset.IBC.Counterparty.BaseDenom != "" {
			if ra, _, ok := reg.FindByBase(asset.IBC.Counterparty.BaseDenom); ok {
				return ra.LogoCandidates()
			}
		}
	}
	return nil
}

// Resolve returns the resolved identity of a single denom. LP denoms trigger a
// pools fetch so the pair can be named; other types resolve without it.
func (e *Engine) Resolve(denom string) Asset {
	res := e.newResolver()
	if ClassifyType(denom) == TypeLP {
		pools, _ := e.fetchPools()
		a, _ := res.resolveLP(denom, pools)
		return a
	}
	a, _ := res.resolve(denom)
	return a
}

// AssetBalance is a resolved asset paired with its on-chain total supply, the
// active wallet's balance (both raw base-unit integer strings), and the asset's
// USD unit price. Price is "" when no price is known — the UI shows USD only for
// priced assets, never "$0".
type AssetBalance struct {
	Asset
	Supply string `json:"supply"`
	Amount string `json:"amount"` // active account's balance, "0" if none
	Price  string `json:"price"`  // USD unit price as a decimal string, "" if unknown
}

// AllAssets resolves every non-excluded asset on the chain (from total supply),
// attaching the given account's balance to each. Pools are fetched once so LP
// tokens are named. A nil/empty address yields balances of "0".
func (e *Engine) AllAssets(address string) ([]AssetBalance, error) {
	supply, err := e.fetchSupply()
	if err != nil {
		return nil, err
	}
	pools, _ := e.fetchPools()
	balances := map[string]string{}
	if address != "" {
		balances, _ = e.fetchBalances(address)
	}

	res := e.newResolver()
	out := make([]AssetBalance, 0, len(supply))
	for _, s := range supply {
		if IsExcluded(s.denom) {
			continue
		}
		var a Asset
		if ClassifyType(s.denom) == TypeLP {
			a, _ = res.resolveLP(s.denom, pools)
		} else {
			a, _ = res.resolve(s.denom)
		}
		amount := balances[s.denom]
		if amount == "" {
			amount = "0"
		}
		price := e.priceForAsset(s.denom, a)
		out = append(out, AssetBalance{Asset: a, Supply: s.amount, Amount: amount, Price: price})
	}
	return out, nil
}

// --- on-chain fetchers ------------------------------------------------------

// Pool is a tradebin AMM liquidity pool (subset used for LP naming).
type Pool struct {
	ID           string
	Base         string
	Quote        string
	LPDenom      string
	ReserveBase  string
	ReserveQuote string
	Stable       bool
}

type supplyEntry struct {
	denom  string
	amount string
}

func (e *Engine) fetchSupply() ([]supplyEntry, error) {
	resp, err := e.rest.RestGet("/cosmos/bank/v1beta1/supply?pagination.limit=1000")
	if err != nil {
		return nil, err
	}
	var out []supplyEntry
	for _, s := range asSlice(resp["supply"]) {
		m, ok := asMap(s)
		if !ok {
			continue
		}
		out = append(out, supplyEntry{denom: asString(m["denom"]), amount: asString(m["amount"])})
	}
	return out, nil
}

// fetchPools returns a map of lp_denom → pool for LP naming.
func (e *Engine) fetchPools() (map[string]Pool, error) {
	resp, err := e.rest.RestGet("/bze/tradebin/all_liquidity_pools?pagination.limit=1000")
	if err != nil {
		return nil, err
	}
	out := map[string]Pool{}
	for _, p := range asSlice(resp["list"]) {
		m, ok := asMap(p)
		if !ok {
			continue
		}
		pool := Pool{
			ID:           asString(m["id"]),
			Base:         asString(m["base"]),
			Quote:        asString(m["quote"]),
			LPDenom:      asString(m["lp_denom"]),
			ReserveBase:  asString(m["reserve_base"]),
			ReserveQuote: asString(m["reserve_quote"]),
		}
		pool.Stable, _ = m["stable"].(bool)
		if pool.LPDenom != "" {
			out[pool.LPDenom] = pool
		}
	}
	return out, nil
}

// fetchBalances returns a map of denom → amount for an address.
func (e *Engine) fetchBalances(address string) (map[string]string, error) {
	resp, err := e.rest.RestGet("/cosmos/bank/v1beta1/balances/" + address + "?pagination.limit=1000")
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, b := range asSlice(resp["balances"]) {
		m, ok := asMap(b)
		if !ok {
			continue
		}
		out[asString(m["denom"])] = asString(m["amount"])
	}
	return out, nil
}
