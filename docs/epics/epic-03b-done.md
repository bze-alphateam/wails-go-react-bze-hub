# Epic 3b Complete: Node Binary Download + Init

## What Was Done

Full node setup pipeline: remote config fetching, binary download, port discovery, instance management, and node initialization with config post-processing.

## Sub-epics

### 3b-1: Remote Config + Binary Download
- `internal/node/remoteconfig.go` — fetch from URL, cache locally, parse binaries map + checksums
- `internal/node/binary.go` — resolve URL (from config or GitHub releases fallback), download with progress, SHA256 checksum verification
- `internal/node/moniker.go` — 100 funny names, random pick on each init

### 3b-2: Port Discovery + Instance Management + Node Init
- `internal/node/ports.go` — discover available ports with increment (max 100), for both node (P2P, RPC, REST, gRPC) and proxy (REST, RPC)
- `internal/node/instance.go` — instance.json with PID + ports, process alive check, health check, multi-instance support
- `internal/node/init.go` — full init sequence: bzed init, download genesis/config.toml/app.toml from remote config URLs, post-process configs (moniker, ports, state sync, enable REST/gRPC), TOML section-aware editing

## Remote Config

- URL baked at build time: `main.remoteConfigURL`
- Default: `https://raw.githubusercontent.com/bze-alphateam/bze-configs/refs/heads/main/bze-hub/mainnet.json`
- Fetched fresh on every startup, cached locally at `{appdata}/config/remote-config.json`
- If GitHub unreachable, uses cached version

## Port Defaults (Updated)

| Port | Default | Purpose |
|------|---------|---------|
| Node P2P | 26656 | Peer-to-peer |
| Node RPC | 26657 | Tendermint RPC |
| Node REST | 1317 | Cosmos REST API |
| Node gRPC | 9090 | gRPC |
| Proxy REST | 2317 | Hub's REST proxy |
| Proxy RPC | 36657 | Hub's RPC proxy |

## Instance Management

- `instance.json` holds PID, timestamps, and all ports
- On startup: check existing instance → if PID alive + healthy → use its ports (second instance mode)
- If PID dead or unhealthy → take over (primary mode)
- On shutdown: remove instance.json if we own the node

## Config Post-Processing

After downloading config.toml and app.toml from remote:
- **Moniker**: "BZE Hub - {funny_name} - {timestamp}" (new on every init/re-sync)
- **State sync**: enabled, trust_height/hash calculated from live chain, rpc_servers from remote config
- **Node ports**: P2P, RPC set in config.toml from discovered ports
- **App ports**: REST, gRPC set in app.toml from discovered ports, REST enabled, gRPC enabled, unsafe CORS enabled
- **Pruning**: NOT touched (comes from remote as-is)

## Startup Flow

1. Check existing instance (multi-instance support)
2. Fetch remote config (cache locally)
3. Download binary if missing (GitHub releases fallback when no binaries in config)
4. Discover available ports
5. Init node if not initialized (bzed init + download configs + post-process)
6. Write instance.json
7. Start proxy servers on discovered ports
8. Status bar shows progress throughout

## Verified

```
Remote config: ✅ fetched and cached
Binary: ✅ downloaded v8.0.2, checksum verified
Ports: ✅ discovered (all defaults available)
Instance: ✅ instance.json written with PID and ports
Node init: ✅ genesis + config.toml + app.toml downloaded
Moniker: ✅ "BZE Hub - Zen Tiger - 20260330-120223"
State sync: ✅ trust_height=22107789
Proxies: ✅ REST :2317, RPC :36657 serving real data
Shutdown: ✅ clean, instance.json removed
```

## What's Next (Epic 3c)

Node lifecycle + health monitor:
- Start/stop node as child process
- Health monitoring (fast 5s loop + slow hourly loop)
- Crash recovery doctor routine
- Proxy switches between local/public based on node state
- Re-sync with fresh config download
