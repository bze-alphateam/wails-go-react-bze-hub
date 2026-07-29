package assets

import (
	"testing"
	"time"
)

// countingRest wraps mockRest and counts calls per path.
type countingRest struct {
	inner *mockRest
	calls map[string]int
}

func newCountingRest(responses map[string]map[string]interface{}) *countingRest {
	return &countingRest{inner: &mockRest{responses: responses}, calls: map[string]int{}}
}

func (c *countingRest) RestGet(path string) (map[string]interface{}, error) {
	c.calls[path] = c.calls[path] + 1
	return c.inner.RestGet(path)
}

func (c *countingRest) total() int {
	n := 0
	for _, v := range c.calls {
		n += v
	}
	return n
}

func TestResolveIBCUsesCacheOnSecondResolve(t *testing.T) {
	denom := "ibc/HASHUSDC"
	resp := map[string]map[string]interface{}{
		"/ibc/apps/transfer/v1/denom_traces/HASHUSDC": {
			"denom_trace": map[string]interface{}{"path": "transfer/channel-2", "base_denom": "uusdc"},
		},
	}
	for k, v := range ibcCounterpartyResponses("channel-2", "connection-0", "07-tendermint-0", "channel-750", "noble-1") {
		resp[k] = v
	}
	rest := newCountingRest(resp)
	cache := newResolveCache()
	r := &resolver{reg: testRegistry(t), rest: rest, cache: cache}

	first, known := r.resolve(denom)
	if !known {
		t.Fatal("canonical IBC USDC should be known")
	}
	afterFirst := rest.total()
	if afterFirst == 0 {
		t.Fatal("first resolve should hit the REST API")
	}

	second, known := r.resolve(denom)
	if !known {
		t.Fatal("second resolve should still be known")
	}
	if rest.total() != afterFirst {
		t.Errorf("second resolve made %d extra REST calls, want 0", rest.total()-afterFirst)
	}
	if first.Symbol != second.Symbol || first.IBC.Counterparty.ChainName != second.IBC.Counterparty.ChainName {
		t.Errorf("cached resolve differs: %+v vs %+v", first, second)
	}
}

func TestResolveFactoryMetadataTTL(t *testing.T) {
	denom := "factory/bze1creator/uxyz"
	rest := newCountingRest(map[string]map[string]interface{}{
		"/cosmos/bank/v1beta1/denoms_metadata/" + denom: {
			"metadata": map[string]interface{}{
				"base":    denom,
				"display": "xyz",
				"name":    "Xyz Token",
				"symbol":  "XYZ",
				"denom_units": []interface{}{
					map[string]interface{}{"denom": "xyz", "exponent": float64(6)},
				},
			},
		},
	})
	cache := newResolveCache()
	now := time.Now()
	cache.now = func() time.Time { return now }
	r := &resolver{reg: testRegistry(t), rest: rest, cache: cache}

	metaPath := "/cosmos/bank/v1beta1/denoms_metadata/" + denom
	r.resolve(denom)
	r.resolve(denom)
	if rest.calls[metaPath] != 1 {
		t.Errorf("metadata fetched %d times within TTL, want 1", rest.calls[metaPath])
	}

	// Past the TTL the metadata is re-fetched (it can change on chain).
	now = now.Add(metadataTTL + time.Second)
	r.resolve(denom)
	if rest.calls[metaPath] != 2 {
		t.Errorf("metadata fetched %d times after TTL expiry, want 2", rest.calls[metaPath])
	}
}

func TestFailedLookupsAreNotCached(t *testing.T) {
	denom := "ibc/HASHMISSING"
	rest := newCountingRest(nil) // every path errors
	r := &resolver{reg: testRegistry(t), rest: rest, cache: newResolveCache()}

	tracePath := "/ibc/apps/transfer/v1/denom_traces/HASHMISSING"
	r.resolve(denom)
	r.resolve(denom)
	if rest.calls[tracePath] != 2 {
		t.Errorf("failed trace fetched %d times, want 2 (failures must stay retryable)", rest.calls[tracePath])
	}
}
