package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	secp256k1Lib "github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"

	"github.com/bze-alphateam/bze-hub/internal/config"
	"github.com/bze-alphateam/bze-hub/internal/logging"
	"github.com/bze-alphateam/bze-hub/internal/node"
	"github.com/bze-alphateam/bze-hub/internal/proxy"
	"github.com/bze-alphateam/bze-hub/internal/routines"
	"github.com/bze-alphateam/bze-hub/internal/state"
	"github.com/bze-alphateam/bze-hub/internal/wallet"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Build-time variable: URL to the remote config JSON.
// Set via: -ldflags "-X main.remoteConfigURL=https://..."
var remoteConfigURL = "https://raw.githubusercontent.com/bze-alphateam/bze-configs/refs/heads/main/bze-hub/mainnet.json"

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

	// Remote config (fetched from bze-configs)
	remoteConfig *node.RemoteConfig

	// Discovered ports
	ports node.PortSet

	// Node process + monitoring
	nodeProcess   *node.NodeProcess
	healthMonitor *node.HealthMonitor
	doctor        *node.Doctor

	// Whether we own the node (first instance) or are using another instance's node
	ownsNode bool

	// Price cache
	cachedBzePrice  float64
	cachedPriceTime time.Time

	// Force re-init cooldown
	lastForceReInit time.Time
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

	// Load settings first (need log level)
	settings, err := config.LoadSettings()
	if err != nil {
		fmt.Printf("[app] ERROR: failed to load settings: %v\n", err)
		settings = config.DefaultSettings()
	}
	a.settings = settings

	// Initialize logger
	logging.Init(settings.LogLevel)
	logging.Info("app", "BZE Hub starting (log level: %s)", settings.LogLevel)

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

	// Start node setup in background (instance detection, download, init, proxies)
	a.routines.Go("node-setup", func(ctx context.Context) {
		a.setupNode(ctx)
	})
}

// startProxies initializes and starts REST + RPC proxy servers in background goroutines.
// Uses the discovered ports from a.ports.
func (a *App) startProxies(publicREST, publicRPC string) {
	proxyCfg := proxy.Config{
		RESTPort:       a.ports.ProxyREST,
		RPCPort:        a.ports.ProxyRPC,
		LocalRESTAddr:  fmt.Sprintf("http://localhost:%d", a.ports.NodeREST),
		LocalRPCAddr:   fmt.Sprintf("http://localhost:%d", a.ports.NodeRPC),
		PublicRESTAddr: publicREST,
		PublicRPCAddr:  publicRPC,
		TimeoutMs:      a.settings.LocalNodeTimeoutMs,
		FailThreshold:  a.settings.CircuitBreakerThreshold,
		CooldownSec:    a.settings.CircuitBreakerCooldownSec,
	}

	restProxy, err := proxy.NewEndpointProxy("REST", proxyCfg.LocalRESTAddr, proxyCfg.PublicRESTAddr, a.appState, proxyCfg)
	if err != nil {
		logging.Error("app", "failed to create REST proxy: %v", err)
		return
	}
	a.restProxy = restProxy

	rpcProxy, err := proxy.NewEndpointProxy("RPC", proxyCfg.LocalRPCAddr, proxyCfg.PublicRPCAddr, a.appState, proxyCfg)
	if err != nil {
		logging.Error("app", "failed to create RPC proxy: %v", err)
		return
	}
	a.rpcProxy = rpcProxy

	// Start REST proxy in background
	a.routines.Go("rest-proxy", func(ctx context.Context) {
		if err := a.restProxy.Start(proxyCfg.RESTPort); err != nil {
			logging.Error("app", "REST proxy failed: %v", err)
		}
	})

	// Start RPC proxy in background
	a.routines.Go("rpc-proxy", func(ctx context.Context) {
		if err := a.rpcProxy.Start(proxyCfg.RPCPort); err != nil {
			logging.Error("app", "RPC proxy failed: %v", err)
		}
	})

	logging.Info("app", "proxies started (REST :%d, RPC :%d) → node (REST :%d, RPC :%d)",
		a.ports.ProxyREST, a.ports.ProxyRPC, a.ports.NodeREST, a.ports.NodeRPC)
}

