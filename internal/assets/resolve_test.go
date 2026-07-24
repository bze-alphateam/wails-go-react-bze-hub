package assets

import (
	"fmt"
	"testing"
)

// mockRest is a canned REST proxy keyed by path. Missing paths return an error
// (mirroring a not-found response), so resolution's best-effort fallbacks kick in.
type mockRest struct {
	responses map[string]map[string]interface{}
}

func (m *mockRest) RestGet(path string) (map[string]interface{}, error) {
	if r, ok := m.responses[path]; ok {
		return r, nil
	}
	return nil, fmt.Errorf("mockRest: no response for %s", path)
}

func testRegistry(t *testing.T) *Registry {
	t.Helper()
	reg, err := LoadEmbedded()
	if err != nil {
		t.Fatal(err)
	}
	return reg
}

func TestResolveNative(t *testing.T) {
	r := &resolver{reg: testRegistry(t), rest: &mockRest{}}
	a, known := r.resolve("ubze")
	if !known {
		t.Fatal("ubze should be known")
	}
	if a.Type != TypeNative || a.Symbol != "BZE" || a.Name != "BeeZee" || a.Decimals != 6 {
		t.Errorf("ubze = %+v, want native/BZE/BeeZee/6", a)
	}
	if !a.Verified {
		t.Error("ubze should be verified")
	}
}

func TestResolveFactoryFromRegistry(t *testing.T) {
	r := &resolver{reg: testRegistry(t), rest: &mockRest{}}
	denom := "factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl"
	a, known := r.resolve(denom)
	if !known {
		t.Fatal("registry factory denom should be known")
	}
	if a.Type != TypeFactory || a.Symbol != "VDL" || a.Name != "Vidulum" || a.Decimals != 6 {
		t.Errorf("uvdl = %+v, want factory/VDL/Vidulum/6", a)
	}
	if !a.Verified { // it's in VerifiedAssets
		t.Error("uvdl should be verified")
	}
}

func TestResolveFactoryFromMetadata(t *testing.T) {
	denom := "factory/bze1creator/uabc"
	rest := &mockRest{responses: map[string]map[string]interface{}{
		"/cosmos/bank/v1beta1/denoms_metadata/" + denom: {
			"metadata": map[string]interface{}{
				"base":    denom,
				"display": "abc",
				"name":    "ABC Token",
				"symbol":  "abc",
				"denom_units": []interface{}{
					map[string]interface{}{"denom": denom, "exponent": float64(0)},
					map[string]interface{}{"denom": "abc", "exponent": float64(6)},
				},
			},
		},
	}}
	r := &resolver{reg: testRegistry(t), rest: rest}
	a, known := r.resolve(denom)
	if !known {
		t.Fatal("metadata-backed factory denom should be known")
	}
	if a.Type != TypeFactory || a.Name != "ABC Token" || a.Symbol != "ABC" || a.Decimals != 6 {
		t.Errorf("metadata merge = %+v, want factory/ABC Token/ABC/6", a)
	}
}

func TestResolveFactoryUnknown(t *testing.T) {
	// No registry entry and no metadata → placeholder, not known.
	r := &resolver{reg: testRegistry(t), rest: &mockRest{}}
	a, known := r.resolve("factory/bze1creator/umystery")
	if known {
		t.Error("unknown factory denom should not be known")
	}
	if a.Type != TypeFactory {
		t.Errorf("type = %q, want factory", a.Type)
	}
}

// ibcCounterpartyResponses returns the channel→connection→client chain of REST
// responses that resolve channelID to originChainID.
func ibcCounterpartyResponses(channelID, connectionID, clientID, cpChannel, originChainID string) map[string]map[string]interface{} {
	return map[string]map[string]interface{}{
		"/ibc/core/channel/v1/channels/" + channelID + "/ports/transfer": {
			"channel": map[string]interface{}{
				"connection_hops": []interface{}{connectionID},
				"counterparty":    map[string]interface{}{"channel_id": cpChannel},
			},
		},
		"/ibc/core/connection/v1/connections/" + connectionID: {
			"connection": map[string]interface{}{"client_id": clientID},
		},
		"/ibc/core/client/v1/client_states/" + clientID: {
			"client_state": map[string]interface{}{"chain_id": originChainID},
		},
	}
}

