package main

import (
	"context"
	"fmt"

	"github.com/bze-alphateam/bze-hub/internal/config"
	"github.com/bze-alphateam/bze-hub/internal/wallet"
)

// App struct holds the application state and provides methods
// that are bound to the frontend via Wails.
type App struct {
	ctx      context.Context
	wallet   *wallet.Wallet
	store    config.AccountStore
	settings config.AppSettings

	// Held in memory after unlock (Windows/Linux only).
	// On macOS this is empty — OS keyring handles auth.
	password string

	// Temporary state for mnemonic verification during wizard
	pendingMnemonic     string
	verificationIndices []int
}

// NewApp creates a new App application struct.
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Ensure data directories exist
	if err := config.EnsureDirs(); err != nil {
		fmt.Printf("[app] ERROR: failed to create data dirs: %v\n", err)
	}

	// Load settings and accounts
	settings, err := config.LoadSettings()
	if err != nil {
		fmt.Printf("[app] ERROR: failed to load settings: %v\n", err)
		settings = config.DefaultSettings()
	}
	a.settings = settings

	store, err := config.LoadAccounts()
	if err != nil {
		fmt.Printf("[app] ERROR: failed to load accounts: %v\n", err)
	}
	a.store = store
	a.wallet = wallet.NewWallet(&a.store)
}

// shutdown is called when the app is closing.
func (a *App) shutdown(ctx context.Context) {
	// Zero password from memory
	for i := range a.password {
		a.password = a.password[:i] + "\x00" + a.password[i+1:]
	}
	a.password = ""

	// Zero pending mnemonic
	a.pendingMnemonic = ""
}

// --- First-run detection ---

// IsFirstRun returns true if this is the first launch (no settings.json).
func (a *App) IsFirstRun() bool {
	return !config.SettingsExist()
}

// NeedsPassword returns true if the platform requires an app password (Windows/Linux).
func (a *App) NeedsPassword() bool {
	return wallet.NeedsPassword()
}

// --- Wallet creation (wizard flow) ---

// GenerateNewWallet creates a new mnemonic and first account.
// Returns: { mnemonic: string, account: Account }
// The mnemonic is also stored in a.pendingMnemonic for verification.
func (a *App) GenerateNewWallet(label string, password string) (map[string]interface{}, error) {
	mnemonic, account, err := a.wallet.GenerateNewWallet(label, password)
	if err != nil {
		return nil, err
	}

	a.password = password
	a.pendingMnemonic = mnemonic

	if err := config.SaveAccounts(a.store); err != nil {
		return nil, fmt.Errorf("save accounts: %w", err)
	}

	return map[string]interface{}{
		"mnemonic": mnemonic,
		"account":  accountToMap(account),
	}, nil
}

// GetVerificationIndices returns 4 random word positions for mnemonic verification.
func (a *App) GetVerificationIndices() []int {
	a.verificationIndices = wallet.GetRandomVerificationIndices()
	return a.verificationIndices
}

// VerifyMnemonicWords checks if the user correctly entered the verification words.
func (a *App) VerifyMnemonicWords(answers []string) bool {
	if a.pendingMnemonic == "" || len(a.verificationIndices) == 0 {
		return false
	}
	return wallet.VerifyMnemonicWords(a.pendingMnemonic, a.verificationIndices, answers)
}

// CompleteSetup finalizes the first-run wizard.
func (a *App) CompleteSetup(trusted bool) error {
	a.settings.Trusted = trusted
	a.pendingMnemonic = ""
	a.verificationIndices = nil

	return config.SaveSettings(a.settings)
}

// --- Wallet operations ---

// ImportMnemonic adds a new mnemonic to the wallet (does NOT replace existing ones).
func (a *App) ImportMnemonic(label string, mnemonic string, password string) (map[string]interface{}, error) {
	if password == "" {
		password = a.password
	}
	account, err := a.wallet.ImportMnemonic(label, mnemonic, password)
	if err != nil {
		return nil, err
	}
	if err := config.SaveAccounts(a.store); err != nil {
		return nil, fmt.Errorf("save accounts: %w", err)
	}
	return accountToMap(account), nil
}

// ImportPrivateKey imports a standalone private key.
func (a *App) ImportPrivateKey(label string, privKeyHex string, password string) (map[string]interface{}, error) {
	if password == "" {
		password = a.password
	}
	account, err := a.wallet.ImportPrivateKey(label, privKeyHex, password)
	if err != nil {
		return nil, err
	}
	if err := config.SaveAccounts(a.store); err != nil {
		return nil, fmt.Errorf("save accounts: %w", err)
	}
	return accountToMap(account), nil
}

