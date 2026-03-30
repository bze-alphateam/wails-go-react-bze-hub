package wallet

import (
	"fmt"
	"math/rand"

	"github.com/bze-alphateam/bze-hub/internal/config"
	"github.com/bze-alphateam/bze-hub/internal/crypto"
)

// Wallet provides high-level wallet operations.
// It orchestrates keyring access, key derivation, and account management.
type Wallet struct {
	store *config.AccountStore
}

// NewWallet creates a new Wallet instance.
func NewWallet(store *config.AccountStore) *Wallet {
	return &Wallet{store: store}
}

// Store returns the underlying account store (for reading account data).
func (w *Wallet) Store() *config.AccountStore {
	return w.store
}

// GenerateNewWallet creates a new mnemonic, stores it and the first derived PK in the keyring,
// and adds the mnemonic ref + first account to the account store.
// Returns the generated mnemonic (caller must display it to the user) and the first account.
func (w *Wallet) GenerateNewWallet(label string, password string) (mnemonic string, account config.Account, err error) {
	mnemonic, err = GenerateMnemonic()
	if err != nil {
		return "", config.Account{}, fmt.Errorf("generate mnemonic: %w", err)
	}

	// Store mnemonic in keyring
	if err := StoreSecret(MnemonicKey(label), mnemonic, password); err != nil {
		return "", config.Account{}, fmt.Errorf("store mnemonic: %w", err)
	}

	// Derive first address (index 0)
	derived, err := DeriveKey(mnemonic, 0)
	if err != nil {
		return "", config.Account{}, fmt.Errorf("derive key: %w", err)
	}
	defer crypto.SecureZero([]byte(derived.PrivKeyHex))

	// Store PK in keyring
	if err := StoreSecret(PKKey(derived.Bech32Address), derived.PrivKeyHex, password); err != nil {
		return "", config.Account{}, fmt.Errorf("store pk: %w", err)
	}

	// Update account store
	w.store.AddMnemonic(label)
	account = config.Account{
		Label:         label,
		Bech32Address: derived.Bech32Address,
		PubKeyHex:     derived.PubKeyHex,
		HDPath:        derived.HDPath,
		AccountIndex:  0,
		MnemonicLabel: label,
		IsImportedPK:  false,
	}
	w.store.AddAccount(account)

	return mnemonic, account, nil
}

// ImportMnemonic validates and stores an imported mnemonic, derives the first address,
// and adds both to the account store. Does NOT replace existing mnemonics.
func (w *Wallet) ImportMnemonic(label string, mnemonic string, password string) (config.Account, error) {
	if !ValidateMnemonic(mnemonic) {
		return config.Account{}, fmt.Errorf("invalid mnemonic: must be 12 or 24 valid BIP39 words")
	}

	if w.store.HasMnemonic(label) {
		return config.Account{}, fmt.Errorf("a mnemonic with label %q already exists", label)
	}

	// Store mnemonic in keyring
	if err := StoreSecret(MnemonicKey(label), mnemonic, password); err != nil {
		return config.Account{}, fmt.Errorf("store mnemonic: %w", err)
	}

	// Derive first address (index 0)
	derived, err := DeriveKey(mnemonic, 0)
	if err != nil {
		return config.Account{}, fmt.Errorf("derive key: %w", err)
	}
	defer crypto.SecureZero([]byte(derived.PrivKeyHex))

	// Store PK in keyring
	if err := StoreSecret(PKKey(derived.Bech32Address), derived.PrivKeyHex, password); err != nil {
		return config.Account{}, fmt.Errorf("store pk: %w", err)
	}

	// Update account store
	w.store.AddMnemonic(label)
	account := config.Account{
		Label:         label,
		Bech32Address: derived.Bech32Address,
		PubKeyHex:     derived.PubKeyHex,
		HDPath:        derived.HDPath,
		AccountIndex:  0,
		MnemonicLabel: label,
		IsImportedPK:  false,
	}
	w.store.AddAccount(account)

	return account, nil
}

// ImportPrivateKey stores a standalone private key and adds the account.
func (w *Wallet) ImportPrivateKey(label string, privKeyHex string, password string) (config.Account, error) {
	address, pubKeyHex, err := AddressFromPrivKey(privKeyHex)
	if err != nil {
		return config.Account{}, fmt.Errorf("invalid private key: %w", err)
	}

	// Store PK in keyring
	if err := StoreSecret(PKKey(address), privKeyHex, password); err != nil {
		return config.Account{}, fmt.Errorf("store pk: %w", err)
	}

	account := config.Account{
		Label:         label,
		Bech32Address: address,
		PubKeyHex:     pubKeyHex,
		HDPath:        "",
		AccountIndex:  0,
		MnemonicLabel: "",
		IsImportedPK:  true,
	}
	w.store.AddAccount(account)

	return account, nil
}

