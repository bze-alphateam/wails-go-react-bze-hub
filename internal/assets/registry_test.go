package assets

import "testing"

func TestLoadEmbedded(t *testing.T) {
	reg, err := LoadEmbedded()
	if err != nil {
		t.Fatalf("LoadEmbedded: %v", err)
	}
	if len(reg.Chains) == 0 {
		t.Fatal("embedded registry has no chains")
	}

	// The BZE native asset must be present and correct — the whole app leans on it.
	ubze, ok := reg.BZEAsset("ubze")
	if !ok {
		t.Fatal("embedded registry missing ubze")
	}
	if ubze.Symbol != "BZE" || ubze.Name != "BeeZee" || ubze.Exponent() != 6 {
		t.Errorf("ubze = %+v, want BZE/BeeZee/6", ubze)
	}

	// Counterpart chains used for IBC naming must be present.
	for _, base := range []string{"uosmo", "uusdc", "aarch", "ujkl", "uflix", "uatone"} {
		if _, _, ok := reg.FindByBase(base); !ok {
			t.Errorf("embedded registry missing counterpart asset %q", base)
		}
	}
}

func TestFindByBaseReturnsChain(t *testing.T) {
	reg, err := LoadEmbedded()
	if err != nil {
		t.Fatal(err)
	}
	asset, chain, ok := reg.FindByBase("uusdc")
	if !ok {
		t.Fatal("uusdc not found")
	}
	if asset.Symbol != "USDC" {
		t.Errorf("symbol = %q, want USDC", asset.Symbol)
	}
	if chain.ChainID != "noble-1" {
		t.Errorf("chainId = %q, want noble-1", chain.ChainID)
	}
}

func TestChainByID(t *testing.T) {
	reg, _ := LoadEmbedded()
	c, ok := reg.ChainByID("noble-1")
	if !ok || c.ChainName != "noble" || c.PrettyName != "Noble" {
		t.Errorf("ChainByID(noble-1) = %+v, %v", c, ok)
	}
	if _, ok := reg.ChainByID("does-not-exist"); ok {
		t.Error("expected miss for unknown chain id")
	}
}

func TestParseRegistryRejectsEmpty(t *testing.T) {
	if _, err := parseRegistry([]byte(`{"chains":[]}`)); err == nil {
		t.Error("expected error for registry with no chains")
	}
	if _, err := parseRegistry([]byte(`not json`)); err == nil {
		t.Error("expected error for invalid json")
	}
}
