package assets

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// isolateDataDir points AppDataDir at a temp dir so cache reads/writes don't
// touch the real profile.
func isolateDataDir(t *testing.T) {
	t.Helper()
	t.Setenv("XDG_DATA_HOME", t.TempDir())
}

func TestNewEngineUsesEmbedWithoutNetwork(t *testing.T) {
	isolateDataDir(t)
	e, err := NewEngine(&mockRest{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Native resolution needs no REST — proves the engine is usable immediately.
	a := e.Resolve("ubze")
	if a.Symbol != "BZE" || a.Decimals != 6 {
		t.Errorf("ubze = %+v, want BZE/6", a)
	}
}

func TestEngineResolveLPFetchesPools(t *testing.T) {
	isolateDataDir(t)
	uvdl := "factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl"
	lpDenom := "ulp/POOLHASH"
	rest := &mockRest{responses: map[string]map[string]interface{}{
		"/bze/tradebin/all_liquidity_pools?pagination.limit=1000": {
			"list": []interface{}{
				map[string]interface{}{"id": "bze/vdl", "base": "ubze", "quote": uvdl, "lp_denom": lpDenom},
			},
		},
	}}
	e, err := NewEngine(rest, nil)
	if err != nil {
		t.Fatal(err)
	}
	a := e.Resolve(lpDenom)
	if a.Type != TypeLP || a.Symbol != "BZE/VDL LP" {
		t.Errorf("LP resolve = %+v, want lp/BZE/VDL LP", a)
	}
}

func TestAllAssetsResolvesAndExcludes(t *testing.T) {
	isolateDataDir(t)
	uvdl := "factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl"
	excluded := "factory/bze1972aqfzdg29ugjln74edx0xvcg4ehvysjptk77/1000000000"
	addr := "bze1holder"
	rest := &mockRest{responses: map[string]map[string]interface{}{
		"/cosmos/bank/v1beta1/supply?pagination.limit=1000": {
			"supply": []interface{}{
				map[string]interface{}{"denom": "ubze", "amount": "1000000"},
				map[string]interface{}{"denom": uvdl, "amount": "500"},
				map[string]interface{}{"denom": excluded, "amount": "999"},
			},
		},
		"/bze/tradebin/all_liquidity_pools?pagination.limit=1000": {"list": []interface{}{}},
		"/cosmos/bank/v1beta1/balances/" + addr + "?pagination.limit=1000": {
			"balances": []interface{}{
				map[string]interface{}{"denom": "ubze", "amount": "42"},
			},
		},
	}}
	e, err := NewEngine(rest, nil)
	if err != nil {
		t.Fatal(err)
	}

	all, err := e.AllAssets(addr)
	if err != nil {
		t.Fatal(err)
	}
	byDenom := map[string]AssetBalance{}
	for _, a := range all {
		byDenom[a.Denom] = a
	}
	if _, ok := byDenom[excluded]; ok {
		t.Error("excluded denom should not appear in AllAssets")
	}
	ubze, ok := byDenom["ubze"]
	if !ok {
		t.Fatal("ubze missing from AllAssets")
	}
	if ubze.Symbol != "BZE" || ubze.Amount != "42" || ubze.Supply != "1000000" {
		t.Errorf("ubze = %+v, want BZE amount=42 supply=1000000", ubze)
	}
	if byDenom[uvdl].Amount != "0" {
		t.Errorf("uvdl balance = %q, want 0 (no wallet balance)", byDenom[uvdl].Amount)
	}
}

const remoteSnapshot = `{"version":"test-remote","chains":[{"chainName":"beezee","chainId":"beezee-1","prettyName":"BeeZee","assets":[{"base":"ubze","symbol":"BZE","name":"BeeZee Remote","display":"bze","denomUnits":[{"denom":"ubze","exponent":0},{"denom":"bze","exponent":6}]}]}]}`

func TestRefreshSuccessSwapsAndEmits(t *testing.T) {
	isolateDataDir(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(remoteSnapshot))
	}))
	defer srv.Close()

	var emitted []string
	e, err := NewEngine(&mockRest{}, func(event string, data interface{}) {
		emitted = append(emitted, event)
	})
	if err != nil {
		t.Fatal(err)
	}
	e.SetRefreshURL(srv.URL)

	e.Refresh(context.Background())

	if v := e.snapshot().Version; v != "test-remote" {
		t.Errorf("version after refresh = %q, want test-remote", v)
	}
	// The remote asset overrides the embed (name differs).
	if a := e.Resolve("ubze"); a.Name != "BeeZee Remote" {
		t.Errorf("ubze name = %q, want BeeZee Remote", a.Name)
	}
	if len(emitted) != 1 || emitted[0] != UpdatedEvent {
		t.Errorf("emitted = %v, want [%s]", emitted, UpdatedEvent)
	}
	// Cache persisted for the next launch.
	if _, err := os.Stat(cachePath()); err != nil {
		t.Errorf("expected cache file written: %v", err)
	}
}

func TestRefreshFailureKeepsEmbed(t *testing.T) {
	isolateDataDir(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	var emitted []string
	e, err := NewEngine(&mockRest{}, func(event string, data interface{}) {
		emitted = append(emitted, event)
	})
	if err != nil {
		t.Fatal(err)
	}
	embedVersion := e.snapshot().Version
	e.SetRefreshURL(srv.URL)

	e.Refresh(context.Background()) // must not panic, must not swap

	if v := e.snapshot().Version; v != embedVersion {
		t.Errorf("version = %q, want unchanged embed %q", v, embedVersion)
	}
	if len(emitted) != 0 {
		t.Errorf("emitted = %v, want none on failure", emitted)
	}
}
