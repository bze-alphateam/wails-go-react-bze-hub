# Epic 07: Configuration Dashboard

Dashboard UI panels, settings persistence, network switching, app preferences, and export/import.

## 1. Overview

The Configuration Dashboard is a built-in tab (not an iframe) rendered by the React shell. It provides:

- **Node Status** panel with controls and sync progress
- **Wallet Management** panel for accounts, import/export
- **Network Settings** for mainnet/testnet switching
- **App Settings** for preferences and behavior
- **Security** panel for managing dApp permissions

The dashboard communicates with the Go backend via Wails bindings and receives real-time updates via Wails events.

## 2. Dashboard Layout

```
+-------------------------------------------------------------------+
|  Dashboard                                                         |
|                                                                    |
|  +-- Node Status -----------------------------------------------+ |
|  | Status: [*] Synced                                           | |
|  | Height: 1,234,567 / 1,234,567 (100%)                        | |
|  | Block Time: 2026-03-29 14:32:15                              | |
|  | Peers: 12 connected                                          | |
|  | Disk: 1.8 GB                                                 | |
|  | Binary: bzed v8.1.0                                          | |
|  | Last State Sync: 2026-03-28 02:00:00 (next in 14h)          | |
|  |                                                              | |
|  | [ Start ] [ Stop ] [ Restart ] [ Force State Sync ]          | |
|  | [ View Logs ]                                                | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +-- Wallet ----------------------------------------------------+ |
|  | Active: Main Account (bze1abc...def)         [ Switch v ]    | |
|  |                                                              | |
|  | Accounts:                                                    | |
|  | (*) Main Account    bze1abc...def    125.5 BZE    [...]     | |
|  | ( ) Trading         bze1xyz...ghi     42.0 BZE    [...]     | |
|  | ( ) Savings         bze1qrs...tuv  1,000.0 BZE    [...]     | |
|  |                                                              | |
|  | [ + Create Account ] [ Import Mnemonic ] [ Import Key ]      | |
|  | [ Backup Recovery Phrase ]                                    | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +-- Network & Settings ----------------------------------------+ |
|  | Network: Mainnet (beezee-1)                                 | |
|  | Auto-start node: [x]                                         | |
|  | Auto-check updates: [x]                                      | |
|  | State sync interval: [ 48 ] hours                            | |
|  | Theme: Light / Dark                                          | |
|  +--------------------------------------------------------------+ |
+-------------------------------------------------------------------+
```

## 3. Node Status Panel

### Data Source

```typescript
// Polled via Wails events (pushed from Go)
interface NodeStatus {
    state: "not_started" | "starting" | "syncing" | "synced" | "error" | "stopped";
    latestHeight: number;
    targetHeight: number;
    catchingUp: boolean;
    latestBlockTime: string;
    syncPercent: number;
    peerCount: number;
    uptime: string;
    diskUsageBytes: number;
    binaryVersion: string;
    lastStateSyncAt: string;
    nextStateSyncAt: string;
}
```

### Status Indicator Colors

| State | Color | Icon |
|-------|-------|------|
| `synced` | Green | Filled circle |
| `syncing` | Yellow/amber | Spinning |
| `starting` | Blue | Pulsing |
| `error` | Red | Warning triangle |
| `stopped` | Gray | Empty circle |
| `not_started` | Gray | Dash |

### Controls

| Button | Action | Confirmation Required |
|--------|--------|----------------------|
| Start | `App.StartNode()` | No |
| Stop | `App.StopNode()` | Yes ("Stop the local node?") |
| Restart | `App.RestartNode()` | No |
| Force State Sync | `App.ForceStateSync()` | Yes ("This will reset node data and re-sync") |
| View Logs | Opens log viewer modal | No |

### Log Viewer

A modal/panel showing the last 200 lines of node stdout/stderr:

```typescript
const logs = await App.GetRecentLogs(200);
```

Features:
- Auto-scroll to bottom
- Search/filter text
- Copy to clipboard
- Toggle between stdout and stderr
- Refresh button

### Sync Progress Bar