// DeriveNewAddress derives the next address from a mnemonic.
func (a *App) DeriveNewAddress(mnemonicLabel string, accountLabel string, password string) (map[string]interface{}, error) {
	if password == "" {
		password = a.password
	}
	account, err := a.wallet.DeriveNewAddress(mnemonicLabel, accountLabel, password)
	if err != nil {
		return nil, err
	}
	if err := config.SaveAccounts(a.store); err != nil {
		return nil, fmt.Errorf("save accounts: %w", err)
	}
	return accountToMap(account), nil
}

// ExportMnemonic retrieves a mnemonic for display to the user.
func (a *App) ExportMnemonic(label string, password string) (string, error) {
	if password == "" {
		password = a.password
	}
	return a.wallet.ExportMnemonic(label, password)
}

// ExportPrivateKey retrieves a private key for display to the user.
func (a *App) ExportPrivateKey(address string, password string) (string, error) {
	if password == "" {
		password = a.password
	}
	return wallet.GetSecret(wallet.PKKey(address), password)
}

// DeleteAccount removes an account from the wallet.
func (a *App) DeleteAccount(address string) error {
	// Check if this is the last account for its mnemonic
	var mnemonicLabel string
	for _, acc := range a.store.Accounts {
		if acc.Bech32Address == address {
			mnemonicLabel = acc.MnemonicLabel
			break
		}
	}

	if err := a.wallet.DeleteAccount(address); err != nil {
		return err
	}

	// Offer to clean up orphaned mnemonic (just do it silently for now)
	if mnemonicLabel != "" {
		a.wallet.DeleteMnemonicIfOrphaned(mnemonicLabel)
	}

	return config.SaveAccounts(a.store)
}

// RenameAccount updates an account's label.
func (a *App) RenameAccount(address string, newLabel string) error {
	if err := a.store.RenameAccount(address, newLabel); err != nil {
		return err
	}
	return config.SaveAccounts(a.store)
}

// --- Account management ---

// GetAccounts returns all accounts and the active address.
func (a *App) GetAccounts() map[string]interface{} {
	accounts := make([]map[string]interface{}, 0, len(a.store.Accounts))
	for _, acc := range a.store.Accounts {
		accounts = append(accounts, accountToMap(acc))
	}

	mnemonics := make([]map[string]interface{}, 0, len(a.store.Mnemonics))
	for _, m := range a.store.Mnemonics {
		mnemonics = append(mnemonics, map[string]interface{}{
			"label":     m.Label,
			"createdAt": m.CreatedAt,
		})
	}

	return map[string]interface{}{
		"accounts":      accounts,
		"mnemonics":     mnemonics,
		"activeAddress": a.store.ActiveAddress,
	}
}

// SwitchAccount sets the active account.
func (a *App) SwitchAccount(address string) error {
	if err := a.store.SetActive(address); err != nil {
		return err
	}
	return config.SaveAccounts(a.store)
}

// --- Auth ---

// Unlock verifies the app password (Windows/Linux).
// On macOS this is a no-op (OS handles auth).
func (a *App) Unlock(password string) error {
	if !wallet.NeedsPassword() {
		return nil
	}
	if err := wallet.Unlock(password); err != nil {
		return err
	}
	a.password = password
	return nil
}

// --- Settings ---

// GetSettings returns current app settings.
func (a *App) GetSettings() map[string]interface{} {
	return map[string]interface{}{
		"trusted":       a.settings.Trusted,
		"autoStartNode": a.settings.AutoStartNode,
		"theme":         a.settings.Theme,
		"logLevel":      a.settings.LogLevel,
		"developerMode": a.settings.DeveloperMode,
	}
}

// GetVersion returns the application version.
func (a *App) GetVersion() string {
	return "0.1.0"
}

// --- Helpers ---

func accountToMap(acc config.Account) map[string]interface{} {
	return map[string]interface{}{
		"label":         acc.Label,
		"bech32Address": acc.Bech32Address,
		"pubKeyHex":     acc.PubKeyHex,
		"hdPath":        acc.HDPath,
		"accountIndex":  acc.AccountIndex,
		"mnemonicLabel": acc.MnemonicLabel,
		"isImportedPK":  acc.IsImportedPK,
		"createdAt":     acc.CreatedAt,
	}
}
