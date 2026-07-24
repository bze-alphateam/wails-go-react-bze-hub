package assets

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// resolver resolves denoms against a fixed registry snapshot and a REST client.
// It is created per-resolution from the engine's current snapshot so the engine
// can swap the snapshot without locking during (slow) REST calls.
type resolver struct {
	reg  *Registry
	rest RestClient
}

// resolve turns a denom into an Asset. The bool reports whether the asset was
// positively identified (registry / metadata / pool) versus left as a truncated
// placeholder — used by LP naming, which only labels a pair when both sides are
// known (web parity).
func (r *resolver) resolve(denom string) (Asset, bool) {
	switch ClassifyType(denom) {
	case TypeFactory:
		return r.resolveFactory(denom)
	case TypeIBC:
		return r.resolveIBC(denom)
	case TypeLP:
		return r.resolveLP(denom, nil)
	default:
		return r.resolveNative(denom)
	}
}

// base builds the unresolved starting point for a denom: type + placeholder
// symbol/name + classification flags. Mirrors the web createAsset().
func base(denom string, t Type) Asset {
	return Asset{
		Denom:    denom,
		Type:     t,
		Symbol:   TruncateDenom(denom),
		Name:     TruncateDenom(denom),
		Decimals: 0,
		Verified: IsVerified(denom),
		Stable:   IsStable(denom),
	}
}

// resolveNative handles ubze and any other non-prefixed denom, using the BZE
// chain's registry asset list.
func (r *resolver) resolveNative(denom string) (Asset, bool) {
	a := base(denom, TypeNative)
	if ra, ok := r.reg.BZEAsset(denom); ok {
		applyBZERegistry(&a, ra)
		return a, true
	}
	return a, false
}

// resolveFactory parses factory/{creator}/{sub}, preferring the BZE registry and
// falling back to on-chain bank denom_metadata (web parity: registry first).
func (r *resolver) resolveFactory(denom string) (Asset, bool) {
	a := base(denom, TypeFactory)
	if _, _, ok := ParseFactoryDenom(denom); !ok {
		return a, false
	}
	if ra, ok := r.reg.BZEAsset(denom); ok {
		applyBZERegistry(&a, ra)
		return a, true
	}
	if meta, ok := r.fetchMetadata(denom); ok {
		applyMetadata(&a, meta)
		return a, true
	}
	return a, false
}

// resolveIBC resolves ibc/{hash} via a denom trace, mapping the origin base denom
// to a counterpart-chain registry asset. Non-canonical assets get the origin
// chain appended (web parity).
func (r *resolver) resolveIBC(denom string) (Asset, bool) {
	a := base(denom, TypeIBC)
	hash := strings.TrimPrefix(denom, "ibc/")

	trace, ok := r.fetchTrace(hash)
	if !ok {
		return a, false
	}

	parts := splitPath(trace.Path)
	if len(parts) < 2 {
		return a, false
	}
	portID, channelID := parts[0], parts[1]

	info := &IBCInfo{ChannelID: channelID}
	info.Counterparty.BaseDenom = firstHopDenom(trace)
	if cp, ok := r.fetchCounterparty(channelID, portID); ok {
		info.Counterparty.ChannelID = cp.channelID
		if ch, ok := r.reg.ChainByID(cp.chainID); ok {
			info.Counterparty.ChainName = ch.ChainName
			info.Counterparty.ChainPrettyName = prettyOrName(ch)
		}
	}
	a.IBC = info

	// Canonical: origin base denom maps to a registry asset.
	if ra, chain, ok := r.reg.FindByBase(trace.BaseDenom); ok {
		a.Symbol = strings.ToUpper(ra.Symbol)
		a.Name = ra.Name
		a.Decimals = ra.Exponent()
		a.LogoRef = ra.LogoRef
		a.Verified = true
		if info.Counterparty.ChainName == "" {
			info.Counterparty.ChainName = chain.ChainName
			info.Counterparty.ChainPrettyName = prettyOrName(chain)
		}
		if IsIBC(trace.BaseDenom) {
			appendOrigin(&a)
		}
		return a, true
	}

	// Non-canonical: label with the (possibly truncated) origin denom.
	if !strings.Contains(trace.BaseDenom, "/") {
		name := trace.BaseDenom
		if len([]rune(name)) > 10 {
			name = TruncateDenom(name)
		}
		a.Name = name
	}
	a.Verified = false
	a.Decimals = 0
	if IsIBC(trace.BaseDenom) {
		appendOrigin(&a)
	}
	return a, false
}