When `state === "syncing"`:

```
Syncing: [=============>          ] 67% (826,543 / 1,234,567)
Estimated time remaining: ~15 minutes
```

## 4. Wallet Management Panel

The wallet panel handles **key management only**. Balances, transactions, staking, and all other wallet features are in the dApps. See 03-wallet.md for the full data model and keyring architecture.

### Layout

Accounts are grouped by their source mnemonic, with imported PKs in a separate section. The user always sees which mnemonic each address came from.

```
+-------------------------------------------------------------------+
|  Wallet                                                            |
|                                                                    |
|  Active: My Main Wallet (bze1abc...def)            [ Switch v ]    |
|                                                                    |
|  --- My Main Wallet (mnemonic) ------------- [ Export Phrase ] --- |
|  (*) My Main Wallet   bze1abc...def   m/.../0/0             [...]  |
|  ( ) Trading           bze1xyz...ghi   m/.../0/1             [...]  |
|                                                                    |
|  --- Hardware Backup (mnemonic) ------------ [ Export Phrase ] --- |
|  ( ) Savings           bze1qrs...tuv   m/.../0/0             [...]  |
|                                                                    |
|  --- Imported Keys ------------------------------------------------ |
|  ( ) Old Wallet        bze1fed...cba   (imported PK)         [...]  |
|                                                                    |
|  [ + New Address ]   [ Import Mnemonic ]   [ Import Key ]          |
|  [ Generate New Mnemonic ]                                         |
+-------------------------------------------------------------------+
```

### Actions

**[ + New Address ]**: Derive next HD index.
- If multiple mnemonics → picker: "Derive from which mnemonic?"
- If one mnemonic → use it directly
- If zero mnemonics (only imported PKs) → redirect to Generate New Mnemonic flow
- Requires auth (keyring access for mnemonic)

**[ Import Mnemonic ]**: Add a mnemonic alongside existing ones (does NOT replace).
- User provides a label + 12/24 words
- Validates BIP39, shows derived address (index 0) for confirmation
- Stores mnemonic + first PK in keyring

**[ Import Key ]**: Import a standalone private key.
- User provides a label + hex-encoded PK
- Shows derived address for confirmation
- Cannot derive additional addresses from this (no mnemonic)

**[ Generate New Mnemonic ]**: Generate a fresh 24-word mnemonic.
- Same flow as first-run (label, show phrase, confirm 4 words, derive first address)
- Adds alongside existing mnemonics

**[ Export Phrase ]** (per mnemonic): Reveal with auth + 60s auto-hide + copy button.

**[...] menu** per account: Rename, View QR Code, Copy Address, Delete.

**Delete account**: removes PK from keyring. If last account for a mnemonic, asks whether to also remove the mnemonic from keyring. Cannot delete the last remaining account.

## 5. Network

### MVP: Mainnet Only

The MVP targets **mainnet only** (`beezee-1`). There is no network switching UI.

Testnet support (switching between mainnet and testnet) is a **post-MVP feature**. When implemented, it would require:
- Separate node home directories per network
- Stopping/restarting the node with different config
- Reloading all dApp iframes
- Updating the proxy targets
- Separate genesis, peers, and state sync RPC servers

This complexity is deferred.

## 6. App Settings

### Normal Mode vs Developer Mode

The settings panel has two modes:

- **Normal mode** (default): Simple settings that any user might change. Clean UI, no technical jargon.
- **Developer mode**: Exposes all internal tuning parameters — timeouts, thresholds, intervals, ports. Hidden behind a toggle. For power users and developers troubleshooting issues.

