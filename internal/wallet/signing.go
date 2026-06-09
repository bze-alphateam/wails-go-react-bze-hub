package wallet

import (
	"encoding/hex"
	"fmt"

	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
)

// PrivKeyFromHex builds a secp256k1 private key from a hex string.
// The caller is responsible for zeroing the returned key's bytes after use.
func PrivKeyFromHex(privKeyHex string) (*secp256k1.PrivKey, error) {
	pkBytes, err := hex.DecodeString(privKeyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid private key hex: %w", err)
	}
	return &secp256k1.PrivKey{Key: pkBytes}, nil
}
