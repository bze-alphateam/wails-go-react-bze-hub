package wallet

import (
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/cosmos/cosmos-sdk/crypto/hd"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/go-bip39"

	"github.com/bze-alphateam/bze-hub/internal/crypto"
)

const (
	bip44CoinType = 118
	bech32Prefix  = "bze"
)

func init() {
	config := sdk.GetConfig()
	config.SetBech32PrefixForAccount(bech32Prefix, bech32Prefix+"pub")
	config.SetBech32PrefixForValidator(bech32Prefix+"valoper", bech32Prefix+"valoperpub")
	config.SetBech32PrefixForConsensusNode(bech32Prefix+"valcons", bech32Prefix+"valconspub")
	config.Seal()
}

// DerivedKey holds the result of key derivation.
type DerivedKey struct {
	Bech32Address string
	PubKeyHex     string // Compressed public key, hex-encoded
	PrivKeyHex    string // Private key, hex-encoded (caller must zero after use)
	HDPath        string
	Index         uint32
}

// GenerateMnemonic creates a new 24-word BIP39 mnemonic.
func GenerateMnemonic() (string, error) {
	entropy, err := bip39.NewEntropy(256)
	if err != nil {
		return "", fmt.Errorf("failed to generate entropy: %w", err)
	}
	mnemonic, err := bip39.NewMnemonic(entropy)
	if err != nil {
		return "", fmt.Errorf("failed to generate mnemonic: %w", err)
	}
	return mnemonic, nil
}

// ValidateMnemonic checks if a mnemonic is valid BIP39 (12 or 24 words).
func ValidateMnemonic(mnemonic string) bool {
	words := strings.Fields(strings.TrimSpace(mnemonic))
	if len(words) != 12 && len(words) != 24 {
		return false
	}
	return bip39.IsMnemonicValid(mnemonic)
}

// DeriveKey derives a key at the given BIP44 index from a mnemonic.
// Returns the derived key data. Caller MUST zero PrivKeyHex after use.
func DeriveKey(mnemonic string, index uint32) (*DerivedKey, error) {
	seed := bip39.NewSeed(mnemonic, "")
	defer crypto.SecureZero(seed)

	hdPath := hd.CreateHDPath(bip44CoinType, 0, index)

	masterKey, chainCode := hd.ComputeMastersFromSeed(seed)
	defer crypto.SecureZero(masterKey[:])
	defer crypto.SecureZero(chainCode[:])

	privKeyBytes, err := hd.DerivePrivateKeyForPath(masterKey, chainCode, hdPath.String())
	if err != nil {
		return nil, fmt.Errorf("key derivation failed: %w", err)
	}

	privKey := &secp256k1.PrivKey{Key: privKeyBytes}
	pubKey := privKey.PubKey()
	address := sdk.AccAddress(pubKey.Address())

	return &DerivedKey{
		Bech32Address: address.String(),
		PubKeyHex:     hex.EncodeToString(pubKey.Bytes()),
		PrivKeyHex:    hex.EncodeToString(privKeyBytes),
		HDPath:        hdPath.String(),
		Index:         index,
	}, nil
}

// AddressFromPrivKey derives a bech32 address from a hex-encoded private key.
func AddressFromPrivKey(privKeyHex string) (address string, pubKeyHex string, err error) {
	pkBytes, err := hex.DecodeString(privKeyHex)
	if err != nil {
		return "", "", fmt.Errorf("invalid hex key: %w", err)
	}
	defer crypto.SecureZero(pkBytes)

	if len(pkBytes) != 32 {
		return "", "", fmt.Errorf("private key must be 32 bytes, got %d", len(pkBytes))
	}

	privKey := &secp256k1.PrivKey{Key: pkBytes}
	pubKey := privKey.PubKey()
	addr := sdk.AccAddress(pubKey.Address())

	return addr.String(), hex.EncodeToString(pubKey.Bytes()), nil
}