```
+-------------------------------------------------------------------+
|  Settings                                                          |
|                                                                    |
|  Auto-start node on launch:    [x]                                 |
|  Auto-check for updates:       [x]                                 |
|  Theme:                        [ Light v ]                         |
|  Log level:                    [ Error v ]                         |
|                                                                    |
|  [ ] Developer mode                                                |
|                                                                    |
|  (when developer mode is checked, advanced section appears below)  |
|                                                                    |
|  +-- Advanced (Developer Mode) --------------------------------+   |
|  |                                                             |   |
|  |  Node & Sync                                                |   |
|  |  Re-sync block threshold:       [ 28800 ] blocks            |   |
|  |  Max block age (synced check):  [ 18    ] seconds           |   |
|  |                                                             |   |
|  |  Proxy                                                      |   |
|  |  Local node timeout:            [ 1500  ] ms                |   |
|  |  Circuit breaker fail threshold:[ 3     ] requests          |   |
|  |  Circuit breaker cooldown:      [ 120   ] seconds           |   |
|  |  REST proxy port:               [ 1418  ]                   |   |
|  |  RPC proxy port:                [ 26658 ]                   |   |
|  |                                                             |   |
|  |  Health Monitor                                             |   |
|  |  Fast loop interval:            [ 5     ] seconds           |   |
|  |  Slow loop interval:            [ 3600  ] seconds           |   |
|  |  Cross-check block delta:       [ 2     ] blocks            |   |
|  |                                                             |   |
|  |  Node Doctor                                                |   |
|  |  Retry delays:                  [ 5,30,120,300 ] seconds    |   |
|  |                                                             |   |
|  |  Log level:                     [ Debug v ]                 |   |
|  |                                                             |   |
|  |  [ Reset All to Defaults ]                                  |   |
|  +-------------------------------------------------------------+   |
+-------------------------------------------------------------------+
```

### Settings Data Model

```go
type AppSettings struct {
    // --- Normal mode settings ---
    AutoStartNode    bool   `json:"autoStartNode"`     // Default: true
    AutoCheckUpdates bool   `json:"autoCheckUpdates"`  // Default: true
    Theme            string `json:"theme"`             // "light" or "dark"
    LogLevel         string `json:"logLevel"`          // "error" (default), "info", "debug"
    DeveloperMode    bool   `json:"developerMode"`     // Default: false

    // --- Developer mode settings (advanced) ---
    // Node & Sync
    ResyncBlockThreshold int `json:"resyncBlockThreshold"` // Default: 28800 (~48h of blocks)
    MaxBlockAgeSec       int `json:"maxBlockAgeSec"`       // Default: 18

    // Proxy
    LocalNodeTimeoutMs       int `json:"localNodeTimeoutMs"`       // Default: 1500
    CircuitBreakerThreshold  int `json:"circuitBreakerThreshold"`  // Default: 3
    CircuitBreakerCooldownSec int `json:"circuitBreakerCooldownSec"` // Default: 120
    ProxyRESTPort            int `json:"proxyRestPort"`            // Default: 1418
    ProxyRPCPort             int `json:"proxyRpcPort"`             // Default: 26658

    // Health Monitor
    FastLoopIntervalSec  int `json:"fastLoopIntervalSec"`  // Default: 5
    SlowLoopIntervalSec  int `json:"slowLoopIntervalSec"`  // Default: 3600
    CrossCheckBlockDelta int `json:"crossCheckBlockDelta"` // Default: 2

    // Node Doctor
    DoctorRetryDelaysSec []int `json:"doctorRetryDelaysSec"` // Default: [5, 30, 120, 300]
}
```

All developer mode settings have sensible defaults. If the user never touches developer mode, everything works with the defaults. Developer mode fields are always present in `settings.json` (with defaults) — the toggle only controls UI visibility, not data presence.

### Persistence

Settings stored in `{appdata}/config/settings.json`. Loaded on app startup, written immediately on change.

