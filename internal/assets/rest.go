package assets

import "fmt"

// denomTrace is the parsed /ibc/apps/transfer/v1/denom_traces/{hash} result.
type denomTrace struct {
	Path      string
	BaseDenom string
}

// denomMetadata is the parsed /cosmos/bank/v1beta1/denoms_metadata/{denom} result.
type denomMetadata struct {
	Base       string
	Display    string
	Name       string
	Symbol     string
	DenomUnits []DenomUnit
}

// counterparty is the origin chain of an IBC channel.
type counterparty struct {
	chainID   string
	channelID string
}

// fetchTrace resolves an IBC voucher hash to its denom trace. Traces are
// immutable, so successful lookups are served from the engine cache.
func (r *resolver) fetchTrace(hash string) (denomTrace, bool) {
	if r.cache != nil {
		if t, ok := r.cache.trace(hash); ok {
			return t, true
		}
	}
	resp, err := r.rest.RestGet("/ibc/apps/transfer/v1/denom_traces/" + hash)
	if err != nil {
		return denomTrace{}, false
	}
	dt, ok := asMap(resp["denom_trace"])
	if !ok {
		return denomTrace{}, false
	}
	trace := denomTrace{
		Path:      asString(dt["path"]),
		BaseDenom: asString(dt["base_denom"]),
	}
	if trace.BaseDenom == "" {
		return denomTrace{}, false
	}
	if r.cache != nil {
		r.cache.setTrace(hash, trace)
	}
	return trace, true
}

// fetchMetadata reads a factory denom's on-chain bank metadata, if any.
// Successful lookups are cached with a TTL (metadata can be updated on chain).
func (r *resolver) fetchMetadata(denom string) (denomMetadata, bool) {
	if r.cache != nil {
		if m, ok := r.cache.meta(denom); ok {
			return m, true
		}
	}
	resp, err := r.rest.RestGet("/cosmos/bank/v1beta1/denoms_metadata/" + denom)
	if err != nil {
		return denomMetadata{}, false
	}
	m, ok := asMap(resp["metadata"])
	if !ok {
		return denomMetadata{}, false
	}
	meta := denomMetadata{
		Base:    asString(m["base"]),
		Display: asString(m["display"]),
		Name:    asString(m["name"]),
		Symbol:  asString(m["symbol"]),
	}
	for _, u := range asSlice(m["denom_units"]) {
		um, ok := asMap(u)
		if !ok {
			continue
		}
		meta.DenomUnits = append(meta.DenomUnits, DenomUnit{
			Denom:    asString(um["denom"]),
			Exponent: asInt(um["exponent"]),
		})
	}
	if r.cache != nil {
		r.cache.setMeta(denom, meta)
	}
	return meta, true
}

// fetchCounterparty walks channel → connection → client to find the origin chain
// id and counterparty channel of an IBC channel. Best-effort: any failure yields
// ok=false and resolution falls back to registry-derived chain info. The
// channel → chain mapping is immutable, so successes are served from the cache.
func (r *resolver) fetchCounterparty(channelID, portID string) (counterparty, bool) {
	cacheKey := channelID + "/" + portID
	if r.cache != nil {
		if cp, ok := r.cache.counterparty(cacheKey); ok {
			return cp, true
		}
	}
	chResp, err := r.rest.RestGet(fmt.Sprintf("/ibc/core/channel/v1/channels/%s/ports/%s", channelID, portID))
	if err != nil {
		return counterparty{}, false
	}
	ch, ok := asMap(chResp["channel"])
	if !ok {
		return counterparty{}, false
	}
	hops := asSlice(ch["connection_hops"])
	if len(hops) == 0 {
		return counterparty{}, false
	}
	connectionID := asString(hops[0])
	cp := counterparty{}
	if cpm, ok := asMap(ch["counterparty"]); ok {
		cp.channelID = asString(cpm["channel_id"])
	}
	if connectionID == "" {
		return counterparty{}, false
	}

	connResp, err := r.rest.RestGet("/ibc/core/connection/v1/connections/" + connectionID)
	if err != nil {
		return counterparty{}, false
	}
	conn, ok := asMap(connResp["connection"])
	if !ok {
		return counterparty{}, false
	}
	clientID := asString(conn["client_id"])
	if clientID == "" {
		return counterparty{}, false
	}

	csResp, err := r.rest.RestGet("/ibc/core/client/v1/client_states/" + clientID)
	if err != nil {
		return counterparty{}, false
	}
	cp.chainID = clientChainID(csResp)
	if cp.chainID == "" {
		return counterparty{}, false
	}
	if r.cache != nil {
		r.cache.setCounterparty(cacheKey, cp)
	}
	return cp, true
}

// clientChainID digs the chain_id out of a client_states response, tolerating the
// two shapes the REST endpoint returns (client_state directly, or wrapped in
// .value).
func clientChainID(resp map[string]interface{}) string {
	cs, ok := asMap(resp["client_state"])
	if !ok {
		return ""
	}
	if id := asString(cs["chain_id"]); id != "" {
		return id
	}
	if v, ok := asMap(cs["value"]); ok {
		return asString(v["chain_id"])
	}
	return ""
}

// --- untyped-JSON helpers ---------------------------------------------------

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

// asInt coerces a JSON number (float64) or numeric string to int.
func asInt(v interface{}) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case string:
		var i int
		_, err := fmt.Sscanf(n, "%d", &i)
		if err != nil {
			return 0
		}
		return i
	default:
		return 0
	}
}
