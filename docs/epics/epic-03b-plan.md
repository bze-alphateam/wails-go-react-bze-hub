# Epic 3b Plan: Node Binary Download + Init

## Goal

Download the correct `bzed` binary, initialize node home directory, and configure for state sync. Node is fully configured but NOT started yet. Also: port discovery, instance management, and remote config fetching.

## Key Design: Remote Config

A single URL is baked into the Hub binary at build time via `-ldflags`:

```go
var remoteConfigURL = "https://raw.githubusercontent.com/bze-alphateam/bze-configs/refs/heads/main/hub/config.json"
```

The config.json structure:

```json
{
  "version": "1",
  "genesis_url": "https://raw.githubusercontent.com/bze-alphateam/bze-configs/refs/heads/main/genesis/genesis-mainnet.json",
  "config_toml_url": "https://raw.githubusercontent.com/.../config.toml",
  "app_toml_url": "https://raw.githubusercontent.com/.../app.toml",
  "chain_id": "beezee-1",
  "state_sync_rpc_servers": ["https://rpc.getbze.com:443", "https://rpc2.getbze.com:443"],
  "public_rest": "https://rest.getbze.com",
  "public_rpc": "https://rpc.getbze.com",
  "binary_repo": "bze-alphateam/bze",
  "trust_height_offset": 3000,
  "binaries": {
    "darwin/amd64": "https://...bzed-darwin-amd64?checksum=sha256:...",
    "darwin/arm64": "https://...bzed-darwin-arm64?checksum=sha256:...",
    "linux/amd64": "https://...bzed-linux-amd64?checksum=sha256:...",
    "linux/arm64": "https://...bzed-linux-arm64?checksum=sha256:..."
  }
}
```

**Fetch behavior:**
- Fetched fresh on every init and re-sync
- Cached locally at `{appdata}/config/remote-config.json` for offline fallback
- If GitHub unreachable, use cached version

**Binary resolution:**
1. Check `binaries[runtime.GOOS/runtime.GOARCH]` in config
2. If present: download from URL, verify checksum (parsed from `?checksum=sha256:...`)
3. If absent: fallback to GitHub releases API on `binary_repo`, find latest release, match binary by naming convention (`bzed-{os}-{arch}`)

## Port Discovery

**Default port ranges:**
- Node: P2P 26656, RPC 26657, REST 1317, gRPC 9090
- Proxy: REST 2317, RPC 36657

**Discovery:** For each port, check if available. If not, increment by 1 (max 100 increments). Save discovered ports.

**Both node and proxy ports go through discovery.** After discovery, node's config.toml and app.toml are updated with the found ports. Proxy uses its discovered ports.

## Instance Management (instance.json)

Single file at `{appdata}/config/instance.json`:

```json
{
  "pid": 12345,
  "startedAt": "2026-03-30T...",
  "nodeRPC": 26657,
  "nodeREST": 1317,
  "nodeP2P": 26656,
  "nodeGRPC": 9090,
  "proxyREST": 2317,
  "proxyRPC": 36657
}
```

**Startup logic:**
1. Read `instance.json`
2. If exists: check if PID is alive (`os.FindProcess` + signal 0 on Unix)
3. If PID alive: health check the ports (try connecting)
   - If healthy: another instance running → use its ports, skip node/proxy startup
   - If unhealthy: stale PID → take over, start fresh
4. If PID dead or no file: fresh setup → port discovery → write instance.json → init node

**Second instance behavior:** Runs its own UI + wallet. Uses shared node + proxies from first instance. If first instance dies, the health check loop detects it and the surviving instance takes over (starts its own node/proxies).

## Node Init Steps

1. Fetch remote config.json (cache locally)
2. Resolve binary URL (from config or GitHub releases fallback)
3. Download binary, verify SHA256 checksum
4. Run `bzed init bze-hub --chain-id {chain_id} --home {appdata}/node`
5. Download genesis from `genesis_url`, place in config/
6. Download config.toml from `config_toml_url`
7. Download app.toml from `app_toml_url`
8. Port discovery for node ports → update config.toml and app.toml with found ports
9. Set moniker in config.toml: "BZE Hub - {funny_name} - {timestamp}"
10. Configure state sync in config.toml: enable, set rpc_servers, trust_height, trust_hash
11. Enable REST and RPC in config (should already be enabled in fetched configs, but verify)
12. Port discovery for proxy ports
13. Write instance.json with all ports + PID
14. Save ports in settings.json for persistence

## Moniker

Format: `"BZE Hub - {funny_name} - {timestamp}"`

100 hardcoded funny names. Random pick on every init/re-sync. New name each time.

## Config Post-Processing

After downloading config.toml and app.toml from remote:
- **config.toml**: set moniker, update state sync section (enable, rpc_servers, trust_height, trust_hash), update port bindings (RPC, P2P)
- **app.toml**: update port bindings (REST, gRPC), ensure REST enabled, ensure gRPC enabled
- **Pruning section**: NOT touched (comes from remote config as-is)

## New Go Packages

### internal/node/remoteconfig.go
- `RemoteConfig` struct matching the JSON
- `FetchRemoteConfig(url)` — download + cache
- `LoadCachedConfig()` — read from local cache
- Parse binary URL + checksum

### internal/node/binary.go
- `ResolveBinaryURL(config, os, arch)` — from config or GitHub fallback
- `DownloadBinary(url, checksum, destPath)` — download + verify + chmod
- `ParseChecksum(url)` — extract `?checksum=sha256:...`

### internal/node/init.go
- `InitNode(config, appDataDir)` — full init sequence
- `PostProcessConfig(configTomlPath, ports, moniker, stateSync)`
- `PostProcessAppConfig(appTomlPath, ports)`
- `ConfigureStateSync(configPath, rpcServers, trustHeightOffset)`

### internal/node/ports.go
- `DiscoverPorts(defaults, maxIncrement)` — find available ports
- `IsPortAvailable(port)` — try net.Listen

### internal/node/instance.go
- `Instance` struct (PID, ports, timestamp)
- `LoadInstance()` / `SaveInstance()` / `RemoveInstance()`
- `IsInstanceAlive(instance)` — PID check
- `HealthCheckPorts(instance)` — try connecting to RPC

### internal/node/moniker.go
- `GenerateMoniker()` — random funny name + timestamp

## Settings Changes

Update defaults in `internal/config/settings.go`:
- `ProxyRESTPort`: 1418 → 2317
- `ProxyRPCPort`: 26658 → 36657

## UI

- StatusBar and AppState.CurrentWork shows: "Downloading configuration...", "Downloading BZE node...", "Initializing node...", "Configuring state sync..."
- Progress percentage for binary download

## Verification

1. App starts → fetches remote config → downloads binary → inits node → discovers ports
2. `instance.json` written with correct PID and ports
3. Binary at `{appdata}/bin/bzed` is executable
4. Node home at `{appdata}/node/` has genesis, config.toml, app.toml
5. config.toml has correct moniker, state sync enabled, correct ports
6. app.toml has correct ports, REST/gRPC enabled
7. Second app instance detects first via instance.json, uses same ports
8. Status bar shows progress during setup