```go
func defaultSettings() AppSettings {
    return AppSettings{
        AutoStartNode:            true,
        AutoCheckUpdates:         true,
        Theme:                    "light",
        LogLevel:                 "error",
        DeveloperMode:            false,
        ResyncBlockThreshold:     28800,
        MaxBlockAgeSec:           18,
        LocalNodeTimeoutMs:       1500,
        CircuitBreakerThreshold:  3,
        CircuitBreakerCooldownSec: 120,
        ProxyRESTPort:            1418,
        ProxyRPCPort:             26658,
        FastLoopIntervalSec:      5,
        SlowLoopIntervalSec:     3600,
        CrossCheckBlockDelta:     2,
        DoctorRetryDelaysSec:     []int{5, 30, 120, 300},
    }
}

func (s *Settings) Load() error {
    path := filepath.Join(s.configDir, "settings.json")
    data, err := os.ReadFile(path)
    if os.IsNotExist(err) {
        s.current = defaultSettings()
        return s.Save()
    }
    // Unmarshal into defaults so new fields added in future versions get their defaults
    s.current = defaultSettings()
    return json.Unmarshal(data, &s.current)
}

func (s *Settings) Save() error {
    path := filepath.Join(s.configDir, "settings.json")
    data, _ := json.MarshalIndent(s.current, "", "  ")
    return os.WriteFile(path, data, 0644)
}
```

**Forward compatibility**: `Load()` unmarshals into a pre-filled defaults struct. If a future version adds new settings fields, existing `settings.json` files from older versions will get the defaults for new fields automatically.

### Normal Mode Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-start node | `true` | Start the local node when the app launches |
| Auto-check updates | `true` | Periodically check GitHub for new bzed releases |
| Theme | `light` | UI theme for the dashboard shell |
| Log level | `error` | Logging verbosity (see Logging section below) |

### Developer Mode Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Re-sync block threshold | `28800` | Trigger re-sync when node's block range (earliest to latest) exceeds this. ~48h at 6s/block. |
| Max block age | `18` sec | If `latest_block_time` is older than this and `catching_up` is false, node is considered out of sync. |
| Local node timeout | `1500` ms | Per-request timeout for the proxy calling the local node. If exceeded, falls back to public. |
| Circuit breaker threshold | `3` | Number of failed local requests before marking it unsafe. |
| Circuit breaker cooldown | `120` sec | How long to avoid the local node after the circuit breaker trips. |
| REST proxy port | `1418` | Port for the local REST proxy. Change if conflicts. |
| RPC proxy port | `26658` | Port for the local RPC proxy. Change if conflicts. |
| Fast loop interval | `5` sec | How often the health monitor polls the local node `/status`. |
| Slow loop interval | `3600` sec | How often the hourly cross-check against public endpoints runs. |
| Cross-check block delta | `2` | Max blocks behind public endpoints before flagging the node. |
| Doctor retry delays | `[5,30,120,300]` sec | Backoff delays for the crash recovery doctor routine. |

### Port Changes Require Restart

Changing proxy ports takes effect on next app restart (the proxy listeners bind at startup). A notice in the UI: "Port changes require a restart to take effect."

All other developer settings take effect immediately.

### Logging

**Default level: `error`** — only log errors and unexpected failures. This keeps log files small and avoids accidentally logging sensitive data during normal operation.

**Levels:**

| Level | What Gets Logged | When to Use |
|-------|-----------------|-------------|
| `error` | Errors, panics, failed operations | Default. Normal usage. |
| `info` | Above + node state changes, proxy routing decisions, account switches, signing requests (type only, no payloads) | Mild troubleshooting. |
| `debug` | Above + full HTTP proxy request/response metadata (URLs, status codes, headers), Wails binding calls, bridge message types, keyring access attempts (success/fail, never contents) | Diagnosing specific issues. Ask users to enable this temporarily. |

**What is NEVER logged at any level:**
- Mnemonics or private keys
- Wallet passwords
- Full transaction payloads or sign docs (only message type URLs)
- Keyring contents
- Full HTTP response bodies from proxy (may contain account balances or other user data)

**Single log file:**

```
{appdata}/logs/app.log
```

All components log to the same file with tags identifying the source:

```
2026-03-29T14:32:15Z [ERROR] [node]    state sync failed: no peers available
2026-03-29T14:32:16Z [INFO]  [proxy]   REST proxy routing to public endpoint
2026-03-29T14:32:17Z [DEBUG] [bridge]  signAmino request from dex.getbze.com, type=/bze.tradebin.v1.MsgCreateOrder
2026-03-29T14:32:18Z [INFO]  [wallet]  account switched to bze1abc...def
2026-03-29T14:32:19Z [ERROR] [updater] checksum mismatch for bzed-darwin-arm64.tar.gz
```

