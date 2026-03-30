package wallet

import (
	"strings"
	"testing"
)

func TestGenerateMnemonic(t *testing.T) {
	mnemonic, err := GenerateMnemonic()
	if err != nil {
		t.Fatalf("GenerateMnemonic failed: %v", err)
	}

	words := strings.Fields(mnemonic)
	if len(words) != 24 {
		t.Fatalf("expected 24 words, got %d", len(words))
	}

	if !ValidateMnemonic(mnemonic) {
		t.Fatal("generated mnemonic should be valid")
	}
}

func TestValidateMnemonic(t *testing.T) {
	tests := []struct {
		name     string
		mnemonic string
		valid    bool
	}{
		{"empty", "", false},
		{"too few words", "abandon abandon abandon", false},
		{"invalid words", "notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword notaword", false},
		{"valid 12 words", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ValidateMnemonic(tt.mnemonic)
			if got != tt.valid {
				t.Errorf("ValidateMnemonic(%q) = %v, want %v", tt.mnemonic, got, tt.valid)
			}
		})
	}
}

func TestDeriveKey(t *testing.T) {
	// Known test mnemonic (DO NOT use for real funds)
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

	key, err := DeriveKey(mnemonic, 0)
	if err != nil {
		t.Fatalf("DeriveKey failed: %v", err)
	}

	if !strings.HasPrefix(key.Bech32Address, "bze") {
		t.Errorf("address should start with 'bze', got %s", key.Bech32Address)
	}

	if key.HDPath != "m/44'/118'/0'/0/0" {
		t.Errorf("expected path m/44'/118'/0'/0/0, got %s", key.HDPath)
	}

	if key.Index != 0 {
		t.Errorf("expected index 0, got %d", key.Index)
	}

	if len(key.PubKeyHex) == 0 {
		t.Error("pubkey should not be empty")
	}

	if len(key.PrivKeyHex) != 64 { // 32 bytes = 64 hex chars
		t.Errorf("privkey should be 64 hex chars, got %d", len(key.PrivKeyHex))
	}

	// Derive index 1 — should produce a different address
	key1, err := DeriveKey(mnemonic, 1)
	if err != nil {
		t.Fatalf("DeriveKey index 1 failed: %v", err)
	}

	if key1.Bech32Address == key.Bech32Address {
		t.Error("index 0 and index 1 should produce different addresses")
	}

	if key1.HDPath != "m/44'/118'/0'/0/1" {
		t.Errorf("expected path m/44'/118'/0'/0/1, got %s", key1.HDPath)
	}
}

func TestAddressFromPrivKey(t *testing.T) {
	// Generate a mnemonic, derive a key, then verify AddressFromPrivKey matches
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

	key, err := DeriveKey(mnemonic, 0)
	if err != nil {
		t.Fatalf("DeriveKey failed: %v", err)
	}

	addr, pubHex, err := AddressFromPrivKey(key.PrivKeyHex)
	if err != nil {
		t.Fatalf("AddressFromPrivKey failed: %v", err)
	}

	if addr != key.Bech32Address {
		t.Errorf("address mismatch: got %s, want %s", addr, key.Bech32Address)
	}

	if pubHex != key.PubKeyHex {
		t.Errorf("pubkey mismatch: got %s, want %s", pubHex, key.PubKeyHex)
	}
}

func TestDeriveKeyDeterministic(t *testing.T) {
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

	key1, _ := DeriveKey(mnemonic, 0)
	key2, _ := DeriveKey(mnemonic, 0)

	if key1.Bech32Address != key2.Bech32Address {
		t.Error("same mnemonic + index should produce same address")
	}

	if key1.PrivKeyHex != key2.PrivKeyHex {
		t.Error("same mnemonic + index should produce same privkey")
	}
}

func TestVerifyMnemonicWords(t *testing.T) {
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

	ok := VerifyMnemonicWords(mnemonic, []int{0, 5, 11}, []string{"abandon", "abandon", "about"})
	if !ok {
		t.Error("correct words should verify")
	}

	ok = VerifyMnemonicWords(mnemonic, []int{0, 5, 11}, []string{"abandon", "abandon", "wrong"})
	if ok {
		t.Error("incorrect words should not verify")
	}
}
