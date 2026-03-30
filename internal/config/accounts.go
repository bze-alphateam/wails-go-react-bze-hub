package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// MnemonicRef is a reference to a mnemonic stored in the keyring (not the mnemonic itself).
type MnemonicRef struct {
	Label     string `json:"label"`
	CreatedAt string `json:"createdAt"`
}

// Account represents a single address derived from a mnemonic or imported as a standalone PK.
type Account struct {
	Label         string `json:"label"`
	Bech32Address string `json:"bech32Address"`
	PubKeyHex     string `json:"pubKeyHex"`
	HDPath        string `json:"hdPath"`
	AccountIndex  uint32 `json:"accountIndex"`
	MnemonicLabel string `json:"mnemonicLabel"` // Which mnemonic this was derived from ("" for imported PK)
	IsImportedPK  bool   `json:"isImportedPK"`
	CreatedAt     string `json:"createdAt"`
}

// AccountStore holds all account metadata. Persisted to accounts.json.
type AccountStore struct {
	Mnemonics     []MnemonicRef `json:"mnemonics"`
	Accounts      []Account     `json:"accounts"`
	ActiveAddress string        `json:"activeAddress"`
}

func accountsPath() string {
	return filepath.Join(ConfigDir(), "accounts.json")
}

// LoadAccounts reads account data from disk. Returns empty store if file doesn't exist.
func LoadAccounts() (AccountStore, error) {
	var store AccountStore
	data, err := os.ReadFile(accountsPath())
	if os.IsNotExist(err) {
		return store, nil
	}
	if err != nil {
		return store, err
	}
	if err := json.Unmarshal(data, &store); err != nil {
		return AccountStore{}, err
	}
	return store, nil
}

// SaveAccounts writes account data to disk.
func SaveAccounts(store AccountStore) error {
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(accountsPath(), data, 0600)
}

// AddMnemonic adds a mnemonic reference to the store.
func (s *AccountStore) AddMnemonic(label string) {
	s.Mnemonics = append(s.Mnemonics, MnemonicRef{
		Label:     label,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

// AddAccount adds an account to the store.
func (s *AccountStore) AddAccount(acc Account) {
	if acc.CreatedAt == "" {
		acc.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	s.Accounts = append(s.Accounts, acc)
	// Set as active if it's the first account
	if s.ActiveAddress == "" {
		s.ActiveAddress = acc.Bech32Address
	}
}

// RemoveAccount removes an account by address. Returns error if it's the last account.
func (s *AccountStore) RemoveAccount(address string) error {
	if len(s.Accounts) <= 1 {
		return fmt.Errorf("cannot delete the last account")
	}
	idx := -1
	for i, acc := range s.Accounts {
		if acc.Bech32Address == address {
			idx = i
			break
		}
	}
	if idx == -1 {
		return fmt.Errorf("account not found: %s", address)
	}
	s.Accounts = append(s.Accounts[:idx], s.Accounts[idx+1:]...)
	// If we deleted the active account, switch to the first one
	if s.ActiveAddress == address {
		s.ActiveAddress = s.Accounts[0].Bech32Address
	}
	return nil
}

// SetActive sets the active account address.
func (s *AccountStore) SetActive(address string) error {
	for _, acc := range s.Accounts {
		if acc.Bech32Address == address {
			s.ActiveAddress = address
			return nil
		}
	}
	return fmt.Errorf("account not found: %s", address)
}

// RenameAccount updates an account's label.
func (s *AccountStore) RenameAccount(address, newLabel string) error {
	for i, acc := range s.Accounts {
		if acc.Bech32Address == address {
			s.Accounts[i].Label = newLabel
			return nil
		}
	}
	return fmt.Errorf("account not found: %s", address)
}

// NextIndex returns the next unused HD index for a given mnemonic label.
func (s *AccountStore) NextIndex(mnemonicLabel string) uint32 {
	var maxIndex uint32
	found := false
	for _, acc := range s.Accounts {
		if acc.MnemonicLabel == mnemonicLabel && !acc.IsImportedPK {
			if acc.AccountIndex >= maxIndex {
				maxIndex = acc.AccountIndex
				found = true
			}
		}
	}
	if !found {
		return 0
	}
	return maxIndex + 1
}

// HasMnemonic returns true if a mnemonic with the given label exists.
func (s *AccountStore) HasMnemonic(label string) bool {
	for _, m := range s.Mnemonics {
		if m.Label == label {
			return true
		}
	}
	return false
}

// MnemonicLabels returns all mnemonic labels.
func (s *AccountStore) MnemonicLabels() []string {
	labels := make([]string, 0, len(s.Mnemonics))
	for _, m := range s.Mnemonics {
		labels = append(labels, m.Label)
	}
	return labels
}

// AccountCountForMnemonic returns how many accounts are derived from a given mnemonic.
func (s *AccountStore) AccountCountForMnemonic(label string) int {
	count := 0
	for _, acc := range s.Accounts {
		if acc.MnemonicLabel == label {
			count++
		}
	}
	return count
}

// RemoveMnemonic removes a mnemonic reference by label.
func (s *AccountStore) RemoveMnemonic(label string) {
	for i, m := range s.Mnemonics {
		if m.Label == label {
			s.Mnemonics = append(s.Mnemonics[:i], s.Mnemonics[i+1:]...)
			return
		}
	}
}