func TestResolveIBCCanonical(t *testing.T) {
	denom := "ibc/HASHUSDC"
	resp := map[string]map[string]interface{}{
		"/ibc/apps/transfer/v1/denom_traces/HASHUSDC": {
			"denom_trace": map[string]interface{}{"path": "transfer/channel-2", "base_denom": "uusdc"},
		},
	}
	for k, v := range ibcCounterpartyResponses("channel-2", "connection-0", "07-tendermint-0", "channel-750", "noble-1") {
		resp[k] = v
	}
	r := &resolver{reg: testRegistry(t), rest: &mockRest{responses: resp}}

	a, known := r.resolve(denom)
	if !known {
		t.Fatal("canonical IBC USDC should be known")
	}
	if a.Type != TypeIBC || a.Symbol != "USDC" || a.Name != "USD Coin" || a.Decimals != 6 {
		t.Errorf("IBC USDC = %+v, want ibc/USDC/USD Coin/6", a)
	}
	if !a.Verified {
		t.Error("canonical IBC asset should be verified")
	}
	if a.IBC == nil || a.IBC.ChannelID != "channel-2" {
		t.Errorf("IBC channel = %+v, want channel-2", a.IBC)
	}
	if a.IBC.Counterparty.ChainName != "noble" {
		t.Errorf("counterparty chain = %q, want noble", a.IBC.Counterparty.ChainName)
	}
}

func TestResolveIBCNonCanonical(t *testing.T) {
	// base_denom not in any registry → unverified, labelled by origin denom.
	denom := "ibc/HASHFOO"
	resp := map[string]map[string]interface{}{
		"/ibc/apps/transfer/v1/denom_traces/HASHFOO": {
			"denom_trace": map[string]interface{}{"path": "transfer/channel-9", "base_denom": "ufoo"},
		},
	}
	r := &resolver{reg: testRegistry(t), rest: &mockRest{responses: resp}}
	a, known := r.resolve(denom)
	if known {
		t.Error("unknown IBC asset should not be known")
	}
	if a.Verified {
		t.Error("non-canonical IBC asset should not be verified")
	}
	if a.Name != "ufoo" {
		t.Errorf("name = %q, want ufoo", a.Name)
	}
}

func TestResolveIBCIndirectAppendsOrigin(t *testing.T) {
	// Indirect route: the trace's base_denom is itself an IBC denom, so the origin
	// chain is appended to distinguish it from a canonical asset (web parity).
	denom := "ibc/HASHINDIRECT"
	resp := map[string]map[string]interface{}{
		"/ibc/apps/transfer/v1/denom_traces/HASHINDIRECT": {
			"denom_trace": map[string]interface{}{"path": "transfer/channel-5", "base_denom": "ibc/INNERHASH"},
		},
	}
	for k, v := range ibcCounterpartyResponses("channel-5", "connection-3", "07-tendermint-9", "channel-4", "atomone-1") {
		resp[k] = v
	}
	r := &resolver{reg: testRegistry(t), rest: &mockRest{responses: resp}}
	a, _ := r.resolve(denom)

	if a.IBC == nil || a.IBC.Counterparty.ChainName != "atomone" {
		t.Fatalf("counterparty = %+v, want atomone", a.IBC)
	}
	if got := a.Symbol; got[len(got)-len(".atomone"):] != ".atomone" {
		t.Errorf("symbol = %q, want suffix .atomone", a.Symbol)
	}
	if want := " (AtomOne)"; a.Name[len(a.Name)-len(want):] != want {
		t.Errorf("name = %q, want suffix %q", a.Name, want)
	}
}

func TestResolveLPFromPool(t *testing.T) {
	uvdl := "factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl"
	lpDenom := "ulp/POOLHASH"
	pools := map[string]Pool{
		lpDenom: {ID: "bze/vdl", Base: "ubze", Quote: uvdl, LPDenom: lpDenom},
	}
	r := &resolver{reg: testRegistry(t), rest: &mockRest{}}
	a, known := r.resolveLP(lpDenom, pools)
	if !known {
		t.Fatal("LP with known sides should be named")
	}
	if a.Type != TypeLP || a.Symbol != "BZE/VDL LP" || a.Name != "BZE/VDL LP Shares" {
		t.Errorf("LP = %+v, want lp/BZE/VDL LP/BZE/VDL LP Shares", a)
	}
	if a.Decimals != LPDecimals || !a.Verified {
		t.Errorf("LP decimals=%d verified=%v, want %d/true", a.Decimals, a.Verified, LPDecimals)
	}
}

func TestResolveLPLegacyFormat(t *testing.T) {
	uvdl := "factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl"
	denom := "ulp_ubze_" + uvdl
	r := &resolver{reg: testRegistry(t), rest: &mockRest{}}
	a, known := r.resolveLP(denom, nil) // no pools → legacy parse
	if !known {
		t.Fatal("legacy LP with known sides should be named")
	}
	if a.Symbol != "BZE/VDL LP" {
		t.Errorf("legacy LP symbol = %q, want BZE/VDL LP", a.Symbol)
	}
}

func TestResolveLPUnknownSideNotNamed(t *testing.T) {
	lpDenom := "ulp/UNKNOWNPOOL"
	pools := map[string]Pool{
		lpDenom: {Base: "ubze", Quote: "umystery", LPDenom: lpDenom},
	}
	r := &resolver{reg: testRegistry(t), rest: &mockRest{}}
	a, known := r.resolveLP(lpDenom, pools)
	if known {
		t.Error("LP with an unknown side should not be named")
	}
	if a.Verified {
		t.Error("unnamed LP should not be verified")
	}
}
