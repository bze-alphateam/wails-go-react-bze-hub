# BZE Hub — Epic Implementation Plan

Each epic produces a working, testable increment. At the end of each epic, a completion doc (`epic-01-done.md`, `epic-02-done.md`, etc.) is written in this folder describing what was built, design decisions made, and where the next epic picks up.

## Epic 1: Wails Project Setup + React Shell Layout

**Goal**: A running Wails dev app with the shell layout structure and Chakra UI v3.

**Deliverables**:
- Wails v2 project initialized (`wails init` + customizations)
- Go backend: `main.go`, `app.go` with `startup()` / `shutdown()` stubs
- React frontend with Chakra UI v3:
  - Shell layout: tab bar (top), content area (center), status bar (bottom)
  - Tab bar: placeholder buttons (Dashboard, DEX, Burner, Staking) — non-functional, just visual
  - Content area: "Welcome to BZE Hub, let's get you started" centered text
  - Status bar: static text placeholder ("Node: not started | Network: Mainnet")
- `wails dev` starts the app successfully
- `wails build` produces a binary

**Does NOT include**: keyring, wallet, node management, iframes, proxy, hub-connector.

---

## Epic 2: Keyring + Wallet

**Goal**: Full wallet functionality — create/import mnemonic, import PK, derive addresses, export, signing. Platform-adaptive auth (macOS Keychain vs password on Windows/Linux).

**Deliverables**:
- Go `internal/wallet/` package:
  - Keyring integration with platform-adaptive encryption (see 03-wallet.md)
  - `bze-hub:mnemonic:{label}` and `bze-hub:pk:{address}` storage
  - BIP44 derivation (`m/44'/118'/0'/0/{index}`, bze prefix)
  - SignAmino and SignDirect implementations
  - Minimal keyring access pattern (PK for signing, mnemonic only for derive/export)
- Go `internal/config/` package:
  - `accounts.json` management (AccountStore with Mnemonics + Accounts)
  - `settings.json` management (AppSettings struct with defaults)
- React wallet panel in the Dashboard:
  - First-run wizard: generate mnemonic (label, show phrase, confirm 4 words, trust device)
  - Import mnemonic flow
  - Import private key flow
  - Export mnemonic flow
  - New address (pick mnemonic if multiple)
  - Account list grouped by mnemonic source
  - Account switching
- Password prompt on startup for Windows/Linux (if untrusted device)
- Touch ID / Keychain auth on macOS

**Does NOT include**: node management, iframes, proxy, hub-connector, Keplr bridge.

---

## Epic 3: Node Manager + Proxy + Background State

**Goal**: Local node lifecycle running in background, reverse proxy servers, shared app state with thread-safe access, UI showing real-time node status.

**Deliverables**:
- Go `internal/state/` package:
  - Central `AppState` struct with `sync.RWMutex`
  - Holds: node status, proxy mode (local/public), active account, current work description
  - Thread-safe getters/setters
  - Observable via Wails events (state changes push to frontend)
- Go `internal/node/` package:
  - Binary download from GitHub releases (platform detection, checksum verification)
  - Node init (fetch config.toml, app.toml, genesis.json from bze-configs via build-time URLs)
  - State sync configuration (dynamic trust height/hash calculation)
  - Node start/stop/restart as child process
  - Health monitor: fast loop (5s, block freshness) + slow loop (hourly, cross-check + re-sync decision)
  - Crash recovery doctor routine with exponential backoff
  - PID file for orphan detection
- Go `internal/proxy/` package:
  - REST proxy (`:1418`) and RPC proxy (`:26658`)
  - Circuit breaker (1500ms timeout, 3-strike, 2-min cooldown)
  - WebSocket proxying for RPC `/websocket`
  - CORS headers for iframe access
  - Routing based on `AppState.NodeStatus`
- Routine tracking for graceful shutdown (all goroutines registered, `sync.WaitGroup` or similar)
- Context passing: `context.Context` carrying references to storage, shared state, logger
- React UI updates:
  - Top bar: active wallet address + node indicator (local/public) + current background activity text
  - Status bar: node state with colored dot, block height, version
  - Node progress during first-run download/sync

**Does NOT include**: iframes, hub-connector, Keplr bridge, dApp loading. The app shows the dashboard with wallet panel and node status, but no dApp tabs yet.

---

## Future Epics (to be defined)

