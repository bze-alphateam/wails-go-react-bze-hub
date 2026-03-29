# BZE Hub - Business & Product Vision

## Product Vision

**One-liner**: A self-contained desktop gateway to the BZE ecosystem that runs its own light node, manages keys locally, and renders all BZE dApps without a browser extension.

### Problem Statement

Today, interacting with the BZE blockchain requires:
- Installing a browser extension (Keplr or Leap) to manage keys and sign transactions
- Trusting third-party RPC providers for all chain interactions
- Managing multiple browser tabs for different dApps (DEX, Burner, Staking)
- No straightforward way for regular users to run a node and contribute to network decentralization
- CLI-only node setup that is intimidating for non-technical users

### Solution

BZE Hub is a single desktop application that:
- Manages wallet keys in the OS-native keyring (more secure than browser extensions)
- Runs a local BZE node automatically (contributes to decentralization)
- Renders all BZE dApps in a tabbed interface (unified experience)
- Falls back to public RPCs seamlessly when the local node is syncing
- Requires zero CLI knowledge from the user

## Target Users

### Primary

1. **BZE Power Users** - Traders, stakers, and token burners who interact with BZE daily. They want sovereignty over their keys and a faster connection via their own node.

2. **Privacy-Conscious Users** - People who don't want their keys in a browser extension or their queries going through third-party RPCs. They want local-first infrastructure.

3. **New BZE Users** - People discovering BZE who are intimidated by browser extensions and CLI setup. They want a "download and go" experience.

### Secondary

4. **Node Operators (Personal)** - Validators or enthusiasts who want a pruned node for personal use without managing CLI configs.

5. **Developers** - Building on BZE who need to test against a local node with easy mainnet/testnet switching.

## User Stories

### Wallet & Keys
- As a BZE holder, I want to create a new wallet with a 24-word mnemonic stored in my OS keyring, so my keys never touch a browser process
- As a user with an existing Keplr wallet, I want to import my mnemonic into BZE Hub, so I can access my funds from the desktop app
- As a security-conscious user, I want the app to require my OS password (or Touch ID / Windows Hello) before revealing my mnemonic, so unauthorized people cannot export my keys
- As a multi-account user, I want to switch between my addresses with one click, and have all dApps reflect the change immediately

### Local Node
- As a new user, I want the app to automatically download and start a BZE node on first launch, so I don't need to know anything about node operation
- As a user, I want to use public RPCs immediately while my node syncs in the background, so I'm never blocked from using the dApps
- As a user, I want my node to state sync periodically (every 48 hours) to keep disk usage low, without me having to manage it
- As a user, I want to see my node's sync progress and health status in a dashboard panel

### dApp Browser
- As a trader, I want to open the DEX in a tab and trade without installing any browser extension, using my BZE Hub wallet
- As a staker, I want to see my delegations, claim rewards, and redelegate - all within BZE Hub
- As a token burner, I want to access the Burner dApp with the same UX as the web version
- As a user, I want dApps to automatically use my local node when it's synced, and fall back to public RPCs when it's not

### Configuration
- As a developer, I want to switch between mainnet and testnet easily, so I can test my dApp changes
- As an advanced user, I want to configure custom RPC endpoints if I run my own infrastructure
- As a user, I want to export my account list and settings to back up or migrate to another machine

## Competitive Analysis

### vs. Browser + Keplr/Leap

| Aspect | Browser + Extension | BZE Hub |
|--------|-------------------|---------|
| Key storage | Browser extension (localStorage) | OS keyring (macOS Keychain, etc.) |
| Node | None (relies on public RPCs) | Built-in local node |
| Setup | Install extension + configure chain | Download app + launch |
| dApp access | Separate browser tabs | Integrated tabs |
| Decentralization | Does not contribute | Every user runs a node |
| Updates | Extension + dApp updates separately | dApps auto-update (live URLs) |

**BZE Hub advantage**: More secure key storage, local node for sovereignty and network health, unified UX.

### vs. Running `bzed` Manually

| Aspect | Manual CLI | BZE Hub |
|--------|-----------|---------|
| Setup | `bzed init`, edit configs, download genesis, configure peers | Automatic on first launch |
| State sync | Run scripts, calculate trust heights manually | Automatic every 48h |
| Pruning | Edit app.toml manually | Pre-configured aggressive |
| Updates | Download new binary, stop node, replace, restart | One-click update |
| Wallet | `bzed keys add` in terminal | GUI with OS keyring |

**BZE Hub advantage**: Zero CLI knowledge required, automated maintenance.

### vs. Cosmostation Desktop / Leap Desktop

| Aspect | Generic Cosmos Wallets | BZE Hub |
|--------|----------------------|---------|
| Focus | Multi-chain, generic | BZE-native, purpose-built |
| dApps | External browser only | Embedded in tabs |
| Node | None | Built-in BZE node |
| Customization | Generic Cosmos UX | BZE-specific features |

**BZE Hub advantage**: Deeply integrated with BZE ecosystem, runs a local node, embeds the actual dApps.

## Value Propositions

1. **Decentralization** - Every BZE Hub user contributes a node to the network, improving resilience
2. **Security** - OS-native keyring is more secure than browser extension storage. Every transaction requires explicit approval.
3. **Convenience** - One download, one app. No browser extensions, no CLI, no managing multiple tabs
4. **Self-Sovereignty** - Once the local node is synced, users are fully independent from third-party RPC providers
5. **Always Current** - dApps load from live URLs, so users always get the latest version without app updates

## Success Metrics

| Metric | Description | Target (6 months) |
|--------|-------------|-------------------|
| Installs | Total desktop installs across all platforms | TBD |
| Synced nodes | % of active users with a fully synced local node | > 70% |
| TX volume | Transactions signed through BZE Hub vs browser wallets | TBD |
| Network nodes | Increase in BZE network node count attributable to Hub | TBD |
| Retention | Weekly active users / Total installs | > 40% |

## Revenue / Sustainability

BZE Hub is a public good for the BZE ecosystem. Potential sustainability models:
- Funded by BZE community pool governance proposals
- Optional in-app feature: premium node configurations, priority peer connections
- Drives ecosystem growth which benefits all BZE token holders

## Roadmap Phases

### Phase 1: Foundation (MVP)
- Wails project setup, basic React shell
- Wallet: create, import, switch accounts, sign transactions
- Node manager: download binary, init, start with state sync
- UI shell: iframe tabs for DEX, Burner, Staking with Keplr bridge
- Configuration dashboard with node status

### Phase 2: Polish
- Auto-updater for bzed binary
- Chain upgrade detection and handling
- Testnet support with network switching
- Signing approval dialog with human-readable message decoding
- Export/import settings and accounts

### Phase 3: Expansion
- Third-party dApp support with permission model
- Address book and transaction history (local)
- IBC transfer UI in the dashboard
- Notification system (staking rewards, order fills)
- Optional: act as a WalletConnect wallet for external dApps

### Phase 4: Advanced
- Multi-chain support (other Cosmos chains)
- Hardware wallet support (Ledger integration)
- Built-in governance voting UI
- P2P node discovery improvements
- Mobile companion app (future consideration)
