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

## Epic 3a: Shared State + Routine Manager + Proxy Servers

**Goal**: Core infrastructure for background work. Proxy servers running in "public only" mode (no node yet). Graceful shutdown framework.

**Deliverables**:
- Go `internal/state/` package:
  - Central `AppState` struct with `sync.RWMutex`
  - Holds: node status, proxy target (local/public), active account, current work description
  - Thread-safe getters/setters
  - State changes emit Wails events to frontend
- Go `internal/routines/` package:
  - `RoutineManager` with `sync.WaitGroup` + `context.Context` cancellation
  - `Go(name, fn)` to register goroutines, `Shutdown(timeout)` to stop all
- Go `internal/proxy/` package:
  - REST proxy (`:1418`) and RPC proxy (`:26658`)
  - Circuit breaker (1500ms timeout, 3-strike, 2-min cooldown)
  - Error classification (recoverable vs unrecoverable)
  - WebSocket proxying for RPC `/websocket`
  - CORS headers (`Access-Control-Allow-Origin: *`)
  - Routing based on `AppState.NodeStatus` (initially always "public")
- `app.go` updated: integrates state, routine manager, proxy startup, graceful shutdown
- React UI: status bar shows live proxy target (public), node status dot updates from Go events

**Does NOT include**: node binary download, node process management, health monitoring.

---

## Epic 3b: Node Binary Download + Init

**Goal**: Download the correct `bzed` binary and initialize the node home directory. Node is configured but not started.

**Deliverables**:
- Go `internal/node/binary.go`:
  - Query GitHub releases API for latest `bzed` version
  - Platform/architecture detection (`runtime.GOOS` + `runtime.GOARCH`)
  - Download correct asset (tar.gz or zip)
  - SHA256 checksum verification
  - Extract binary, set executable permissions
  - Store version in `node-version.json`
- Go `internal/node/init.go`:
  - Run `bzed init` to create directory structure + crypto keys
  - Download genesis, config.toml, app.toml from bze-configs (build-time URLs via `-ldflags`)
  - Replace generated configs with fetched ones
  - Calculate state sync trust height/hash from public RPC
  - Write state sync params to config.toml
- React UI:
  - Progress indicator during download ("Downloading BZE node... 45%")
  - Status text during init ("Creating node configuration...")
  - `AppState.CurrentWork` drives the display
- On completion: binary at `{appdata}/bin/bzed`, node home at `{appdata}/node/` fully configured

**Does NOT include**: starting the node, health monitoring, proxy switching to local.

---

## Epic 3c: Node Lifecycle + Health Monitor

**Goal**: Start/stop the node as a child process. Health monitoring drives proxy routing. Crash recovery.

**Deliverables**:
- Go `internal/node/lifecycle.go`:
  - Start node as child process (`bzed start --home ...`)
  - Stdout/stderr piped to unified logger with `[node]` tag
  - Stop with SIGTERM (Unix) / Kill (Windows) + 30s timeout
  - PID file write/read for orphan detection on startup
- Go `internal/node/health.go`:
  - Fast loop (every 5s): poll local `/status`, check `catching_up` + `latest_block_time` freshness (18s threshold)
  - Slow loop (every hour): cross-check against public RPCs, check block range for re-sync trigger (28800 blocks)
  - Periodic re-sync: stop node → `unsafe-reset-all` → recalculate state sync → restart
  - Node state machine: `not_started → starting → syncing → synced → resyncing → error → stopped`
- Go `internal/node/doctor.go`:
  - Crash detection via `cmd.Wait()`
  - Exponential backoff retry (5s, 30s, 2min, 5min)
  - After all retries fail: set state to `error`, user sees manual retry in dashboard
- Proxy integration: routes to local node when state is `synced`, public otherwise
- Machine sleep/wake: block freshness check catches stale node automatically
- React UI:
  - Status bar: colored dot (green/amber/red/gray), block height, sync progress percentage
  - Top bar: node indicator text (e.g., "Local" or "Public")
  - Dashboard: node status panel with Start/Stop/Restart buttons, log viewer

**Does NOT include**: iframes, hub-connector, Keplr bridge, dApp loading.

---

## Future Epics (to be defined)

- **Epic 4**: UI Shell — iframes, hub-connector, Keplr bridge, dApp tabs, approval dialog
- **Epic 5**: Auto-updater — binary version checking, download, chain upgrade detection
- **Epic 6**: Settings polish — developer mode UI, logging viewer, export/import app data
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
