package wallet

import (
	"encoding/base64"
	"runtime"

	"github.com/bze-alphateam/bze-hub/internal/crypto"
	"github.com/zalando/go-keyring"
)

const keyringService = "bze-hub"

// NeedsPassword returns true if the platform requires an application-level password
// for keyring encryption (Windows and Linux). macOS Keychain handles auth natively.
func NeedsPassword() bool {
	return runtime.GOOS != "darwin"
}

// StoreSecret stores a secret in the OS keyring.
// On macOS: stores directly (Keychain handles encryption and per-access auth).
// On Windows/Linux: encrypts with the app password before storing.
func StoreSecret(keyringKey string, secret string, password string) error {
	if !NeedsPassword() {
		return keyring.Set(keyringService, keyringKey, secret)
	}

	encrypted, err := crypto.EncryptWithPassword([]byte(secret), password)
	if err != nil {
		return err
	}
	return keyring.Set(keyringService, keyringKey, base64.StdEncoding.EncodeToString(encrypted))
}

// GetSecret retrieves a secret from the OS keyring.
// On macOS: retrieves directly (OS prompts for Touch ID / system password).
// On Windows/Linux: decrypts with the app password.
func GetSecret(keyringKey string, password string) (string, error) {
	raw, err := keyring.Get(keyringService, keyringKey)
	if err != nil {
		return "", err
	}

	if !NeedsPassword() {
		return raw, nil
	}

	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return "", err
	}

	plaintext, err := crypto.DecryptWithPassword(data, password)
	if err != nil {
		return "", err
	}
	defer crypto.SecureZero(plaintext)

	return string(plaintext), nil
}

// DeleteSecret removes a secret from the OS keyring.
func DeleteSecret(keyringKey string) error {
	return keyring.Delete(keyringService, keyringKey)
}

// Keyring key helpers

func MnemonicKey(label string) string {
	return "mnemonic:" + label
}

func PKKey(address string) string {
	return "pk:" + address
}
