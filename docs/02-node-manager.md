# Epic 02: Node Manager

Node lifecycle management, binary download from GitHub releases, initialization, aggressive pruning, periodic state sync, health monitoring, and endpoint routing.

## 1. Overview

The Node Manager is responsible for the full lifecycle of a local `bzed` node:

1. **Download** the correct `bzed` binary for the user's platform
2. **Initialize** a node home directory with correct genesis and configuration
3. **Configure** aggressive pruning and state sync
4. **Start/Stop** the node as a child process
5. **Monitor** health and sync status
6. **Route** dApp traffic to local or public endpoints based on node health
7. **Re-sync** via state sync every 48 hours to keep disk usage low

Design principle: the user should never see CLI output or manage config files. Everything happens behind progress indicators and status panels.

## 2. Binary Management

### GitHub Release Detection

```go
const (
    // TODO: Confirm the exact repository name (bze vs bze-v5)
    releaseAPI = "https://api.github.com/repos/bze-alphateam/bze/releases/latest"
)

type GitHubRelease struct {
    TagName string        `json:"tag_name"`  // e.g., "v8.1.0"
    Assets  []ReleaseAsset `json:"assets"`
}

type ReleaseAsset struct {
    Name               string `json:"name"`
    BrowserDownloadURL string `json:"browser_download_url"`
    Size               int64  `json:"size"`
}
```

Check on app startup and every 6 hours. Cache the response to respect GitHub API rate limits (60 req/hour unauthenticated).

### Asset Naming Convention

From the blockchain Makefile, release binaries follow this pattern:

| Platform | Asset Name | Archive |
|----------|-----------|---------|
| macOS AMD64 | `bzed-darwin-amd64` | `.tar.gz` |
| macOS ARM64 | `bzed-darwin-arm64` | `.tar.gz` |
| Linux AMD64 | `bzed-linux-amd64` | `.tar.gz` |
| Linux ARM64 | `bzed-linux-arm64` | `.tar.gz` |
| Windows AMD64 | `bzed.exe` | `.zip` |

### Download Flow

1. Determine platform: `runtime.GOOS` + `runtime.GOARCH`
2. Find matching asset in release
3. Download to temp file: `{appdata}/bin/bzed-{version}.tmp`
4. Verify checksum (SHA256) against release checksums file
5. Extract binary from archive
6. Set executable permission (`chmod +x` on Unix)
7. Move to `{appdata}/bin/bzed`
8. Store version in `{appdata}/config/node-version.json`

```go
type NodeVersion struct {
    Version     string    `json:"version"`      // "v8.1.0"
    DownloadedAt time.Time `json:"downloadedAt"`
    Checksum    string    `json:"checksum"`     // SHA256 hex
}
```

### Checksum Verification

```go
func verifyChecksum(filePath string, expectedSHA256 string) error {
    f, _ := os.Open(filePath)
    defer f.Close()
    h := sha256.New()
    io.Copy(h, f)
    actual := hex.EncodeToString(h.Sum(nil))
    if actual != expectedSHA256 {
        return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedSHA256, actual)
    }
    return nil
}
```

## 3. Node Initialization

### First-Run Detection

Check for `{appdata}/node/config/config.toml`. If absent, run initialization.

### Config Source URLs (Build-Time Env Vars)

The URLs to fetch genesis, `config.toml`, and `app.toml` are baked into the binary at build time via `-ldflags`. This allows different builds to point at different config sources without code changes.

```go
// Set at build time via -ldflags
var (
    genesisURL   = "https://raw.githubusercontent.com/bze-alphateam/bze-configs/main/genesis/genesis-mainnet.json"
    configURL    = "https://raw.githubusercontent.com/bze-alphateam/bze-configs/main/node/config.toml"
    appConfigURL = "https://raw.githubusercontent.com/bze-alphateam/bze-configs/main/node/app.toml"
)
```

