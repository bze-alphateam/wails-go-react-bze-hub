package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/config"
	"github.com/bze-alphateam/bze-hub/internal/proxy"
	"github.com/bze-alphateam/bze-hub/internal/routines"
	"github.com/bze-alphateam/bze-hub/internal/state"
	"github.com/bze-alphateam/bze-hub/internal/wallet"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct holds the application state and provides methods
// that are bound to the frontend via Wails.
type App struct {
	ctx      context.Context
	wallet   *wallet.Wallet
	store    config.AccountStore
	settings config.AppSettings

	// Shared state — thread-safe, emits events to frontend
	appState *state.AppState

	// Routine manager — tracks goroutines for graceful shutdown
	routines *routines.Manager

	// Proxy servers
	restProxy *proxy.EndpointProxy
	rpcProxy  *proxy.EndpointProxy

	// Held in memory after unlock (Windows/Linux only).
	// On macOS this is empty — OS keyring handles auth.
	password string

	// Temporary state for mnemonic verification during wizard
	pendingMnemonic     string
	verificationIndices []int

	// Price cache
	cachedBzePrice  float64
	cachedPriceTime time.Time
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

	// Initialize shared state
	a.appState = state.New()
	a.appState.SetContext(ctx)
	if a.store.ActiveAddress != "" {
		label := ""
		for _, acc := range a.store.Accounts {
			if acc.Bech32Address == a.store.ActiveAddress {
				label = acc.Label
				break
			}
		}
		a.appState.SetActiveAccount(a.store.ActiveAddress, label)
	}

	// Initialize routine manager
	a.routines = routines.NewManager(ctx)

	// Start proxy servers
	a.startProxies()
}

// startProxies initializes and starts REST + RPC proxy servers in background goroutines.
func (a *App) startProxies() {
	proxyCfg := proxy.Config{
		RESTPort:       a.settings.ProxyRESTPort,
		RPCPort:        a.settings.ProxyRPCPort,
		LocalRESTAddr:  "http://localhost:1317",
		LocalRPCAddr:   "http://localhost:26657",
		PublicRESTAddr: "https://rest.getbze.com",
		PublicRPCAddr:  "https://rpc.getbze.com",
		TimeoutMs:      a.settings.LocalNodeTimeoutMs,
		FailThreshold:  a.settings.CircuitBreakerThreshold,
		CooldownSec:    a.settings.CircuitBreakerCooldownSec,
	}

	restProxy, err := proxy.NewEndpointProxy("REST", proxyCfg.LocalRESTAddr, proxyCfg.PublicRESTAddr, a.appState, proxyCfg)
	if err != nil {
		fmt.Printf("[app] ERROR: failed to create REST proxy: %v\n", err)
		return
	}
	a.restProxy = restProxy

	rpcProxy, err := proxy.NewEndpointProxy("RPC", proxyCfg.LocalRPCAddr, proxyCfg.PublicRPCAddr, a.appState, proxyCfg)
	if err != nil {
		fmt.Printf("[app] ERROR: failed to create RPC proxy: %v\n", err)
		return
	}
	a.rpcProxy = rpcProxy

	// Start REST proxy in background
	a.routines.Go("rest-proxy", func(ctx context.Context) {
		if err := a.restProxy.Start(proxyCfg.RESTPort); err != nil {
			fmt.Printf("[app] ERROR: REST proxy failed: %v\n", err)
		}
	})

	// Start RPC proxy in background
	a.routines.Go("rpc-proxy", func(ctx context.Context) {
		if err := a.rpcProxy.Start(proxyCfg.RPCPort); err != nil {
			fmt.Printf("[app] ERROR: RPC proxy failed: %v\n", err)
		}
	})

	fmt.Printf("[app] proxies started (REST :%d, RPC :%d)\n", proxyCfg.RESTPort, proxyCfg.RPCPort)
}