**Tags:** `[node]`, `[proxy]`, `[bridge]`, `[wallet]`, `[updater]`, `[config]`, `[app]`

Node process stdout/stderr is also captured into `app.log` with the `[node]` tag rather than separate files. This gives a single unified timeline for debugging.

**Log rotation**: Rotate when `app.log` exceeds 10 MB. Keep last 3 rotated files. Total max ~40 MB.

**Support workflow**: When a user reports an issue:
1. Ask them to set log level to `debug` in Settings
2. Reproduce the issue
3. They send `app.log` (single file has everything — node, proxy, wallet, bridge)
4. Remind them to set log level back to `error`

Since `debug` never logs secrets, the log file is safe to share. But it may contain addresses and transaction type URLs, so users should be aware.

**Implementation:**

```go
// internal/config/logger.go

type LogLevel int

const (
    LogError LogLevel = iota
    LogInfo
    LogDebug
)

var currentLevel LogLevel = LogError

func SetLogLevel(level string) {
    switch level {
    case "debug":
        currentLevel = LogDebug
    case "info":
        currentLevel = LogInfo
    default:
        currentLevel = LogError
    }
}

func Error(msg string, args ...interface{}) {
    writeLog("ERROR", msg, args...)
}

func Info(msg string, args ...interface{}) {
    if currentLevel >= LogInfo {
        writeLog("INFO", msg, args...)
    }
}

func Debug(msg string, args ...interface{}) {
    if currentLevel >= LogDebug {
        writeLog("DEBUG", msg, args...)
    }
}
```

**Log level change takes effect immediately** — no app restart needed. The Dashboard settings panel updates the level via a Wails binding that calls `SetLogLevel()` and persists to `settings.json`.

## 7. Security Panel

### Connected dApps

List dApps that have been granted permissions:

```
+---------------------------------------------------+
|  Connected Applications                            |
|                                                    |
|  dex.getbze.com (built-in)                        |
|    Permissions: connect, sign, suggestChain        |
|    Connected since: 2026-03-01                     |
|                                                    |
|  burner.getbze.com (built-in)                     |
|    Permissions: connect, sign, suggestChain        |
|    Connected since: 2026-03-01                     |
|                                                    |
|  example-dapp.com                                  |
|    Permissions: connect, sign                      |
|    Connected since: 2026-03-25                     |
|    [ Revoke Access ]                               |
|                                                    |
|  [ Revoke All Third-Party Access ]                 |
+---------------------------------------------------+
```

### Transaction History (Future Enhancement)

A log of recent signing requests and their outcomes:

```
| Time | dApp | Action | Status |
|------|------|--------|--------|
| 14:32 | dex.getbze.com | Create DEX Order | Approved |
| 14:28 | dex.getbze.com | Cancel DEX Order | Approved |
| 14:15 | stake.getbze.com | Claim Rewards | Approved |
| 14:10 | example.com | Send Tokens | Rejected |
```

## 8. Export / Import App Data

### Export

Create a JSON bundle of non-secret configuration:

```go
type ExportBundle struct {
    Version    string      `json:"version"`     // Export format version
    ExportedAt time.Time   `json:"exportedAt"`
    Settings   AppSettings `json:"settings"`
    Accounts   []Account   `json:"accounts"`    // Metadata only, no secrets
    Permissions map[string]Permission `json:"permissions"`
    CustomTabs  []Tab      `json:"customTabs,omitempty"`
}
```

**What IS exported**: settings, account names and addresses, dApp permissions, custom tabs
**What is NOT exported**: mnemonics, private keys, node data, logs

Export as a `.json` file via a save dialog.

### Import

Load a previously exported JSON bundle:
1. Parse and validate the file
2. Show preview of what will be imported
3. Merge or replace options for conflicting accounts
4. Apply settings, accounts, permissions
5. Prompt: "Import complete. Restart to apply all changes?"

### Mnemonic Export/Import