// DeriveNewAddress derives the next address from an existing mnemonic.
func (w *Wallet) DeriveNewAddress(mnemonicLabel string, accountLabel string, password string) (config.Account, error) {
	if !w.store.HasMnemonic(mnemonicLabel) {
		return config.Account{}, fmt.Errorf("mnemonic %q not found", mnemonicLabel)
	}

	// Fetch mnemonic from keyring (only time we access it)
	mnemonic, err := GetSecret(MnemonicKey(mnemonicLabel), password)
	if err != nil {
		return config.Account{}, fmt.Errorf("get mnemonic: %w", err)
	}
	defer crypto.SecureZero([]byte(mnemonic))

	nextIndex := w.store.NextIndex(mnemonicLabel)

	derived, err := DeriveKey(mnemonic, nextIndex)
	if err != nil {
		return config.Account{}, fmt.Errorf("derive key: %w", err)
	}
	defer crypto.SecureZero([]byte(derived.PrivKeyHex))

	// Store PK in keyring
	if err := StoreSecret(PKKey(derived.Bech32Address), derived.PrivKeyHex, password); err != nil {
		return config.Account{}, fmt.Errorf("store pk: %w", err)
	}

	account := config.Account{
		Label:         accountLabel,
		Bech32Address: derived.Bech32Address,
		PubKeyHex:     derived.PubKeyHex,
		HDPath:        derived.HDPath,
		AccountIndex:  nextIndex,
		MnemonicLabel: mnemonicLabel,
		IsImportedPK:  false,
	}
	w.store.AddAccount(account)

	return account, nil
}

// ExportMnemonic retrieves a mnemonic from the keyring.
// Caller must display it to the user and ensure it's not logged.
func (w *Wallet) ExportMnemonic(label string, password string) (string, error) {
	if !w.store.HasMnemonic(label) {
		return "", fmt.Errorf("mnemonic %q not found", label)
	}
	return GetSecret(MnemonicKey(label), password)
}

// SignAminoTx signs an amino transaction using the PK for the given address.
// Fetches only the PK from keyring, signs, zeros PK immediately.
func (w *Wallet) SignAminoTx(address string, password string, signDocJSON string) (*AminoSignResponse, error) {
	pkHex, err := GetSecret(PKKey(address), password)
	if err != nil {
		return nil, fmt.Errorf("get pk for %s: %w", address, err)
	}
	defer crypto.SecureZero([]byte(pkHex))

	return SignAmino(pkHex, signDocJSON)
}

// SignDirectTx signs a direct (protobuf) transaction using the PK for the given address.
func (w *Wallet) SignDirectTx(address string, password string, signDocBytes []byte) (*DirectSignResponse, error) {
	pkHex, err := GetSecret(PKKey(address), password)
	if err != nil {
		return nil, fmt.Errorf("get pk for %s: %w", address, err)
	}
	defer crypto.SecureZero([]byte(pkHex))

	return SignDirect(pkHex, signDocBytes)
}

// DeleteAccount removes an account and its PK from keyring.
func (w *Wallet) DeleteAccount(address string) error {
	if err := w.store.RemoveAccount(address); err != nil {
		return err
	}

	// Try to delete PK from keyring (ignore error if not found)
	_ = DeleteSecret(PKKey(address))

	return nil
}

// DeleteMnemonicIfOrphaned removes a mnemonic from keyring if no accounts reference it.
func (w *Wallet) DeleteMnemonicIfOrphaned(label string) bool {
	if w.store.AccountCountForMnemonic(label) > 0 {
		return false
	}
	_ = DeleteSecret(MnemonicKey(label))
	w.store.RemoveMnemonic(label)
	return true
}

// GetRandomVerificationIndices returns 4 random non-sequential word positions (0-23)
// for mnemonic backup verification.
func GetRandomVerificationIndices() []int {
	// Pick 4 unique random indices from 0-23
	perm := rand.Perm(24)
	indices := perm[:4]
	// Sort for display order
	for i := 0; i < len(indices)-1; i++ {
		for j := i + 1; j < len(indices); j++ {
			if indices[i] > indices[j] {
				indices[i], indices[j] = indices[j], indices[i]
			}
		}
	}
	return indices
}

// VerifyMnemonicWords checks if the provided answers match the mnemonic words at the given indices.
func VerifyMnemonicWords(mnemonic string, indices []int, answers []string) bool {
	words := splitMnemonicWords(mnemonic)
	if len(indices) != len(answers) {
		return false
	}
	for i, idx := range indices {
		if idx < 0 || idx >= len(words) {
			return false
		}
		if words[idx] != answers[i] {
			return false
		}
	}
	return true
}

func splitMnemonicWords(mnemonic string) []string {
	// Split on whitespace, filter empty
	var words []string
	for _, w := range split(mnemonic) {
		if w != "" {
			words = append(words, w)
		}
	}
	return words
}

func split(s string) []string {
	var result []string
	word := ""
	for _, c := range s {
		if c == ' ' || c == '\t' || c == '\n' {
			if word != "" {
				result = append(result, word)
				word = ""
			}
		} else {
			word += string(c)
		}
	}
	if word != "" {
		result = append(result, word)
	}
	return result
}

// Unlock verifies the password can decrypt a keyring entry.
// Used on Windows/Linux to validate the app password at startup.
func Unlock(password string) error {
	store, err := config.LoadAccounts()
	if err != nil {
		return err
	}
	if len(store.Accounts) == 0 {
		return fmt.Errorf("no accounts found")
	}

	// Try to read the first account's PK to verify password
	firstAddr := store.Accounts[0].Bech32Address
	pkHex, err := GetSecret(PKKey(firstAddr), password)
	if err != nil {
		return fmt.Errorf("incorrect password")
	}
	defer crypto.SecureZero([]byte(pkHex))

	return nil
}
