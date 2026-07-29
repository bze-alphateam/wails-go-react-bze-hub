package assets

import (
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// metadataTTL bounds how long on-chain factory denom metadata is served from
// cache. IBC denom traces and their channel/connection/client chain are
// immutable once created, so those are cached for the engine's lifetime.
const metadataTTL = 10 * time.Minute

type metaEntry struct {
	meta      denomMetadata
	fetchedAt time.Time
}

// resolveCache memoizes the per-denom REST lookups made during resolution and
// collapses concurrent fetches of the dynamic endpoints (supply, pools,
// balances) into a single upstream call. Without it every AllAssets sweep
// re-fetched every trace/metadata/channel chain from the chain REST API
// (BHUB-33). Only successful lookups are cached — failures stay retryable.
type resolveCache struct {
	mu             sync.Mutex
	traces         map[string]denomTrace  // ibc voucher hash → trace (immutable)
	counterparties map[string]counterparty // channelID/portID → origin chain (immutable)
	metadata       map[string]metaEntry   // denom → bank metadata (TTL)

	group singleflight.Group
	now   func() time.Time // injectable clock for tests
}

func newResolveCache() *resolveCache {
	return &resolveCache{
		traces:         map[string]denomTrace{},
		counterparties: map[string]counterparty{},
		metadata:       map[string]metaEntry{},
		now:            time.Now,
	}
}

func (c *resolveCache) trace(hash string) (denomTrace, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	t, ok := c.traces[hash]
	return t, ok
}

func (c *resolveCache) setTrace(hash string, t denomTrace) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.traces[hash] = t
}

func (c *resolveCache) counterparty(key string) (counterparty, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	cp, ok := c.counterparties[key]
	return cp, ok
}

func (c *resolveCache) setCounterparty(key string, cp counterparty) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.counterparties[key] = cp
}

func (c *resolveCache) meta(denom string) (denomMetadata, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.metadata[denom]
	if !ok || c.now().Sub(e.fetchedAt) > metadataTTL {
		return denomMetadata{}, false
	}
	return e.meta, true
}

func (c *resolveCache) setMeta(denom string, m denomMetadata) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.metadata[denom] = metaEntry{meta: m, fetchedAt: c.now()}
}

// do collapses concurrent calls with the same key into one execution whose
// result all callers share (plain singleflight — no TTL, so sequential calls
// still hit upstream and stay fresh).
func (c *resolveCache) do(key string, fn func() (interface{}, error)) (interface{}, error) {
	v, err, _ := c.group.Do(key, fn)
	return v, err
}