These files in `bze-configs` are maintained by the BZE team and contain the correct seeds, pruning settings, and all other configuration for Hub nodes. The Hub does not generate or modify these files — it fetches and uses them as-is (except for state sync parameters which are calculated dynamically, see section 5).

### Initialization Steps

```go
func (m *Manager) InitNode() error {
    home := m.nodeHome() // {appdata}/node

    // 1. Run bzed init (creates directory structure, node_key.json, priv_validator_key.json)
    cmd := exec.Command(m.binaryPath(), "init", "bze-hub", "--chain-id", "beezee-1", "--home", home)
    if err := cmd.Run(); err != nil {
        return fmt.Errorf("bzed init failed: %w", err)
    }

    // 2. Download and replace genesis file from bze-configs
    if err := m.downloadFile(genesisURL, filepath.Join(home, "config", "genesis.json")); err != nil {
        return fmt.Errorf("failed to download genesis: %w", err)
    }

    // 3. Download and replace config.toml from bze-configs
    // This contains the correct seeds, P2P settings, and other CometBFT config.
    // Seeds are used for peer discovery (no persistent_peers needed).
    if err := m.downloadFile(configURL, filepath.Join(home, "config", "config.toml")); err != nil {
        return fmt.Errorf("failed to download config.toml: %w", err)
    }

    // 4. Download and replace app.toml from bze-configs
    // This contains pruning settings, API/gRPC config, gas prices, etc.
    if err := m.downloadFile(appConfigURL, filepath.Join(home, "config", "app.toml")); err != nil {
        return fmt.Errorf("failed to download app.toml: %w", err)
    }

    // 5. Configure state sync (dynamic — calculated from current chain height)
    if err := m.configureStateSync(home); err != nil {
        return fmt.Errorf("failed to configure state sync: %w", err)
    }

    return nil
}
```

### Why Fetch Instead of Generate

`bzed init` generates default config files, but they don't have the right seeds, pruning settings, or other Hub-specific tuning. Instead of patching individual fields after init, we:

1. Let `bzed init` create the directory structure and cryptographic keys (`node_key.json`, `priv_validator_key.json`)
2. Replace `genesis.json`, `config.toml`, and `app.toml` with pre-configured versions from `bze-configs`
3. Only modify the state sync section dynamically (trust height and hash change with every block)

This approach is simpler, less error-prone, and means the BZE team can update node configuration (add new seeds, tune parameters) by updating `bze-configs` — all new Hub installs pick up the changes automatically.

### Peer Configuration

The `config.toml` fetched from `bze-configs` contains whatever peer/seed configuration the BZE team maintains. The Hub does not care whether it uses seeds, persistent peers, or both — it uses the config as-is.

## 4. Pruning Configuration

Pruning settings are part of the `app.toml` fetched from `bze-configs` (see section 3). The Hub does not modify these — the BZE team maintains the correct pruning values in the config repo.

Expected settings in the Hub's `app.toml`:

```toml
pruning = "custom"
pruning-keep-recent = "100"
pruning-interval = "10"
```

### Disk Usage Estimates

| Pruning Strategy | Estimated Disk Usage |
|-----------------|---------------------|
| `nothing` (archive) | 50-100+ GB |
| `default` | 10-30 GB |
| `everything` | 1-3 GB |
| `custom` (keep 100) | ~2 GB |

With aggressive pruning and periodic state sync, disk usage should stay under 2-3 GB.

## 5. State Sync

### Purpose

State sync allows the node to catch up to the current chain height by downloading a recent state snapshot from peers, rather than replaying all blocks from genesis. This is critical for:
- Fast initial sync (minutes instead of hours/days)
- Periodic re-sync to keep disk usage low

### Initial State Sync (First Run)

On first initialization, calculate the trust height and hash, then write them to `config.toml`:

