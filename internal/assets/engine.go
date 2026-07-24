package assets

import (
	"context"
	"net/http"
	"sync"

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

	return &Engine{
		registry:   reg,
		rest:       rest,
		emit:       emit,
		http:       defaultHTTPClient(),
		refreshURL: DefaultRefreshURL,
	}, nil
}

// SetRefreshURL overrides the remote snapshot URL (used in tests).
func (e *Engine) SetRefreshURL(url string) { e.refreshURL = url }

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

// AssetBalance is a resolved asset paired with its on-chain total supply and the
// active wallet's balance (both raw base-unit integer strings).
type AssetBalance struct {
	Asset
	Supply string `json:"supply"`
	Amount string `json:"amount"` // active account's balance, "0" if none
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
		out = append(out, AssetBalance{Asset: a, Supply: s.amount, Amount: amount})
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