// shutdown is called when the app is closing.
func (a *App) shutdown(ctx context.Context) {
	// Notify frontend to show shutdown screen
	wailsRuntime.EventsEmit(a.ctx, "app:shutting-down", nil)

	// Stop proxy servers
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if a.restProxy != nil {
		a.restProxy.Stop(shutdownCtx)
	}
	if a.rpcProxy != nil {
		a.rpcProxy.Stop(shutdownCtx)
	}

	// Stop node process if we own it
	if a.ownsNode {
		a.appState.SetNodeStatus(state.NodeStopped)
		if a.nodeProcess != nil && a.nodeProcess.IsRunning() {
			a.nodeProcess.Stop()
		} else {
			// Kill by PID file (covers adopted orphans)
			node.KillNodeByPIDFile()
		}
		node.RemoveInstance()
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

	logging.Info("app", "shutdown complete")
	logging.Close()
}

// --- Node setup (background) ---

// setupNode orchestrates the full node setup: instance detection, config fetch,
// binary download, port discovery, node init, and proxy startup.
func (a *App) setupNode(ctx context.Context) {
	logging.Info("app", "=== node setup starting ===")

	// 1. Check for existing instance
	a.appState.SetCurrentWork("Checking for running instances...")
	logging.Debug("app", "checking for existing instance...")
	existingInst, alive := node.CheckExistingInstance()
	if alive {
		logging.Info("app", "another instance (PID %d) is running — using its node and proxies", existingInst.PID)
		a.ports = existingInst.Ports
		a.ownsNode = false
		a.startProxiesUsingExisting()
		a.appState.SetCurrentWork("")
		return
	}

	// We're the primary instance
	a.ownsNode = true
	logging.Info("app", "we are the primary instance")

	// 2. Fetch remote config
	a.appState.SetCurrentWork("Downloading configuration...")
	logging.Debug("app", "fetching remote config from %s", remoteConfigURL)
	cfg, err := node.FetchRemoteConfig(remoteConfigURL)
	if err != nil {
		logging.Error("app", "remote config fetch failed: %v", err)
		a.appState.SetCurrentWork("Configuration failed")
		time.Sleep(3 * time.Second)
		a.appState.SetCurrentWork("")
		return
	}
	a.remoteConfig = cfg
	logging.Info("app", "remote config fetched (chain: %s, version: %s, rpc_servers: %v)",
		cfg.ChainID, cfg.Version, cfg.StateSyncRPCServers)

	// 3. Download binary if needed
	if !node.BinaryExists() {
		logging.Info("app", "node binary not found — downloading")
		if err := a.downloadBinary(cfg); err != nil {
			a.appState.SetCurrentWork("Node download failed")
			time.Sleep(3 * time.Second)
			a.appState.SetCurrentWork("")
			return
		}
	} else {
		logging.Debug("app", "node binary already exists at %s", node.BinaryPath())
	}

	// 4. Port discovery
	a.appState.SetCurrentWork("Discovering available ports...")
	defaults := node.DefaultPorts()
	if existingInst != nil {
		defaults = existingInst.Ports
		logging.Debug("app", "using ports from previous instance as defaults")
	}
	ports, err := node.DiscoverPorts(defaults)
	if err != nil {
		logging.Error("app", "port discovery failed: %v", err)
		a.appState.SetCurrentWork("Port discovery failed")
		time.Sleep(3 * time.Second)
		a.appState.SetCurrentWork("")
		return
	}
	a.ports = ports
	logging.Info("app", "ports discovered: node(P2P:%d RPC:%d REST:%d gRPC:%d) proxy(REST:%d RPC:%d)",
		ports.NodeP2P, ports.NodeRPC, ports.NodeREST, ports.NodeGRPC, ports.ProxyREST, ports.ProxyRPC)

	// 5. Initialize node if needed
	if !node.IsNodeInitialized() {
		logging.Info("app", "node not initialized — running full init")
		a.appState.SetCurrentWork("Initializing node...")
		if err := node.InitNode(cfg, ports); err != nil {
			logging.Error("app", "node init failed: %v", err)
			a.appState.SetCurrentWork("Node initialization failed")
			time.Sleep(3 * time.Second)
			a.appState.SetCurrentWork("")
			return
		}
		logging.Info("app", "node initialization complete")
	} else {
		logging.Debug("app", "node already initialized at %s", node.NodeHome())
	}

	// 6. Write instance.json
	inst := node.CreateInstance(ports)
	if err := node.SaveInstance(inst); err != nil {
		logging.Error("app", "failed to save instance.json: %v", err)
	} else {
		logging.Debug("app", "instance.json saved (PID %d)", inst.PID)
	}

	// 7. Sync settings with discovered ports
	a.settings.ProxyRESTPort = ports.ProxyREST
	a.settings.ProxyRPCPort = ports.ProxyRPC

	// 8. Start proxy servers
	publicREST := cfg.PublicREST
	publicRPC := cfg.PublicRPC
	if publicREST == "" {
		publicREST = "https://rest.getbze.com"
	}
	if publicRPC == "" {
		publicRPC = "https://rpc.getbze.com"
	}
	logging.Info("app", "starting proxy servers (public REST: %s, public RPC: %s)", publicREST, publicRPC)
	a.startProxies(publicREST, publicRPC)

	// 9. Check for orphan node from previous session
	orphanPID := node.CleanupOrphanNode()
	a.nodeProcess = node.NewNodeProcess(ports)

	if orphanPID > 0 {
		logging.Info("app", "adopting existing node process (PID %d)", orphanPID)
		a.appState.SetNodeStatus(state.NodeSyncing)
		a.appState.SetCurrentWork("Connecting to running node...")
	} else {
		// 10. Start a new node
		logging.Info("app", "starting new node process")
		a.appState.SetCurrentWork("Starting node...")
		a.appState.SetNodeStatus(state.NodeStarting)
		if err := a.nodeProcess.Start(); err != nil {
			logging.Error("app", "failed to start node: %v", err)
			a.appState.SetNodeStatus(state.NodeError)
			a.appState.SetCurrentWork("Node failed to start")
			time.Sleep(3 * time.Second)
			a.appState.SetCurrentWork("")
			return
		}
		logging.Info("app", "node process started")
	}

	// 10. Start health monitor
	healthCfg := node.HealthConfig{
		FastIntervalSec:      a.settings.FastLoopIntervalSec,
		SlowIntervalSec:      a.settings.SlowLoopIntervalSec,
		MaxBlockAgeSec:       a.settings.MaxBlockAgeSec,
		ResyncBlockThreshold: a.settings.ResyncBlockThreshold,
		CrossCheckDelta:      a.settings.CrossCheckBlockDelta,
	}
	a.healthMonitor = node.NewHealthMonitor(a.appState, a.nodeProcess, healthCfg, cfg, ports, func() {
		a.performResync()
	}, func() {
		logging.Info("app", "health watchdog: stuck on public for 10+ minutes — force re-init")
		a.ForceReInitNode()
	})
	a.routines.Go("health-fast", a.healthMonitor.FastLoop)
	a.routines.Go("health-slow", a.healthMonitor.SlowLoop)

	// 11. Start doctor (crash recovery)
	a.doctor = node.NewDoctor(a.appState, a.nodeProcess, a.settings.DoctorRetryDelaysSec)
	a.routines.Go("doctor", a.doctor.Watch)

	a.appState.SetCurrentWork("Node syncing...")
	logging.Info("app", "=== node setup complete — health monitoring active ===")
}

// performResync re-downloads configs, resets node data, and restarts.
func (a *App) performResync() {
	if a.remoteConfig == nil || a.nodeProcess == nil {
		return
	}

	logging.Info("app", "=== performing re-sync ===")
	a.appState.SetNodeStatus(state.NodeResyncing)
	a.appState.SetProxyTarget("public")
	a.appState.SetCurrentWork("Re-syncing node...")

	// Stop node
	logging.Info("app", "stopping node for re-sync")
	a.nodeProcess.Stop()

	// Re-fetch remote config (get latest configs)
	a.appState.SetCurrentWork("Downloading fresh configuration...")
	logging.Info("app", "re-fetching remote config")
	cfg, err := node.FetchRemoteConfig(remoteConfigURL)
	if err != nil {
		logging.Error("app", "re-fetch config failed, using cached: %v", err)
		cfg = a.remoteConfig
	} else {
		a.remoteConfig = cfg
		logging.Info("app", "fresh config fetched (chain: %s)", cfg.ChainID)
	}

	// Reset node data
	a.appState.SetCurrentWork("Resetting node data...")
	logging.Info("app", "running unsafe-reset-all")
	if err := node.UnsafeResetAll(); err != nil {
		logging.Error("app", "unsafe-reset-all failed: %v", err)
		a.appState.SetCurrentWork("Re-sync failed")
		time.Sleep(3 * time.Second)
		a.appState.SetCurrentWork("")
		return
	}

	// Re-download and re-process configs
	a.appState.SetCurrentWork("Reconfiguring node...")
	logging.Info("app", "re-downloading and re-processing configs")
	if err := node.ReInitConfigs(cfg, a.ports); err != nil {
		logging.Error("app", "re-init configs failed: %v", err)
		a.appState.SetCurrentWork("Re-sync config failed")
		time.Sleep(3 * time.Second)
		a.appState.SetCurrentWork("")
		return
	}

	// Restart node
	a.appState.SetCurrentWork("Restarting node...")
	logging.Info("app", "restarting node after re-sync")
	if err := a.nodeProcess.Start(); err != nil {
		logging.Error("app", "node restart after re-sync failed: %v", err)
		a.appState.SetNodeStatus(state.NodeError)
		a.appState.SetCurrentWork("Re-sync restart failed")
		time.Sleep(3 * time.Second)
		a.appState.SetCurrentWork("")
		return
	}

	a.appState.SetNodeStatus(state.NodeSyncing)
	a.appState.SetCurrentWork("Node re-syncing...")
	logging.Info("app", "=== re-sync complete — node restarting ===")
}

// downloadBinary resolves the URL and downloads the bzed binary.
func (a *App) downloadBinary(cfg *node.RemoteConfig) error {
	a.appState.SetCurrentWork("Resolving node binary...")
	downloadURL, checksum, err := node.ResolveBinaryURL(cfg)
	if err != nil {
		logging.Error("app", "failed to resolve binary URL: %v", err)
		return err
	}
	logging.Info("app", "binary URL resolved: %s", downloadURL)

	a.appState.SetCurrentWork("Downloading BZE node...")
	err = node.DownloadBinary(downloadURL, checksum, func(downloaded, total int64) {
		if total > 0 {
			pct := downloaded * 100 / total
			a.appState.SetCurrentWork(fmt.Sprintf("Downloading BZE node... %d%%", pct))
		} else if downloaded > 0 {
			mb := float64(downloaded) / 1024 / 1024
			a.appState.SetCurrentWork(fmt.Sprintf("Downloading BZE node... %.1f MB", mb))
		}
	})
	if err != nil {
		logging.Error("app", "binary download failed: %v", err)
		return err
	}

	logging.Info("app", "node binary downloaded successfully")
	return nil
}

// startProxiesUsingExisting configures proxies to use an existing instance's ports.
// This instance doesn't start its own proxy servers — it connects to the existing ones.
func (a *App) startProxiesUsingExisting() {
	logging.Info("app", "connecting to existing proxies (REST :%d, RPC :%d)",
		a.ports.ProxyREST, a.ports.ProxyRPC)
	// The frontend's balance/article fetches use GetBalance/GetArticles which call
	// through the proxy. We just need to tell them which port to use.
	// Update settings so the proxy port is known.
	a.settings.ProxyRESTPort = a.ports.ProxyREST
	a.settings.ProxyRPCPort = a.ports.ProxyRPC
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

// --- Keplr Bridge (called by frontend postMessage handler) ---

// KeplrEnable verifies the chain ID is supported.
func (a *App) KeplrEnable(chainId string) error {
	if a.remoteConfig != nil && chainId != a.remoteConfig.ChainID {
		return fmt.Errorf("unsupported chain: %s (expected %s)", chainId, a.remoteConfig.ChainID)
	}
	logging.Debug("bridge", "enable(%s) — ok", chainId)
	return nil
}

// KeplrGetKey returns the active account's key info for the Keplr bridge.
func (a *App) KeplrGetKey(chainId string) (map[string]interface{}, error) {
	active := a.store.ActiveAddress
	if active == "" {
		return nil, fmt.Errorf("no active account")
	}

	var acc *config.Account
	for i := range a.store.Accounts {
		if a.store.Accounts[i].Bech32Address == active {
			acc = &a.store.Accounts[i]
			break
		}
	}
	if acc == nil {
		return nil, fmt.Errorf("active account not found")
	}

	// Decode pubkey hex to bytes
	pubKeyBytes, err := hexDecodeString(acc.PubKeyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid pubkey: %w", err)
	}

	// Get raw address bytes from pubkey (20-byte hash)
	pubKey := &secp256k1Lib.PubKey{Key: pubKeyBytes}
	addrBytes := pubKey.Address().Bytes()

	logging.Debug("bridge", "getKey(%s) → %s (%s)", chainId, acc.Label, acc.Bech32Address)

	// Convert []byte to []int so Wails sends JS arrays (not base64 strings)
	// The hub-connector wraps these with new Uint8Array()
	pubKeyArr := make([]int, len(pubKeyBytes))
	for i, b := range pubKeyBytes {
		pubKeyArr[i] = int(b)
	}
	addrArr := make([]int, len(addrBytes))
	for i, b := range addrBytes {
		addrArr[i] = int(b)
	}

	return map[string]interface{}{
		"name":          acc.Label,
		"algo":          "secp256k1",
		"pubKey":        pubKeyArr,
		"address":       addrArr,
		"bech32Address": acc.Bech32Address,
		"isNanoLedger":  false,
		"isKeystone":    false,
	}, nil
}

// KeplrSignAmino signs an amino transaction. Returns the signed response.
func (a *App) KeplrSignAmino(chainId string, signer string, signDocJSON string) (map[string]interface{}, error) {
	logging.Info("bridge", "signAmino request from %s for signer %s", chainId, signer)

	password := a.password
	resp, err := a.wallet.SignAminoTx(signer, password, signDocJSON)
	if err != nil {
		logging.Error("bridge", "signAmino failed: %v", err)
		return nil, fmt.Errorf("signing failed: %w", err)
	}

	logging.Info("bridge", "signAmino success for %s", signer)

	respBytes, err := json.Marshal(resp)
	if err != nil {
		return nil, fmt.Errorf("marshal response: %w", err)
	}
	var result map[string]interface{}
	if err := json.Unmarshal(respBytes, &result); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}
	return result, nil
}

// KeplrSignDirect signs a direct (protobuf) transaction. Returns the signed response.
func (a *App) KeplrSignDirect(chainId string, signer string, signDocJSON string) (map[string]interface{}, error) {
	logging.Info("bridge", "signDirect request from %s for signer %s", chainId, signer)

	password := a.password
	resp, err := a.wallet.SignDirectTx(signer, password, []byte(signDocJSON))
	if err != nil {
		logging.Error("bridge", "signDirect failed: %v", err)
		return nil, fmt.Errorf("signing failed: %w", err)
	}

	logging.Info("bridge", "signDirect success for %s", signer)

	respBytes, _ := json.Marshal(resp)
	var result map[string]interface{}
	json.Unmarshal(respBytes, &result)
	return result, nil
}

// KeplrSuggestChain intercepts experimentalSuggestChain and overrides endpoints with proxy.
func (a *App) KeplrSuggestChain(chainInfoJSON string) error {
	logging.Debug("bridge", "suggestChain intercepted — endpoints forced to proxy")
	// We don't need to do anything — the connector already writes proxy endpoints to localStorage
	return nil
}

// KeplrSignArbitrary signs arbitrary data (ADR-036).
func (a *App) KeplrSignArbitrary(chainId string, signer string, data string) (map[string]interface{}, error) {
	logging.Info("bridge", "signArbitrary request for %s", signer)
	// TODO: implement ADR-036 signing
	return nil, fmt.Errorf("signArbitrary not yet implemented")
}

// GetHandshakeConfig returns the config sent to hub-connector during handshake.
func (a *App) GetHandshakeConfig() map[string]interface{} {
	chainId := "beezee-1"
	if a.remoteConfig != nil {
		chainId = a.remoteConfig.ChainID
	}

	return map[string]interface{}{
		"chainId":           chainId,
		"storageKeyVersion": "1",
		"proxyRest":         a.ports.ProxyREST,
		"proxyRpc":          a.ports.ProxyRPC,
		"activeAddress":     a.store.ActiveAddress,
		"activeLabel":       a.appState.GetActiveAddress(),
	}
}

// --- Helpers for Keplr bridge ---

func hexDecodeString(s string) ([]byte, error) {
	b := make([]byte, len(s)/2)
	for i := 0; i < len(s); i += 2 {
		var val byte
		for j := 0; j < 2; j++ {
			c := s[i+j]
			switch {
			case c >= '0' && c <= '9':
				val = val*16 + (c - '0')
			case c >= 'a' && c <= 'f':
				val = val*16 + (c - 'a' + 10)
			case c >= 'A' && c <= 'F':
				val = val*16 + (c - 'A' + 10)
			default:
				return nil, fmt.Errorf("invalid hex char: %c", c)
			}
		}
		b[i/2] = val
	}
	return b, nil
}

// --- Settings ---

// GetSettings returns current app settings.
func (a *App) GetSettings() map[string]interface{} {
	return map[string]interface{}{
		"trusted":                   a.settings.Trusted,
		"autoStartNode":             a.settings.AutoStartNode,
		"theme":                     a.settings.Theme,
		"logLevel":                  a.settings.LogLevel,
		"developerMode":             a.settings.DeveloperMode,
		"resyncBlockThreshold":      a.settings.ResyncBlockThreshold,
		"maxBlockAgeSec":            a.settings.MaxBlockAgeSec,
		"localNodeTimeoutMs":        a.settings.LocalNodeTimeoutMs,
		"circuitBreakerThreshold":   a.settings.CircuitBreakerThreshold,
		"circuitBreakerCooldownSec": a.settings.CircuitBreakerCooldownSec,
		"proxyRestPort":             a.settings.ProxyRESTPort,
		"proxyRpcPort":              a.settings.ProxyRPCPort,
		"fastLoopIntervalSec":       a.settings.FastLoopIntervalSec,
		"slowLoopIntervalSec":       a.settings.SlowLoopIntervalSec,
		"crossCheckBlockDelta":      a.settings.CrossCheckBlockDelta,
	}
}

// UpdateSetting updates a single setting and saves.
func (a *App) UpdateSetting(key string, value interface{}) error {
	switch key {
	case "logLevel":
		v := value.(string)
		a.settings.LogLevel = v
		logging.SetLevel(v)
		logging.Info("app", "log level changed to %s", v)
	case "developerMode":
		a.settings.DeveloperMode = value.(bool)
	case "trusted":
		a.settings.Trusted = value.(bool)
	case "autoStartNode":
		a.settings.AutoStartNode = value.(bool)
	case "theme":
		a.settings.Theme = value.(string)
	default:
		return fmt.Errorf("unknown setting: %s", key)
	}
	return config.SaveSettings(a.settings)
}

// GetVersion returns the application version.
func (a *App) GetVersion() string {
	return "0.1.0"
}

// GetLogPath returns the path to the log file.
func (a *App) GetLogPath() string {
	return filepath.Join(config.LogsDir(), "app.log")
}

// --- Node state (read-only for frontend) ---

// GetNodeSnapshot returns the current node state for the frontend.
// Also does a live status check to ensure state is fresh.
func (a *App) GetNodeSnapshot() map[string]interface{} {
	// Do a quick live check if we have ports configured
	if a.ports.NodeRPC > 0 {
		a.quickNodeCheck()
	}

	snap := a.appState.GetNodeSnapshot()
	return map[string]interface{}{
		"status":       snap.Status,
		"height":       snap.Height,
		"targetHeight": snap.TargetHeight,
		"proxyTarget":  snap.ProxyTarget,
		"currentWork":  snap.CurrentWork,
	}
}

// quickNodeCheck does an immediate status poll and updates AppState.
func (a *App) quickNodeCheck() {
	url := fmt.Sprintf("http://127.0.0.1:%d/status", a.ports.NodeRPC)
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	var result struct {
		Result struct {
			SyncInfo struct {
				CatchingUp        bool   `json:"catching_up"`
				LatestBlockHeight string `json:"latest_block_height"`
				LatestBlockTime   string `json:"latest_block_time"`
			} `json:"sync_info"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return
	}

	si := result.Result.SyncInfo
	var height int64
	fmt.Sscanf(si.LatestBlockHeight, "%d", &height)
	a.appState.SetNodeHeight(height)

	if si.CatchingUp {
		a.appState.SetNodeStatus(state.NodeSyncing)
		a.appState.SetProxyTarget("public")
	} else {
		blockTime, _ := time.Parse(time.RFC3339Nano, si.LatestBlockTime)
		maxAge := time.Duration(a.settings.MaxBlockAgeSec) * time.Second
		if maxAge <= 0 {
			maxAge = 18 * time.Second
		}
		if time.Since(blockTime) < maxAge {
			a.appState.SetNodeStatus(state.NodeSynced)
			a.appState.SetProxyTarget("local")
		}
	}
}

// ForceReInitNode stops the node, deletes node data and binary, and re-runs the full setup.
// Has a 1-minute cooldown between invocations.
func (a *App) ForceReInitNode() error {
	// Cooldown check — 1 minute between re-inits
	if time.Since(a.lastForceReInit) < time.Minute {
		remaining := time.Minute - time.Since(a.lastForceReInit)
		logging.Info("app", "force re-init on cooldown, %ds remaining", int(remaining.Seconds()))
		return fmt.Errorf("please wait %d seconds before trying again", int(remaining.Seconds()))
	}

	// Guard: don't re-init if already in progress — but check the AGE of the status.
	// If something has been "in progress" for too long, it's probably stuck.
	currentWork := a.appState.GetCurrentWork()
	workAge := a.appState.CurrentWorkAge()
	if currentWork != "" && workAge < 10*time.Minute {
		logging.Info("app", "force re-init ignored — setup in progress ('%s', age: %.0fs)", currentWork, workAge.Seconds())
		return fmt.Errorf("setup already in progress")
	}

	currentStatus := a.appState.GetNodeStatus()
	statusAge := a.appState.NodeStatusAge()
	if (currentStatus == state.NodeResyncing || currentStatus == state.NodeStarting) && statusAge < 10*time.Minute {
		logging.Info("app", "force re-init ignored — node is busy (%s, age: %.0fs)", currentStatus, statusAge.Seconds())
		return fmt.Errorf("node is busy")
	}

	a.lastForceReInit = time.Now()
	logging.Info("app", "force re-init requested — stopping node and clearing data")

	// Stop node if running
	if a.nodeProcess != nil && a.nodeProcess.IsRunning() {
		logging.Info("app", "stopping running node process")
		a.appState.SetNodeStatus(state.NodeStopped)
		a.nodeProcess.Stop()
	}

	// Delete node directory
	nodePath := node.NodeHome()
	logging.Info("app", "removing node directory: %s", nodePath)
	if err := os.RemoveAll(nodePath); err != nil {
		logging.Error("app", "failed to remove node dir: %v", err)
		return fmt.Errorf("failed to remove node dir: %w", err)
	}

	// Delete binary
	binaryPath := node.BinaryPath()
	logging.Info("app", "removing binary: %s", binaryPath)
	os.Remove(binaryPath)

	// Delete cached remote config
	logging.Info("app", "removing cached remote config")
	os.Remove(filepath.Join(config.ConfigDir(), "remote-config.json"))

	// Remove instance file
	node.RemoveInstance()

	logging.Info("app", "starting fresh node setup...")

	// Re-run setup in background
	a.routines.Go("node-reinit", func(ctx context.Context) {
		a.setupNode(ctx)
	})

	return nil
}

// ForceReInitCooldownRemaining returns seconds left on the re-init cooldown. 0 if ready.
func (a *App) ForceReInitCooldownRemaining() int {
	if a.lastForceReInit.IsZero() {
		return 0
	}
	remaining := time.Minute - time.Since(a.lastForceReInit)
	if remaining <= 0 {
		return 0
	}
	return int(remaining.Seconds())
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