```go
func (m *Manager) ConfigureStateSync(home string) error {
    // 1. Query latest block height from public RPC
    latestHeight, err := m.getLatestBlockHeight("https://rpc.getbze.com")
    if err != nil {
        return err
    }

    // 2. Calculate trust height (latest - 3000 blocks, ~5 hours back)
    trustHeight := latestHeight - 3000

    // 3. Fetch trust hash at that height
    trustHash, err := m.getBlockHash("https://rpc.getbze.com", trustHeight)
    if err != nil {
        return err
    }

    // 4. Update config.toml [statesync] section
    configPath := filepath.Join(home, "config", "config.toml")
    return m.updateStateSyncConfig(configPath, StateSyncConfig{
        Enable:      true,
        RPCServers:  "https://rpc.getbze.com:443,https://rpc2.getbze.com:443",
        TrustHeight: trustHeight,
        TrustHash:   trustHash,
        TrustPeriod: "168h0m0s", // 7 days
    })
}
```

### RPC Queries

```go
func (m *Manager) getLatestBlockHeight(rpcURL string) (int64, error) {
    resp, err := http.Get(rpcURL + "/block")
    // Parse JSON: result.block.header.height
}

func (m *Manager) getBlockHash(rpcURL string, height int64) (string, error) {
    resp, err := http.Get(fmt.Sprintf("%s/block?height=%d", rpcURL, height))
    // Parse JSON: result.block_id.hash
}
```

### Periodic Re-Sync (Every ~48 Hours)

The re-sync is NOT a simple 48h timer. It's driven by the **node health monitor** (see section 7) which continuously evaluates the local node's state.

**How it decides to re-sync:**

The hourly health check goroutine queries the local node's `/status` endpoint and examines `earliest_block_height` and `latest_block_height`. The gap between these tells us how much block history the node is holding. When this gap represents more than ~48h of blocks (based on average block time), it's time to re-sync to reclaim disk space.

```go
const (
    avgBlockTimeSec  = 6     // BZE average block time
    resyncThreshold  = 48 * 3600 / avgBlockTimeSec // ~28,800 blocks ≈ 48h
)

func (m *Manager) needsResync(status *NodeStatus) bool {
    blockRange := status.LatestBlockHeight - status.EarliestBlockHeight
    return blockRange > resyncThreshold
}
```

**Re-sync procedure:**

1. Health monitor determines re-sync is needed
2. **Switch proxy to public endpoints first** (so dApps are not disrupted)
3. Stop the running node
4. Run `bzed tendermint unsafe-reset-all --home {appdata}/node --keep-addr-book`
5. Recalculate trust height and hash from current public RPC state
6. Update `config.toml` with new state sync parameters
7. Restart the node (it begins state syncing)
8. Health monitor detects node is syncing (`catching_up: true`)
9. Once node reports `catching_up: false` AND passes the cross-check (see section 7), **switch proxy back to local node**
10. Update `sync-state.json` with timestamp

```go
func (m *Manager) performResync() error {
    log.Info("[node] starting periodic re-sync — switching proxy to public endpoints")
    m.proxy.UsePublicEndpoints()

    log.Info("[node] stopping node for re-sync")
    if err := m.Stop(); err != nil {
        return fmt.Errorf("failed to stop node for resync: %w", err)
    }

    log.Info("[node] resetting node data (keeping address book)")
    cmd := exec.Command(m.binaryPath(), "tendermint", "unsafe-reset-all",
        "--home", m.nodeHome(), "--keep-addr-book")
    if err := cmd.Run(); err != nil {
        return fmt.Errorf("unsafe-reset-all failed: %w", err)
    }

    log.Info("[node] recalculating state sync parameters")
    if err := m.configureStateSync(m.nodeHome()); err != nil {
        return fmt.Errorf("state sync config failed: %w", err)
    }

    log.Info("[node] restarting node with fresh state sync")
    if err := m.Start(); err != nil {
        return fmt.Errorf("node restart failed: %w", err)
    }

    // The health monitor will detect when the node is caught up
    // and switch the proxy back to local automatically.
    m.saveSyncState(SyncState{
        LastResyncAt: time.Now(),
    })

    return nil
}
```

