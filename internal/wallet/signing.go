package wallet

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"

	"github.com/bze-alphateam/bze-hub/internal/crypto"
)

// AminoSignResponse matches the Keplr AminoSignResponse structure.
type AminoSignResponse struct {
	Signed    json.RawMessage `json:"signed"`
	Signature SignatureJSON   `json:"signature"`
}

// DirectSignResponse matches the Keplr DirectSignResponse structure.
type DirectSignResponse struct {
	Signed    json.RawMessage `json:"signed"`
	Signature SignatureJSON   `json:"signature"`
}

// SignatureJSON is the JSON-encoded signature with public key.
type SignatureJSON struct {
	PubKey    PubKeyJSON `json:"pub_key"`
	Signature string     `json:"signature"` // Base64-encoded
}

// PubKeyJSON is the JSON representation of a public key.
type PubKeyJSON struct {
	Type  string `json:"type"`
	Value string `json:"value"` // Base64-encoded
}

// SignAmino signs an amino-encoded sign document.
// privKeyHex is the hex-encoded secp256k1 private key.
// signDocJSON is the canonical JSON sign doc.
func SignAmino(privKeyHex string, signDocJSON string) (*AminoSignResponse, error) {
	pkBytes, err := hex.DecodeString(privKeyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid private key hex: %w", err)
	}
	defer crypto.SecureZero(pkBytes)

	privKey := &secp256k1.PrivKey{Key: pkBytes}
	defer crypto.SecureZero(privKey.Key)

	// Sort JSON for canonical encoding
	sortedBytes, err := sortJSON([]byte(signDocJSON))
	if err != nil {
		return nil, fmt.Errorf("failed to sort sign doc: %w", err)
	}

	hash := sha256.Sum256(sortedBytes)
	sig, err := privKey.Sign(hash[:])
	if err != nil {
		return nil, fmt.Errorf("signing failed: %w", err)
	}

	pubKeyBytes := privKey.PubKey().Bytes()

	return &AminoSignResponse{
		Signed: json.RawMessage(signDocJSON),
		Signature: SignatureJSON{
			PubKey: PubKeyJSON{
				Type:  "tendermint/PubKeySecp256k1",
				Value: base64.StdEncoding.EncodeToString(pubKeyBytes),
			},
			Signature: base64.StdEncoding.EncodeToString(sig),
		},
	}, nil
}

// SignDirect signs a protobuf-encoded sign document.
// privKeyHex is the hex-encoded secp256k1 private key.
// signDocBytes is the raw sign doc bytes (already serialized protobuf).
func SignDirect(privKeyHex string, signDocBytes []byte) (*DirectSignResponse, error) {
	pkBytes, err := hex.DecodeString(privKeyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid private key hex: %w", err)
	}
	defer crypto.SecureZero(pkBytes)

	privKey := &secp256k1.PrivKey{Key: pkBytes}
	defer crypto.SecureZero(privKey.Key)

	hash := sha256.Sum256(signDocBytes)
	sig, err := privKey.Sign(hash[:])
	if err != nil {
		return nil, fmt.Errorf("signing failed: %w", err)
	}

	pubKeyBytes := privKey.PubKey().Bytes()

	return &DirectSignResponse{
		Signed: signDocBytes,
		Signature: SignatureJSON{
			PubKey: PubKeyJSON{
				Type:  "tendermint/PubKeySecp256k1",
				Value: base64.StdEncoding.EncodeToString(pubKeyBytes),
			},
			Signature: base64.StdEncoding.EncodeToString(sig),
		},
	}, nil
}

// sortJSON canonically sorts a JSON object for deterministic hashing.
func sortJSON(raw []byte) ([]byte, error) {
	var obj interface{}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, err
	}
	sorted := sortValue(obj)
	return json.Marshal(sorted)
}

func sortValue(v interface{}) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		sorted := make(map[string]interface{})
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			sorted[k] = sortValue(val[k])
		}
		return sorted
	case []interface{}:
		for i, item := range val {
			val[i] = sortValue(item)
		}
		return val
	default:
		return val
	}
}