- **Epic 4**: UI Shell — iframes, hub-connector, Keplr bridge, dApp tabs, approval dialog
- **Epic 5**: Auto-updater — binary version checking, download, chain upgrade detection
- **Epic 6**: Settings polish — developer mode, logging UI, export/import app data
- **Epic 7**: Build & distribution — CI/CD pipeline, cross-platform packaging, signing
- **Epic 8**: Third-party dApp support — permission model, custom tabs

---

## Architecture Principles (All Epics)

### UI is a Thin Presentation Layer

**All business logic lives in Go.** The React frontend is only responsible for:
- Rendering UI based on state received from Go (via Wails events and bindings)
- Capturing user input and forwarding it to Go (via Wails bindings)
- UI-only logic: animations, tab switching, form validation feedback, dialog show/hide

The React frontend does **NOT**:
- Make HTTP requests (the Go proxy handles all chain communication)
- Manage wallet state (Go manages keyring, accounts, signing)
- Decide routing logic (Go's AppState drives everything)
- Hold any secrets or business state

**Pattern**: Go pushes state via `runtime.EventsEmit()` → React listens and re-renders. React calls Go via Wails bindings → Go processes and emits result events. The frontend is reactive — it never drives business logic.

### Context Passing

A `context.Context` is passed throughout the app carrying everything components need:

```go
// The app context carries references to shared resources
type AppContext struct {
    ctx      context.Context
    cancel   context.CancelFunc
    state    *state.AppState     // Thread-safe shared state
    storage  *config.Storage     // File-based storage (settings.json, accounts.json)
    wallet   *wallet.Wallet      // Keyring operations
    logger   *logging.Logger     // Unified logger
}
```

Components receive this context and use it to access shared resources without global state.

### Shared State (AppState)

Single struct with `sync.RWMutex` for thread-safe concurrent access:

```go
type AppState struct {
    mu sync.RWMutex

    // Node
    NodeStatus      NodeStatus  // synced, syncing, error, stopped, etc.
    NodeHeight      int64
    NodeTargetHeight int64
    ProxyTarget     string      // "local" or "public"

    // Wallet
    ActiveAddress   string
    ActiveLabel     string

    // Background work
    CurrentWork     string      // Human-readable: "Downloading node...", "State syncing...", ""

    // Circuit breaker
    LocalNodeSafe   bool
    UnsafeUntil     time.Time
}

func (s *AppState) GetNodeStatus() NodeStatus {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.NodeStatus
}

func (s *AppState) SetNodeStatus(status NodeStatus) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.NodeStatus = status
}
```

State changes emit Wails events so the React frontend stays in sync without polling.

### Routine Tracking + Graceful Shutdown

All background goroutines are tracked so the app can shut down cleanly:

```go
type RoutineManager struct {
    wg     sync.WaitGroup
    ctx    context.Context
    cancel context.CancelFunc
}

func (rm *RoutineManager) Go(name string, fn func(ctx context.Context)) {
    rm.wg.Add(1)
    go func() {
        defer rm.wg.Done()
        log.Debug("[app] routine started: %s", name)
        fn(rm.ctx)
        log.Debug("[app] routine stopped: %s", name)
    }()
}

func (rm *RoutineManager) Shutdown(timeout time.Duration) {
    rm.cancel() // Signal all routines to stop

    done := make(chan struct{})
    go func() { rm.wg.Wait(); close(done) }()

    select {
    case <-done:
        log.Info("[app] all routines stopped cleanly")
    case <-time.After(timeout):
        log.Error("[app] shutdown timed out — some routines may still be running")
    }
}
```

Usage:
```go
func (a *App) startup(ctx context.Context) {
    a.routines = NewRoutineManager(ctx)

    a.routines.Go("health-monitor-fast", a.nodeManager.FastMonitorLoop)
    a.routines.Go("health-monitor-slow", a.nodeManager.SlowMonitorLoop)
    a.routines.Go("process-watcher", a.nodeManager.WatchProcess)
    // ... etc
}

func (a *App) shutdown(ctx context.Context) {
    a.routines.Shutdown(30 * time.Second)
    a.wallet.Lock()
    a.logger.Close()
}
```

Each goroutine receives `ctx` and checks `ctx.Done()` in its loop to know when to exit.

### Logging

All components use the unified logger with tags (see 07-configuration.md). Default level: `error`. Every component prefixes its logs: `[node]`, `[proxy]`, `[wallet]`, `[bridge]`, etc.