// resolveLP labels an AMM LP share token as "BASE/QUOTE LP" once both sides
// resolve to known assets. pools maps lp_denom → pool; when nil, only the legacy
// ulp_<base>_<quote> format can be parsed.
func (r *resolver) resolveLP(denom string, pools map[string]Pool) (Asset, bool) {
	a := base(denom, TypeLP)

	baseDenom, quoteDenom := "", ""
	if p, ok := pools[denom]; ok {
		baseDenom, quoteDenom = p.Base, p.Quote
	}
	if baseDenom == "" || quoteDenom == "" {
		// Legacy ulp_<base>_<quote> fallback.
		if split := strings.Split(denom, "_"); len(split) == 3 {
			baseDenom, quoteDenom = split[1], split[2]
		}
	}
	if baseDenom == "" || quoteDenom == "" {
		return a, false
	}

	baseAsset, baseKnown := r.resolve(baseDenom)
	quoteAsset, quoteKnown := r.resolve(quoteDenom)
	if !baseKnown || !quoteKnown {
		return a, false
	}

	a.Name = baseAsset.Symbol + "/" + quoteAsset.Symbol + " LP Shares"
	a.Symbol = baseAsset.Symbol + "/" + quoteAsset.Symbol + " LP"
	a.Decimals = LPDecimals
	a.Verified = true
	return a, true
}

// --- field application ------------------------------------------------------

// applyBZERegistry fills an asset from a BZE-chain registry entry. Ticker comes
// from the display unit uppercased (web populateAssetFromBZEChainRegistryAssetList).
func applyBZERegistry(a *Asset, ra RegistryAsset) {
	a.Name = ra.Name
	a.Symbol = strings.ToUpper(ra.Display)
	a.Decimals = ra.Exponent()
	a.LogoRef = ra.LogoRef
}

// applyMetadata merges on-chain bank denom_metadata into an asset (web
// populateAssetFromBlockchainMetadata): name/symbol when non-empty, and the
// exponent+ticker from the display denom_unit.
func applyMetadata(a *Asset, m denomMetadata) {
	if m.Base != a.Denom {
		return
	}
	if m.Name != "" {
		a.Name = m.Name
	}
	if m.Symbol != "" {
		a.Symbol = strings.ToUpper(m.Symbol)
	}
	for _, u := range m.DenomUnits {
		if u.Denom == m.Display {
			a.Decimals = u.Exponent
			a.Symbol = strings.ToUpper(u.Denom)
		}
	}
}

// appendOrigin suffixes an IBC asset's symbol/name with its origin chain, to
// distinguish indirectly-routed (ibc-within-ibc) assets from canonical ones.
func appendOrigin(a *Asset) {
	if a.IBC == nil || a.IBC.Counterparty.ChainName == "" {
		return
	}
	cp := a.IBC.Counterparty
	a.Symbol = a.Symbol + "." + cp.ChainName
	pretty := cp.ChainPrettyName
	if pretty == "" {
		pretty = cp.ChainName
	}
	a.Name = a.Name + " (" + pretty + ")"
}

// --- helpers ----------------------------------------------------------------

func prettyOrName(c *Chain) string {
	if c.PrettyName != "" {
		return c.PrettyName
	}
	return c.ChainName
}

// splitPath splits an IBC trace path ("transfer/channel-0") into non-empty parts.
func splitPath(path string) []string {
	raw := strings.Split(path, "/")
	out := raw[:0]
	for _, p := range raw {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// firstHopDenom computes the asset's denom on the first-hop (counterparty) chain
// from a single trace. Mirrors the web denomOnFirstHopChainFromTrace: for a
// single-hop trace it's the base denom; for multi-hop it's ibc/<sha256 of the
// remaining path + base denom>.
func firstHopDenom(t denomTrace) string {
	if t.BaseDenom == "" {
		return ""
	}
	parts := splitPath(t.Path)
	if len(parts) < 2 {
		return t.BaseDenom
	}
	remaining := parts[2:]
	if len(remaining) == 0 {
		return t.BaseDenom
	}
	full := strings.Join(remaining, "/") + "/" + t.BaseDenom
	sum := sha256.Sum256([]byte(full))
	return "ibc/" + strings.ToUpper(hex.EncodeToString(sum[:]))
}
