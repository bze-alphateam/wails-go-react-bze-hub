# BZE Hub

A cross-platform desktop application for the BeeZee (BZE) blockchain ecosystem. BZE Hub bundles a local node, an embedded wallet, and native BZE dApp interfaces into a single native application.

> **Direction note:** BZE Hub originally embedded the live web dApps (dex/burner/staking) in iframes and bridged them to the wallet via a Keplr-compatible `window.keplr` (the `@bze/hub-connector` package). **That approach has been dropped.** All dApp functionality is being reimplemented **natively** in the desktop app — native React UI calling Go backend bindings directly. The native architecture is still being designed; sections below marked _TBD_ will be filled in as it lands.

## Architecture Overview

```
+-----------------------------------------------------------+
|                      BZE Hub (Wails v2)                   |
|                                                           |
|  +-------------------+   +-----------------------------+  |
|  |   React UI        |   |        Go Backend           |  |
|  |                   |   |                             |  |
|  |  +-- Tab Bar --+  |   |  +-- Node Manager --------+ |  |
|  |  | Dashboard   |  |   |  | Download bzed binary    | |  |
|  |  | Staking     |  |<->|  | Init, start, stop       | |  |
|  |  | (DEX/Burner |  |   |  | State sync (every 48h)  | |  |
|  |  |  TBD native)|  |   |  | Health monitoring       | |  |
|  |  +-------------+  |   |  +-------------------------+ |  |
|  |                   |   |  +-- Wallet (Keyring) ----+ |  |
|  |  Native pages     |   |  | OS keyring (secrets)    | |  |
|  |  call Go via      |   |  | BIP44 derivation        | |  |
|  |  Wails bindings   |   |  | Sign amino/direct       | |  |
|  |  (no iframes,     |   |  +-------------------------+ |  |
|  |   no bridge)      |   |  +-- Chain Client --------+ |  |
|  +-------------------+   |  | gRPC/REST queries        ||  |
|                          |  +-------------------------+ |  |
+-----------------------------------------------------------+
                                       |
                                       v
                          +---------------------------+
                          | Hub Proxy Servers         |
                          | REST proxy :1418          |
                          | RPC proxy  :26658         |
                          |   |                       |
                          |   +-> Local Node :1317/657|
                          |   |   (when synced)       |
                          |   +-> Public RPCs         |
                          |       (fallback)          |
                          +---------------------------+
```

## Three Pillars

1. **Local Node Manager** - Automatically downloads, configures, and runs a `bzed` node with aggressive pruning. It re-state-syncs when the local store grows too large (disk) **or** when the node falls too far behind the network (staleness), keeping disk usage minimal and avoiding slow block-by-block catch-up. Two local proxy servers (REST `:1418`, RPC `:26658`) transparently route traffic to the local node when synced or public RPCs when not. Failover is invisible to the rest of the app.

2. **Embedded Wallet** - Stores mnemonics and private keys in the OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service). Supports multiple accounts with BIP44 derivation. All signing requires explicit user approval.

3. **Native dApp Interfaces** - BZE dApp functionality is implemented natively in the React UI as first-class pages (Dashboard and Staking today; DEX and Burner planned). Pages call the Go backend through Wails bindings for queries and signing — no iframes, no browser extension, no postMessage bridge. _Native DEX/Burner design: TBD._

## Supported Platforms

| Platform | Architecture | Package Format |
|----------|-------------|----------------|
| macOS    | AMD64       | `.dmg`         |
| macOS    | ARM64       | `.dmg`         |
| Windows  | AMD64       | `.exe` (NSIS)  |
| Linux    | AMD64       | `.AppImage`    |
| Linux    | ARM64       | `.AppImage`    |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend   | Go 1.25, Wails v2 |
| Frontend  | React 19, TypeScript, Chakra UI (native UI) |
| Node | `bzed` (Cosmos SDK v0.50) |
| Wallet Crypto | cosmos-sdk/crypto, go-bip39 |
| Keyring | OS-native via go-keyring |
| dApp UI | Native React pages + Wails bindings |

## Prerequisites

- Go 1.25+
- Node.js 20+ and npm
- Wails v2 CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)
- Platform-specific:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libgtk-3-dev`, `libwebkit2gtk-4.0-dev`
  - **Windows**: WebView2 Runtime (usually pre-installed on Windows 10/11)

Run `wails doctor` to verify your environment.

## Quick Start

```bash
# Clone the repository
cd bze-ecosystem/bze-hub

# Development mode with hot reload
wails dev

# Production build
wails build
```

On first launch, BZE Hub will:
1. Download the latest `bzed` binary from GitHub releases
2. Initialize a node home directory in your app data folder
3. Begin state sync against public RPCs
4. Serve the native dApp UI with public RPC fallback until the local node is synced

## Testing

Tests are run through the root `Makefile` (single entrypoint, so we don't run `go`/`npm` by hand):

```bash
make test          # Go + frontend tests
make test-go       # Go unit tests only (fast — use after each change)
make test-go-race  # Go tests with the race detector
make test-fe       # frontend tests (auto-skips until a "test" script exists in frontend/package.json)
```

Frontend tests aren't set up yet; `make test-fe` skips gracefully and will start running them automatically once a `test` script is added (Vitest is the planned framework for the Vite/React frontend).

## Documentation

| Document | Description |
|----------|-------------|
| [BUSINESS.md](BUSINESS.md) | Product vision, user stories, competitive analysis |
| [01-project-setup.md](01-project-setup.md) | Wails project structure, build system, data directories |
| [02-node-manager.md](02-node-manager.md) | Node lifecycle, binary management, state sync, pruning |
| [03-wallet.md](03-wallet.md) | Keyring, BIP44 derivation, account management, signing |
| [05-auto-updater.md](05-auto-updater.md) | Binary version checking, download, verification |
| [06-security.md](06-security.md) | Approval flows, permission model |
| [07-configuration.md](07-configuration.md) | Dashboard UI, settings, network switching |
| [08-build-distribution.md](08-build-distribution.md) | Cross-platform builds, CI/CD, packaging |

_Native dApp UI design docs: TBD (to replace the removed iframe/bridge `04-ui-shell.md`)._

## Key Design Decisions

- **Native dApp UI over embedded web dApps**: dApp features are built natively in React against Go bindings, instead of embedding live web dApps in iframes. Full control over UX, no cross-origin/embedding constraints, no dependency on the web dApps' availability.
- **Local proxy servers**: Two Go reverse proxies (REST, RPC) that the backend's chain queries connect to. The proxy handles failover between the local node and public endpoints per-request, so callers never need to know about endpoint changes.
- **OS keyring over custom encryption**: Leverages platform security (Touch ID, Windows Hello, system password). No custom crypto.
- **State sync over full sync**: Keeps disk usage under ~2GB vs 50GB+ for full history. Re-syncs every 48h to prevent state bloat.
- **Thin UI, thick Go backend**: All business logic in Go. React is a presentation layer — it renders state from Go events and forwards user actions to Go bindings. No secrets in the frontend.
