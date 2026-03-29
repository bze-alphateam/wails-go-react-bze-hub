# BZE Hub

A cross-platform desktop application for the BeeZee (BZE) blockchain ecosystem. BZE Hub bundles a local node, embedded wallet, and dApp browser shell into a single native application.

## Architecture Overview

```
+-----------------------------------------------------------+
|                      BZE Hub (Wails v2)                   |
|                                                           |
|  +-------------------+  +------------------------------+ |
|  |   React Shell     |  |       Go Backend             | |
|  |                   |  |                               | |
|  |  +-- Tab Bar --+  |  |  +-- Node Manager ----------+| |
|  |  | DEX | Burn  |  |  |  | Download bzed binary      || |
|  |  | Stake| Dash |  |  |  | Init, start, stop         || |
|  |  +-----+------+  |  |  | State sync (every 48h)     || |
|  |                   |  |  | Health monitoring           || |
|  |  |  +- iframes ---+  |  |  +----------------------------+| |
|  |  | dApp URLs   |<----->  +-- Wallet (Keyring) -------+| |
|  |  | (live sites)|  |  |  | OS keyring (secrets)       || |
|  |  +-------------+  |  |  | BIP44 derivation           || |
|  |        ^           |  |  | Sign direct/amino          || |
|  |        |           |  |  +----------------------------+| |
|  |  @bze/hub-connector|  |                               | |
|  |  (postMessage      |  |  +-- Bridge Handler ---------+| |
|  |   to shell)        |  |  | Keplr-compatible API       || |
|  +-------------------+  |  | Shell <-> Wails bindings    || |
|                          |  | experimentalSuggestChain    || |
|                          |  +----------------------------+| |
+-----------------------------------------------------------+
          |                           |
          v                           v
  +----------------+        +---------------------------+
  | Live dApp URLs |        | Hub Proxy Servers         |
  | dex.getbze.com |        | REST proxy :1418          |
  | burner.getbze  |        | RPC proxy  :26658         |
  | stake.getbze   |        |   |                       |
  +----------------+        |   +-> Local Node :1317/657 |
                             |   |   (when synced)       |
                             |   +-> Public RPCs         |
                             |       (fallback)          |
                             +---------------------------+
```

## Three Pillars

1. **Local Node Manager** - Automatically downloads, configures, and runs a `bzed` node with aggressive pruning. State syncs every 48 hours to keep disk usage minimal. Two local proxy servers (REST `:1418`, RPC `:26658`) transparently route traffic to the local node when synced or public RPCs when not. dApps always connect to the proxy - failover is invisible.

2. **Embedded Wallet** - Stores mnemonics and private keys in the OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service). Supports multiple accounts with BIP44 derivation. All signing requires explicit user approval.

3. **dApp Browser Shell** - Persistent React shell with tab bar, status bar, and approval dialog. BZE dApps (DEX, Burner, Staking) render in iframes from their live URLs. A dedicated `@bze/hub-connector` npm library creates a Keplr-compatible `window.keplr` via postMessage bridge. Any Cosmos dApp can add Hub support with one `npm install` and one line of code.

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
| Frontend Shell | React 19, TypeScript |
| Node | `bzed` (Cosmos SDK v0.50) |
| Wallet Crypto | cosmos-sdk/crypto, go-bip39 |
| Keyring | OS-native via go-keyring |
| dApp Rendering | iframes + @bze/hub-connector bridge |

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
4. Display the dApp browser with public RPC fallback until the local node is synced

## Documentation

| Document | Description |
|----------|-------------|
| [BUSINESS.md](BUSINESS.md) | Product vision, user stories, competitive analysis |
| [01-project-setup.md](01-project-setup.md) | Wails project structure, build system, data directories |
| [02-node-manager.md](02-node-manager.md) | Node lifecycle, binary management, state sync, pruning |
| [03-wallet.md](03-wallet.md) | Keyring, BIP44 derivation, account management, signing |
| [04-ui-shell.md](04-ui-shell.md) | Single webview navigation, Keplr bridge injection, tab bar, endpoint routing |
| [05-auto-updater.md](05-auto-updater.md) | Binary version checking, download, verification |
| [06-security.md](06-security.md) | Approval flows, sandboxing, permission model |
| [07-configuration.md](07-configuration.md) | Dashboard UI, settings, network switching |
| [08-build-distribution.md](08-build-distribution.md) | Cross-platform builds, CI/CD, packaging |

## Key Design Decisions

- **Keplr-compatible bridge over custom connector**: Existing dApps already support Keplr. By mimicking its API, we avoid any dApp code changes.
- **Persistent shell + iframes over single webview navigation**: React shell always rendered (tab bar, status bar, approval dialog). dApps in iframes with state preserved across tab switches. Bridge via `@bze/hub-connector` library.
- **Dedicated connector library over bze-ui-kit changes**: `@bze/hub-connector` is a standalone package any Cosmos dApp can import. Not coupled to BZE's UI kit.
- **Local proxy servers over direct endpoint switching**: Two Go reverse proxies (REST, RPC) that dApps always connect to. The proxy handles failover between local node and public endpoints per-request. dApps never need to know about endpoint changes.
- **Live URLs over bundled UIs**: dApps update independently without desktop app releases. Always latest version.
- **OS keyring over custom encryption**: Leverages platform security (Touch ID, Windows Hello, system password). No custom crypto.
- **State sync over full sync**: Keeps disk usage under ~2GB vs 50GB+ for full history. Re-syncs every 48h to prevent state bloat.
- **Thin UI, thick Go backend**: All business logic in Go. React is a pure presentation layer — renders state from Go events, forwards user actions to Go bindings. No HTTP calls, no state management, no secrets in the frontend.
