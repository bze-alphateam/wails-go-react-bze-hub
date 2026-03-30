# Epic 3a Complete: Shared State + Routine Manager + Proxy Servers

## What Was Done

Added core infrastructure for background work: thread-safe shared state, goroutine lifecycle manager, and two reverse proxy servers (REST + RPC) with circuit breaker. Proxies start in "public only" mode and route to BZE public endpoints.

## New Go Packages

### internal/state/state.go — AppState
- Thread-safe shared state with `sync.RWMutex`
- Fields: NodeStatus (enum), ProxyTarget, ActiveAddress/Label, CurrentWork, NodeHeight/TargetHeight
- Emits Wails events on changes: `state:node-changed`, `state:work-changed`, `state:account-changed`
- `NodeSnapshot` struct for serializing to frontend

### internal/routines/manager.go — RoutineManager
- `Go(name, fn)` registers a named goroutine tracked by WaitGroup
- `Shutdown(timeout)` cancels context + waits for all goroutines
- Each goroutine receives `ctx` and should exit on `ctx.Done()`
- Logs start/stop of each routine

### internal/proxy/proxy.go — EndpointProxy + Circuit Breaker
- Reverse proxy using `httputil.NewSingleHostReverseProxy`
- Routes to local node (when synced + circuit breaker safe) or public endpoints
- Circuit breaker: configurable timeout (1500ms), fail threshold (3), cooldown (120s)
- Unrecoverable errors (connection refused) trip the breaker immediately
- CORS headers on every response (`Access-Control-Allow-Origin: *`)
- Host header fix for Cloudflare-fronted public endpoints
- Graceful start/stop via `http.Server`

### internal/proxy/websocket.go — WebSocket Proxy
- Handles RPC `/websocket` path
- Determines target at connection time (local or public)
- Bidirectional pipe using gorilla/websocket
- On disconnect, client reconnects and gets fresh routing decision
- Falls back to public if local WebSocket connection fails

## Modified Files

### app.go
- Added `appState`, `routines`, `restProxy`, `rpcProxy` fields
- `startup()`: initializes state, routine manager, starts proxies in background goroutines
- `shutdown()`: stops proxies (5s timeout), then drains all routines (30s timeout), then zeros secrets
- `SwitchAccount()` now updates AppState for frontend sync
- New binding: `GetNodeSnapshot()` for frontend to read current state

### frontend/src/components/StatusBar.tsx
- Listens for `state:node-changed` Wails events
- Shows live: colored dot (green/amber/red/gray by status), node status text, block height, proxy target (Local/Public), network, version
- Shows `currentWork` text when background work is happening

## Verification Results

```
REST proxy: curl http://localhost:1418/cosmos/base/tendermint/v1beta1/node_info → ✅ BZE node info from public
RPC proxy:  curl http://localhost:26658/status → ✅ RPC status, block 22107544, beezee-1
Shutdown: proxies stop, routines drain cleanly, no leaks
```

## Design Decisions

1. **Host header fix**: `httputil.ReverseProxy` doesn't set the Host header to match the target by default, causing Cloudflare to return 403. Fixed by overriding `Director` to set `req.Host = target.Host`.

2. **Circuit breaker per-proxy**: Each proxy (REST, RPC) has its own circuit breaker. A REST timeout doesn't affect RPC routing and vice versa.

3. **Proxy always starts**: Even on first run (before wizard completes), proxies are running. They route to public endpoints since node status is `not_started`. This means the hub-connector can always point dApps at the proxy URLs.

4. **gorilla/websocket**: Used for WebSocket proxying since it's already an indirect dependency via Wails. No new deps added.

## What's Next (Epic 3b)

Node binary download + init:
- Download `bzed` from GitHub releases (platform/arch detection, SHA256 checksum)
- Init node home (fetch genesis, config.toml, app.toml from bze-configs)
- Configure state sync (trust height/hash calculation)
- UI: progress indicators during download and init