Handled separately in the Wallet panel (see section 4 above). Always requires OS authentication. Not included in the general export bundle for security.

## 9. First Launch Experience

### Detection

On startup, check if `{appdata}/config/settings.json` exists. If not, this is a first launch — enter the setup wizard.

### Parallel Tracks

The setup wizard runs two independent tracks in parallel:

1. **Node setup** (background): Download binary, init node home, start state sync
2. **Wallet setup** (foreground): User creates or imports their wallet

Both tracks show progress. The wallet setup is interactive; the node setup runs silently with a progress indicator.

### Wizard Layout

```
+-------------------------------------------------------------------+
|  BZE Hub Setup                                                     |
|                                                                    |
|  +-- Node Progress (top bar, always visible) -------------------+ |
|  | [=====>                    ] Downloading BZE node... 34%      | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +-- Wizard Content (center, interactive) ----------------------+ |
|  |                                                              | |
|  |  (current setup step rendered here)                          | |
|  |                                                              | |
|  +--------------------------------------------------------------+ |
+-------------------------------------------------------------------+
```

The node progress bar stays visible across all wizard steps. It cycles through phases:
- "Downloading BZE node..." (with download %)
- "Creating node configuration..."
- "Starting initial sync..."
- "Node syncing in background" (done — user can proceed)

### Step 1: Welcome

```
+-------------------------------------------------------------------+
|  Welcome to BZE Hub                                                |
|                                                                    |
|  Your self-sovereign gateway to the BZE blockchain.                |
|  BZE Hub runs a local node, manages your wallet,                   |
|  and gives you access to all BZE apps in one place.                |
|                                                                    |
|  [ Get Started ]                                                   |
+-------------------------------------------------------------------+
```

Clicking "Get Started" immediately triggers the node download in the background.

### Step 2: Create or Import Wallet

```
+-------------------------------------------------------------------+
|  Set Up Your Wallet                                                |
|                                                                    |
|  ( ) Create a new wallet                                           |
|      Generate a fresh recovery phrase                              |
|                                                                    |
|  ( ) Import existing wallet                                        |
|      Enter a recovery phrase you already have                      |
|                                                                    |
|  [ Continue ]                                                      |
+-------------------------------------------------------------------+
```

### Step 3a: Create Wallet — Name (and Password on Windows/Linux)

The wallet creation step adapts to the platform:

**macOS** (no password needed — Keychain + Touch ID handles protection):

```
+-------------------------------------------------------------------+
|  Create Your Wallet                                                |
|                                                                    |
|  Wallet name:                                                      |
|  [ My BZE Wallet                ]                                  |
|                                                                    |
|  Your recovery phrase will be stored in the macOS                  |
|  Keychain, protected by Touch ID or your system password.          |
|                                                                    |
|  [ Continue ]                                                      |
+-------------------------------------------------------------------+
```

**Windows / Linux** (password required — OS keyring lacks per-access auth):

```
+-------------------------------------------------------------------+
|  Create Your Wallet                                                |
|                                                                    |
|  Wallet name:                                                      |
|  [ My BZE Wallet                ]                                  |
|                                                                    |
|  Password:                                                         |
|  [ ••••••••••                   ]                                  |
|                                                                    |
|  Confirm password:                                                 |
|  [ ••••••••••                   ]                                  |
|                                                                    |
|  This password encrypts your recovery phrase on this               |
|  device. You'll need it to sign transactions and                   |
|  manage your wallet.                                               |
|                                                                    |
|  [ Continue ]                                                      |
+-------------------------------------------------------------------+
```

**Password requirements** (Windows/Linux): Minimum 8 characters.

**Note**: This is NOT a BIP39 passphrase (25th word). It's an application-level password. The docs and UI must use the word "password" consistently to avoid confusion.

### Step 3b: Import Wallet — Name, Mnemonic (and Password on Windows/Linux)