### What Happens on Startup

On app startup, before starting the node:

1. Check if the node data directory exists and has state
2. If yes: check `sync-state.json` for last re-sync time
3. If more than 48h have passed (or file doesn't exist): trigger a re-sync before starting
4. If less than 48h: start the node normally, let the hourly monitor handle it

```go
func (m *Manager) startupCheck() {
    syncState := m.loadSyncState()
    if syncState == nil || time.Since(syncState.LastResyncAt) > 48*time.Hour {
        log.Info("[node] stale data detected on startup — triggering re-sync")
        m.performResync()
    } else {
        m.Start()
    }
}
```

### Error Handling

`unsafe-reset-all` deletes all node data. If state sync then fails, the node has no local data. This is an accepted risk because:

- The proxy falls back to public endpoints, so **the user is never blocked**
- The node will retry state sync on next start (or next hourly check)
- State sync failures are typically transient (network issues, no snapshots available momentarily)

If state sync fails:
- Log the error: `[node] state sync failed: <reason>`
- Leave the node in `syncing` state (it will keep trying via CometBFT's internal retry)
- The proxy stays on public endpoints
- If the node process exits with an error: the health monitor detects it and sets state to `error`
- User sees "Node: Error" in the status bar
- Dashboard shows a "Retry" button
- On retry: repeat the re-sync procedure

If state sync fails with a different trust height offset, retry with alternatives:
```go
offsets := []int64{3000, 2000, 5000, 1000, 10000}
for _, offset := range offsets {
    trustHeight := latestHeight - offset
    // try state sync with this trust height...
}
```

### Sync State File

```go
// {appdata}/config/sync-state.json
type SyncState struct {
    LastResyncAt time.Time `json:"lastResyncAt"`
}
```

Minimal — just tracks when the last re-sync happened. The decision to re-sync is based on the node's actual block range, not a calculated `NextSyncAt`.

## 6. Node Lifecycle

### Starting the Node

```go
func (m *Manager) Start() error {
    if m.process != nil {
        return errors.New("node already running")
    }

    cmd := exec.Command(m.binaryPath(), "start", "--home", m.nodeHome())

    // Pipe stdout/stderr through the unified logger with [node] tag
    cmd.Stdout = m.logger.Writer("[node]")  // writes each line as a tagged log entry
    cmd.Stderr = m.logger.Writer("[node]")  // stderr also tagged [node], level ERROR

    if err := cmd.Start(); err != nil {
        return fmt.Errorf("failed to start node: %w", err)
    }

    m.process = cmd.Process
    m.setState(NodeStarting)

    // Start health monitoring goroutine
    go m.monitorHealth()

    return nil
}
```

### Stopping the Node

```go
func (m *Manager) Stop() error {
    if m.process == nil {
        return nil
    }

    // Graceful shutdown
    if runtime.GOOS == "windows" {
        m.process.Kill() // Windows doesn't support SIGTERM
    } else {
        m.process.Signal(syscall.SIGTERM)
    }

    // Wait with timeout
    done := make(chan error, 1)
    go func() { done <- m.cmd.Wait() }()

    select {
    case <-done:
        // Clean exit
    case <-time.After(30 * time.Second):
        m.process.Kill() // Force kill after timeout
    }

    m.process = nil
    m.setState(NodeStopped)
    return nil
}
```

### Crash Recovery ("Doctor" Routine)

If the node process exits unexpectedly (crash, OOM, panic), the Hub detects it and attempts recovery:

```go
func (m *Manager) watchProcess() {
    // This goroutine runs alongside the node process
    err := m.cmd.Wait() // Blocks until process exits

    if m.state == NodeStopped || m.state == NodeResyncing {
        return // Expected exit (we stopped it intentionally)
    }

    // Unexpected exit
    log.Error("[node] process exited unexpectedly: %v", err)
    m.process = nil
    m.setState(NodeError)

    // Launch doctor routine
    go m.doctor()
}

func (m *Manager) doctor() {
    log.Info("[node] doctor: starting recovery")

    // Proxy is already on public endpoints (state != synced)
    // Try to restart the node
    retryDelays := []time.Duration{5 * time.Second, 30 * time.Second, 2 * time.Minute, 5 * time.Minute}

    for attempt, delay := range retryDelays {
        log.Info("[node] doctor: attempt %d — waiting %s before restart", attempt+1, delay)
        time.Sleep(delay)

        if err := m.Start(); err != nil {
            log.Error("[node] doctor: restart attempt %d failed: %v", attempt+1, err)
            continue
        }

        // Wait a bit and check if node stays up
        time.Sleep(10 * time.Second)
        if m.state == NodeError || m.process == nil {
            log.Error("[node] doctor: node crashed again after restart")
            continue
        }

        log.Info("[node] doctor: node restarted successfully")
        return
    }

    // All retries exhausted
    log.Error("[node] doctor: all restart attempts failed — node remains stopped")
    m.setState(NodeError)
    // User sees "Node: Error" in status bar. Dashboard shows manual retry option.
}
```

The doctor uses exponential backoff (5s, 30s, 2min, 5min) to avoid rapid restart loops. During all of this, the proxy serves traffic from public endpoints — the user is never blocked.

### App Shutdown (Graceful Exit)

When the user quits BZE Hub, the app waits for all goroutines to finish cleanly:

```go
func (a *App) shutdown(ctx context.Context) {
    log.Info("[app] shutdown initiated")

    // 1. Stop the node process gracefully
    if a.nodeManager.State() != NodeStopped {
        log.Info("[app] stopping node...")
        if err := a.nodeManager.Stop(); err != nil {
            log.Error("[app] error stopping node: %v", err)
        }
        // Stop() sends SIGTERM and waits up to 30s for clean exit
    }

    // 2. Zero out wallet keys
    a.wallet.Lock()

    // 3. Stop proxy servers
    a.restProxy.Shutdown(ctx)
    a.rpcProxy.Shutdown(ctx)

    // 4. Stop health monitor goroutines
    a.nodeManager.StopMonitor()

    // 5. Flush and close log file
    a.logger.Close()

    log.Info("[app] shutdown complete")
}
```

The node's `Stop()` method sends `SIGTERM` (or `Kill` on Windows) and waits up to 30 seconds for the process to exit. CometBFT handles `SIGTERM` gracefully — it flushes state and closes the database. This may take a few seconds but is important for data integrity.

### Orphan Process Detection

On app startup, check if a `bzed` process from a previous session is still running (e.g., the app crashed but the node kept running):

```go
func (m *Manager) cleanupOrphans() {
    pidFile := filepath.Join(m.configDir(), "node.pid")
    data, err := os.ReadFile(pidFile)
    if err != nil {
        return // No PID file — no orphan
    }

    pid, _ := strconv.Atoi(strings.TrimSpace(string(data)))
    process, err := os.FindProcess(pid)
    if err != nil {
        os.Remove(pidFile)
        return
    }

    // Check if process is actually running (Unix: signal 0)
    if err := process.Signal(syscall.Signal(0)); err != nil {
        os.Remove(pidFile) // Process not running, stale PID file
        return
    }

    // Orphan found — kill it so we can start fresh
    log.Info("[node] found orphan bzed process (PID %d) — stopping it", pid)
    process.Signal(syscall.SIGTERM)
    time.Sleep(5 * time.Second)
    os.Remove(pidFile)
}
```

The PID file is written on node start and removed on clean stop.

### Machine Sleep / Hibernate

When the machine wakes from sleep, the node process is still alive but likely behind. The existing health monitoring handles this automatically:

1. Machine wakes → node is running but `latest_block_time` is stale
2. Fast loop (5s) detects block age > 18s threshold
3. Node state drops from `synced` to `syncing`
4. Proxy switches to public endpoints
5. Node catches up with its peers (CometBFT handles this via block sync)
6. Once `catching_up: false` and `latest_block_time` is fresh → state returns to `synced`
7. Proxy switches back to local

No special handling needed — the block freshness check covers this naturally.

## 7. Health Monitoring

The health monitor is a goroutine that runs two check loops at different frequencies:

1. **Fast loop (every 5 seconds)**: Polls the local node `/status` for UI updates (height, catching_up, peers)
2. **Slow loop (every hour)**: Cross-checks local node against public endpoints and decides if re-sync is needed

### Node Status Model

```go
type NodeStatus struct {
    State              NodeState `json:"state"`              // not_started, starting, syncing, synced, resyncing, error, stopped
    LatestBlockHeight  int64     `json:"latestBlockHeight"`
    EarliestBlockHeight int64    `json:"earliestBlockHeight"`
    TargetHeight       int64     `json:"targetHeight"`       // From public RPC
    CatchingUp         bool      `json:"catchingUp"`
    LatestBlockTime    string    `json:"latestBlockTime"`
    SyncPercent        float64   `json:"syncPercent"`
    PeerCount          int       `json:"peerCount"`
    Uptime             string    `json:"uptime"`
    ProxyTarget        string    `json:"proxyTarget"`        // "local" or "public"
}
```

### State Machine

```
                                      +-- resyncing --+
                                      |   (proxy on   |
                                      |   public)     |
                                      +-------+-------+
                                              |
                                              v
not_started --> starting --> syncing --> synced
                    |            |          |
                    v            v          v
                  error       error      error
                    |            |          |
                    v            v          v
                 stopped     stopped    stopped
```

The `resyncing` state is when the hourly check triggers a periodic re-sync (section 5). The proxy switches to public endpoints and the node resets + re-syncs.

### Fast Loop (5-Second Poll)

Polls the local node RPC `/status` and updates the UI:

```go
func (m *Manager) fastMonitorLoop() {
    ticker := time.NewTicker(5 * time.Second)
    for range ticker.C {
        status, err := m.pollLocalStatus()
        if err != nil {
            // Node not reachable — could be stopped, starting, or crashed
            if m.state != NodeStopped && m.state != NodeResyncing {
                m.setState(NodeError)
            }
            continue
        }

        if status.CatchingUp {
            m.setState(NodeSyncing)
        } else {
            m.setState(NodeSynced)
        }

        // Calculate sync progress using target height from public RPC
        if m.targetHeight > 0 && status.LatestBlockHeight > 0 {
            status.SyncPercent = float64(status.LatestBlockHeight) / float64(m.targetHeight) * 100
        }

        // Push to frontend
        runtime.EventsEmit(m.ctx, "node:status-changed", status)
    }
}

func (m *Manager) pollLocalStatus() (*LocalStatus, error) {
    resp, err := http.Get("http://localhost:26657/status")
    if err != nil {
        return nil, err
    }
    // Parse:
    //   result.sync_info.catching_up
    //   result.sync_info.latest_block_height
    //   result.sync_info.earliest_block_height
    //   result.sync_info.latest_block_time
    //   result.node_info.network (chain ID)
}
```

### Slow Loop (Hourly Cross-Check)

Runs every hour. Performs two tasks:

**1. Cross-check local node against public endpoints (secondary validation):**

Since the fast loop already uses `latest_block_time` for real-time health, this hourly cross-check is a secondary validation. It compares block heights to catch edge cases where block timestamps might be unreliable.

```go
const maxAllowedBlockDelta = 2

func (m *Manager) crossCheckHealth() (bool, error) {
    localStatus, err := m.pollLocalStatus()
    if err != nil {
        return false, err
    }

    // Query at least 2 public endpoints
    publicEndpoints := []string{"https://rpc.getbze.com", "https://rpc2.getbze.com"}
    for _, ep := range publicEndpoints {
        publicHeight, err := m.getLatestBlockHeight(ep)
        if err != nil {
            log.Debug("[node] public endpoint %s unreachable: %v", ep, err)
            continue
        }

        delta := publicHeight - localStatus.LatestBlockHeight
        if delta > maxAllowedBlockDelta {
            log.Info("[node] local node is %d blocks behind %s (local: %d, public: %d)",
                delta, ep, localStatus.LatestBlockHeight, publicHeight)
            return false, nil // Node is behind
        }
    }

    return true, nil // Node is healthy
}
```

If the cross-check fails, log a warning. The fast loop's `latest_block_time` check will likely have already caught this and switched the proxy to public. This is just a safety net.

**2. Check if re-sync is needed (48h block range):**

```go
func (m *Manager) hourlyCheck() {
    // Skip if node is not running or already resyncing
    if m.state == NodeStopped || m.state == NodeResyncing || m.state == NodeStarting {
        return
    }

    localStatus, err := m.pollLocalStatus()
    if err != nil {
        return
    }

    // Check if re-sync is needed based on block range
    if m.needsResync(localStatus) {
        log.Info("[node] block range exceeds 48h threshold — triggering re-sync")
        m.setState(NodeResyncing)
        go m.performResync()
        return
    }

    // Cross-check against public endpoints
    healthy, err := m.crossCheckHealth()
    if err == nil && !healthy {
        log.Info("[node] local node falling behind public endpoints")
        // For now: just log. Future: could trigger action.
    }

    // Update target height for sync progress calculation
    publicHeight, err := m.getLatestBlockHeight("https://rpc.getbze.com")
    if err == nil {
        m.targetHeight = publicHeight
    }
}
```

### What Drives the Proxy

The proxy's routing decision is simple: **only route to local when the node is `synced`**. Everything else goes to public.

| Node State | Proxy Routes To | Why |
|-----------|-----------------|-----|
| `synced` | Local node | `catching_up: false` AND `latest_block_time` is fresh |
| `syncing` | Public endpoints | Still catching up |
| `starting` | Public endpoints | Not ready yet |
| `resyncing` | Public endpoints | Data reset, re-syncing |
| `error` | Public endpoints | Node unhealthy |
| `stopped` | Public endpoints | Node not running |
| `not_started` | Public endpoints | Node not running |

The fast loop (5s) evaluates `isNodeSynced()` which checks both `catching_up` and block freshness (`latest_block_time`). If the block is older than the threshold (default 18s), the node drops out of `synced` and the proxy falls back to public — **without needing to call any public RPC endpoint**. This keeps the health check local-only and avoids unnecessary external traffic.

### "Synced" Definition

The node is considered `synced` when ALL of these are true:
1. Local node `/status` returns `catching_up: false`
2. `latest_block_time` is within `maxBlockAge` of current time (default: 18 seconds, configurable)
3. Node process is running and responsive

```go
const defaultMaxBlockAgeSec = 18 // configurable in settings

func (m *Manager) isNodeSynced(status *LocalStatus) bool {
    if status.CatchingUp {
        return false
    }

    blockAge := time.Since(status.LatestBlockTime)
    if blockAge > time.Duration(m.settings.MaxBlockAgeSec) * time.Second {
        // catching_up is false but the latest block is stale
        // Node may have lost peers or stalled
        log.Info("[node] block age %s exceeds threshold %ds — node considered out of sync",
            blockAge, m.settings.MaxBlockAgeSec)
        return false
    }

    return true
}
```

**Why `latest_block_time` matters**: A node can report `catching_up: false` while being stalled — it thinks it's caught up but hasn't received new blocks (lost peers, network issues). Checking block freshness catches this. With BZE's ~6s block time, a threshold of 18 seconds (3 missed blocks) is a reasonable default.

**This replaces the need for frequent public RPC cross-checks.** The fast loop (5s) checks block freshness locally — no external calls needed. Only the slow loop (hourly) cross-checks against public endpoints for the re-sync decision. This avoids unnecessary load on public RPCs.

If any condition fails, the state drops to `syncing` or `error`, and the proxy falls back to public endpoints.

## 8. Endpoint Routing via Proxy Servers

The Hub runs two local proxy servers that transparently route traffic to either the local node or public endpoints based on node health. See 04-ui-shell.md section 7 for full details.

### How It Works

| Proxy | Listen | Local Target | Public Fallback |
|-------|--------|-------------|-----------------|
| REST | `localhost:1418` | `localhost:1317` | `https://rest.getbze.com` |
| RPC | `localhost:26658` | `localhost:26657` | `https://rpc.getbze.com` |

The dApps always connect to the proxy ports. The proxy checks `nodeManager.State()` on each request and routes accordingly. No endpoint switching visible to the dApps.

### Transition Handling

- **syncing -> synced**: Proxy starts routing to local node. User sees "Local node ready" indicator in the Hub status bar.
- **synced -> syncing/error**: Proxy falls back to public endpoints. User sees "Using public RPC" indicator.
- Transitions are **per-request** and completely transparent to dApps. No reconnection needed.

## 9. Port Configuration

### Default Ports

| Service | Port | Config Key |
|---------|------|-----------|
| RPC | 26657 | `[rpc] laddr` in config.toml |
| REST API | 1317 | `[api] address` in app.toml |
| gRPC | 9090 | `[grpc] address` in app.toml |
| P2P | 26656 | `[p2p] laddr` in config.toml |
| pprof | 6060 | `[rpc] pprof_laddr` in config.toml |

### Port Conflict Detection

Before starting the node, check if ports are available:

```go
func isPortAvailable(port int) bool {
    ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
    if err != nil {
        return false
    }
    ln.Close()
    return true
}
```

If a port is in use, either:
- Inform the user and suggest stopping the conflicting process
- Use alternative ports (configurable in settings)

## 10. Testnet Support (Post-MVP)

Testnet is **not supported in the MVP**. The Hub targets mainnet (`beezee-1`) only.

When testnet support is added later, it would need: separate node home directory (`node-testnet/`), separate genesis/peers/state sync config, network switching UI, and iframe reloading. See 07-configuration.md section 5 for notes.

## 11. Node Configuration

Both `config.toml` and `app.toml` are fetched from `bze-configs` at init time (see section 3). The Hub does not maintain its own templates — the BZE team keeps the canonical configs in the `bze-configs` repo.

The only field the Hub writes dynamically is the `[statesync]` section in `config.toml` (trust height and hash, calculated from the current chain state — see section 5).

Key settings that the `bze-configs` app.toml must include for the Hub to work:

```toml
[api]
enable = true
address = "tcp://127.0.0.1:1317"
enabled-unsafe-cors = true    # Needed for proxy to reach local REST

[grpc]
enable = true
address = "127.0.0.1:9090"
```

Note: `enabled-unsafe-cors = true` is needed for the Hub's reverse proxy to reach the local REST API. Since the REST API binds to `127.0.0.1` only, the CORS risk is minimal — it's not exposed to the network.

## 12. Log Management

All logs — including node process stdout/stderr — go to a single unified `{appdata}/logs/app.log` with the `[node]` tag. See 07-configuration.md for the full logging architecture (levels, rotation, tags) and 06-security.md for logging security rules.

### Log Access

Expose recent log lines to the frontend dashboard:

```go
func (m *Manager) GetRecentLogs(lines int) ([]string, error) {
    // Read last N lines from app.log filtered by [node] tag
    // Return as string slice for display in dashboard
}
```