// shutdown is called when the app is closing.
func (a *App) shutdown(ctx context.Context) {
	// Stop proxy servers
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if a.restProxy != nil {
		a.restProxy.Stop(shutdownCtx)
	}
	if a.rpcProxy != nil {
		a.rpcProxy.Stop(shutdownCtx)
	}

	// Stop all background routines
	if a.routines != nil {
		a.routines.Shutdown(30 * time.Second)
	}

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
	// Update shared state so frontend stays in sync
	label := ""
	for _, acc := range a.store.Accounts {
		if acc.Bech32Address == address {
			label = acc.Label
			break
		}
	}
	a.appState.SetActiveAccount(address, label)
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

// --- Node state (read-only for frontend) ---

// GetNodeSnapshot returns the current node state for the frontend.
func (a *App) GetNodeSnapshot() map[string]interface{} {
	snap := a.appState.GetNodeSnapshot()
	return map[string]interface{}{
		"status":       snap.Status,
		"height":       snap.Height,
		"targetHeight": snap.TargetHeight,
		"proxyTarget":  snap.ProxyTarget,
		"currentWork":  snap.CurrentWork,
	}
}

// --- Dashboard data ---

// GetBalance fetches the BZE balance for the active account via the local proxy.
func (a *App) GetBalance() (map[string]interface{}, error) {
	address := a.appState.GetActiveAddress()
	if address == "" {
		return map[string]interface{}{"amount": "0", "denom": "ubze"}, nil
	}

	proxyREST := fmt.Sprintf("http://localhost:%d", a.settings.ProxyRESTPort)
	url := fmt.Sprintf("%s/cosmos/bank/v1beta1/balances/%s/by_denom?denom=ubze", proxyREST, address)

	resp, err := a.httpGet(url)
	if err != nil {
		return nil, fmt.Errorf("balance query failed: %w", err)
	}
	return resp, nil
}

// GetBzePrice returns the current BZE price in USD, cached for 5 minutes.
func (a *App) GetBzePrice() (float64, error) {
	if time.Since(a.cachedPriceTime) < 5*time.Minute && a.cachedBzePrice > 0 {
		return a.cachedBzePrice, nil
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get("https://api.coingecko.com/api/v3/simple/price?ids=bzedge&vs_currencies=usd")
	if err != nil {
		if a.cachedBzePrice > 0 {
			return a.cachedBzePrice, nil // Return stale cache on error
		}
		return 0, fmt.Errorf("price fetch failed: %w", err)
	}
	defer resp.Body.Close()

	var result map[string]map[string]float64
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		if a.cachedBzePrice > 0 {
			return a.cachedBzePrice, nil
		}
		return 0, fmt.Errorf("price parse failed: %w", err)
	}

	if bze, ok := result["bzedge"]; ok {
		if usd, ok := bze["usd"]; ok {
			a.cachedBzePrice = usd
			a.cachedPriceTime = time.Now()
			return usd, nil
		}
	}

	if a.cachedBzePrice > 0 {
		return a.cachedBzePrice, nil
	}
	return 0, fmt.Errorf("price not found in response")
}

// GetAllBalances fetches the BZE balance for all accounts via the local proxy.
func (a *App) GetAllBalances() ([]map[string]interface{}, error) {
	proxyREST := fmt.Sprintf("http://localhost:%d", a.settings.ProxyRESTPort)
	var results []map[string]interface{}

	for _, acc := range a.store.Accounts {
		url := fmt.Sprintf("%s/cosmos/bank/v1beta1/balances/%s/by_denom?denom=ubze", proxyREST, acc.Bech32Address)
		resp, err := a.httpGet(url)
		amount := "0"
		if err == nil {
			if bal, ok := resp["balance"].(map[string]interface{}); ok {
				if a, ok := bal["amount"].(string); ok {
					amount = a
				}
			}
		}
		results = append(results, map[string]interface{}{
			"address": acc.Bech32Address,
			"label":   acc.Label,
			"amount":  amount,
		})
	}
	return results, nil
}

// GetArticles fetches the latest CoinTrunk articles via the local proxy,
// enriched with publisher names.
func (a *App) GetArticles(limit int) ([]map[string]interface{}, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}

	proxyREST := fmt.Sprintf("http://localhost:%d", a.settings.ProxyRESTPort)

	// Fetch publishers to build address → name map
	publisherMap := a.getPublisherNames(proxyREST)

	// Fetch articles
	articlesURL := fmt.Sprintf("%s/bze/cointrunk/all_articles?pagination.limit=%d&pagination.reverse=true", proxyREST, limit)
	resp, err := a.httpGet(articlesURL)
	if err != nil {
		return nil, fmt.Errorf("articles query failed: %w", err)
	}

	articles, ok := resp["article"].([]interface{})
	if !ok {
		return []map[string]interface{}{}, nil
	}

	result := make([]map[string]interface{}, 0, len(articles))
	for _, article := range articles {
		if m, ok := article.(map[string]interface{}); ok {
			// Enrich with publisher name
			if addr, ok := m["publisher"].(string); ok {
				if name, exists := publisherMap[addr]; exists {
					m["publisherName"] = name
				} else {
					m["publisherName"] = truncateAddress(addr)
				}
			}
			result = append(result, m)
		}
	}
	return result, nil
}

// getPublisherNames fetches all publishers and returns an address → name map.
func (a *App) getPublisherNames(proxyREST string) map[string]string {
	result := make(map[string]string)
	url := fmt.Sprintf("%s/bze/cointrunk/publishers?pagination.limit=100", proxyREST)
	resp, err := a.httpGet(url)
	if err != nil {
		return result
	}
	publishers, ok := resp["publisher"].([]interface{})
	if !ok {
		return result
	}
	for _, p := range publishers {
		if m, ok := p.(map[string]interface{}); ok {
			addr, _ := m["address"].(string)
			name, _ := m["name"].(string)
			if addr != "" && name != "" {
				result[addr] = name
			}
		}
	}
	return result
}

func truncateAddress(addr string) string {
	if len(addr) > 16 {
		return addr[:8] + "..." + addr[len(addr)-4:]
	}
	return addr
}

// OpenURL opens a URL in the system browser.
func (a *App) OpenURL(url string) {
	wailsRuntime.BrowserOpenURL(a.ctx, url)
}

// httpGet is a helper that fetches JSON from a URL and returns it as a map.
func (a *App) httpGet(url string) (map[string]interface{}, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result, nil
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