```
+-------------------------------------------------------------------+
|  Import Your Wallet                                                |
|                                                                    |
|  Wallet name:                                                      |
|  [ My BZE Wallet                ]                                  |
|                                                                    |
|  (Password fields shown on Windows/Linux only)                     |
|  Password:          [ ••••••••••  ]                                |
|  Confirm password:  [ ••••••••••  ]                                |
|                                                                    |
|  Recovery phrase (12 or 24 words):                                 |
|  +--------------------------------------------------------------+ |
|  | word1 word2 word3 word4 word5 word6 word7 word8 ...          | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  [!] Invalid recovery phrase                    (validation msg) | |
|                                                                    |
|  [ Continue ]                                                      |
+-------------------------------------------------------------------+
```

Validation: BIP39 word list check, accept 12 or 24 words.

On continue: derive first account (index 0), store mnemonic in keyring (encrypted with password on Windows/Linux, directly in Keychain on macOS), skip to Step 5 (no need to show/confirm phrase since they already have it).

### Step 4: Show Recovery Phrase (Create flow only)

```
+-------------------------------------------------------------------+
|  Your Recovery Phrase                                              |
|                                                                    |
|  Write down these 24 words in order and store them                 |
|  in a safe place. This is the ONLY way to recover                  |
|  your wallet if you lose access to this device.                    |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  1. apple     7. bridge   13. market   19. ocean             | |
|  |  2. banana    8. castle   14. needle   20. pencil            | |
|  |  3. cherry    9. donkey   15. orange   21. quartz            | |
|  |  4. dragon   10. eagle    16. parrot   22. river             | |
|  |  5. eleven   11. flower   17. queen    23. sunset            | |
|  |  6. forest   12. guitar   18. rabbit   24. tunnel            | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  [!] NEVER share these words with anyone.                          |
|  [!] BZE Hub will NEVER ask for your recovery phrase               |
|      except during wallet import.                                  |
|  [!] Anyone with these words can steal your funds.                 |
|                                                                    |
|  [ ] I have written down my recovery phrase and                    |
|      stored it in a safe place.                                    |
|                                                                    |
|  [ Continue ] (disabled until checkbox is checked)                 |
+-------------------------------------------------------------------+
```

### Step 4b: Confirm Recovery Phrase (Create flow only)

To verify the user actually backed up the phrase, ask them to confirm 4 random words:

```
+-------------------------------------------------------------------+
|  Confirm Your Recovery Phrase                                      |
|                                                                    |
|  Enter the following words from your recovery phrase:              |
|                                                                    |
|  Word #3:   [ cherry     ]  ✓                                     |
|  Word #11:  [ flower     ]  ✓                                     |
|  Word #17:  [            ]                                         |
|  Word #22:  [            ]                                         |
|                                                                    |
|  [ Back ]                    [ Confirm ]                           |
+-------------------------------------------------------------------+
```

- 4 words selected at **random non-sequential positions** (not words 1-4)
- Each field validates as the user types (green check or red X)
- "Confirm" enabled only when all 4 are correct
- "Back" returns to Step 4 to re-view the phrase

### Step 5: Trust This Device

```
+-------------------------------------------------------------------+
|  Device Trust                                                      |
|                                                                    |
|  Do you want BZE Hub to remember your wallet on                    |
|  this device?                                                      |
|                                                                    |
|  ( ) Remember me (recommended)                                     |
|      Your wallet name and public address are stored                |
|      locally. The app opens ready to use. Your                     |
|      recovery phrase stays encrypted in the keychain.              |
|      Signing still requires your password.                         |
|                                                                    |
|  ( ) Don't remember me                                             |
|      Nothing is stored in plaintext. You'll need to                |
|      enter your password every time you open the app               |
|      to see your wallet address. More secure if others             |
|      have access to this device.                                   |
|                                                                    |
|  [ Continue ]                                                      |
+-------------------------------------------------------------------+
```

**"Remember me" mode**: `settings.json` stores:
```json
{
    "trusted": true,
    "accounts": [
        { "name": "My BZE Wallet", "address": "bze1abc...def", "pubKeyHex": "02abc..." }
    ],
    "activeAddress": "bze1abc...def"
}
```
On app launch: address is visible immediately. Signing (and mnemonic access) still requires auth (Touch ID on macOS, password on Windows/Linux).

**"Don't remember me" mode**: `settings.json` stores:
```json
{
    "trusted": false
}
```
On app launch: auth prompt immediately (Touch ID on macOS, password on Windows/Linux). Unlock the keyring, derive the address, display it. More friction but nothing sensitive on disk.

### Step 6: Setup Complete

```
+-------------------------------------------------------------------+
|  You're All Set!                                                   |
|                                                                    |
|  Wallet: My BZE Wallet                                             |
|  Address: bze1abc...def                                            |
|                                                                    |
|  +-- Node Status ---+                                              |
|  | Syncing... 12%   |  (or "Ready" if download/init finished)     |
|  +------------------+                                              |
|                                                                    |
|  Your BZE node is syncing in the background.                       |
|  You can start using the apps right away — the Hub                 |
|  will use public endpoints until your node catches up.             |
|                                                                    |
|  [ Open BZE Hub ]                                                  |
+-------------------------------------------------------------------+
```

Clicking "Open BZE Hub" enters the main app with the app list / dashboard.

### Post-Setup: App List (Home Screen)

After setup (and on every subsequent launch), the Dashboard shows available apps:

```
+-------------------------------------------------------------------+
|  Dashboard                                                         |
|                                                                    |
|  +-- Your Apps -------------------------------------------------+ |
|  |                                                              | |
|  |  +----------+  +----------+  +----------+                   | |
|  |  |   DEX    |  |  Burner  |  | Staking  |                   | |
|  |  | (chart)  |  | (flame)  |  |  (lock)  |                   | |
|  |  | Trade    |  | Burn     |  | Stake &  |                   | |
|  |  | tokens   |  | tokens   |  | delegate |                   | |
|  |  +----------+  +----------+  +----------+                   | |
|  |                                                              | |
|  |  [ + Add App ]  (future: third-party dApps)                  | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +-- Node Status | Wallet | Settings (panels below) -----------+ |
+-------------------------------------------------------------------+
```

Clicking an app card opens it in a tab (iframe).

### What Happens If User Finishes Wallet Before Node Download?

The wallet setup steps (2-5) can complete before the node binary finishes downloading. This is fine:
- Step 6 shows "Syncing..." or "Downloading..." for the node status
- "Open BZE Hub" is always clickable — the proxy servers start immediately and route to public endpoints until the node is ready
- The user is never blocked

### What Happens If Node Download Fails?

- The progress bar shows an error: "Download failed. [ Retry ]"
- The wallet setup continues unaffected
- The user can finish setup and use the app with public endpoints
- Node download can be retried from the Dashboard later

## 10. Subsequent Launches

### Trusted Device

1. App opens -> `settings.json` has `trusted: true` and account data
2. Show main app immediately with address in tab bar
3. Start node in background (if auto-start enabled)
4. Start proxy servers (route to public endpoints until node syncs)
5. When user triggers a signing action:
   - **macOS**: Touch ID / system password prompt (Keychain access)
   - **Windows/Linux**: App password prompt

### Untrusted Device

1. App opens -> `settings.json` has `trusted: false`
2. Auth prompt:
   - **macOS**: Touch ID / system password (to access Keychain for address)
   - **Windows/Linux**: "Enter your password to unlock BZE Hub"
3. On success: unlock keyring, derive address, show main app
4. On failure (Windows/Linux): error message, retry. After 5 failed attempts: 60-second cooldown

### Creating Additional Accounts

After initial setup, users can create more accounts from the Dashboard wallet panel:
- "Create New Account" derives the next HD index from the **same mnemonic**
- The mnemonic is created once during first run and never regenerated
- Each new account gets a name, and its address + pubkey are stored in `settings.json` (if trusted)
- Derivation path: `m/44'/118'/0'/0/0`, `m/44'/118'/0'/0/1`, `m/44'/118'/0'/0/2`, etc.
- The user is NOT shown the mnemonic again (they already backed it up)
- They DO need to enter their password (keyring access to derive the key)
