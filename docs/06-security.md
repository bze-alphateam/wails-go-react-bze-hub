# Epic 06: Security

Signing approval flows, human-readable transaction decoding, OS keyring authentication, iframe sandboxing, third-party dApp permissions, and data isolation.

## 1. Security Architecture Overview

BZE Hub follows a defense-in-depth approach:

```
Layer 1: OS Keyring          - Secrets encrypted by OS, auth required for access
Layer 2: Approval UI         - Every signing request needs user confirmation
Layer 3: Origin Isolation    - Each dApp iframe has its own origin (via proxy)
Layer 4: Permission Model    - Third-party dApps require explicit permission grants
Layer 5: Message Validation  - Bridge messages validated and sanitized
```

### Trust Model

| Source | Trust Level | Notes |
|--------|------------|-------|
| Built-in dApps (DEX, Burner, Staking) | High | Controlled by BZE team. Still require signing approval. |
| Third-party dApps (future) | Low | Require explicit permissions. Sandboxed. |
| Local node | High | Runs locally, managed by the app |
| Public RPCs | Medium | Fallback only. Data is public anyway. |

## 2. Signing Approval Flow

### Every Signing Request Requires Approval

No transaction is signed without the user explicitly clicking "Approve". This applies to all dApps, including built-in ones.

### Approval Dialog

When a dApp calls `signAmino` or `signDirect`:

```
+-----------------------------------------------------+
|  Transaction Approval                           [X]  |
|                                                      |
|  dex.getbze.com wants to sign a transaction:         |
|                                                      |
|  +------------------------------------------------+  |
|  | Action: Create DEX Order                       |  |
|  |                                                |  |
|  | Details:                                       |  |
|  |   Market: BZE/USDT                            |  |
|  |   Side: Buy                                   |  |
|  |   Amount: 1000 BZE                            |  |
|  |   Price: 0.05 USDT                            |  |
|  |                                                |  |
|  | Fee: 0.025 BZE                                |  |
|  | Memo: (none)                                   |  |
|  +------------------------------------------------+  |
|                                                      |
|  Signer: bze1abc...def (Main Account)                |
|  Chain: beezee-1                                     |
|                                                      |
|  [  Reject  ]                    [  Approve  ]       |
|                                                      |
|  Auto-reject in 57s                                  |
+-----------------------------------------------------+
```

### Flow Sequence

```
dApp iframe
    | signAmino(chainId, signer, signDoc)
    v
Keplr Bridge (postMessage)
    |
    v
React Shell (message handler)
    |
    v
Go Backend (KeplrSignAmino)
    | 1. Decode transaction messages
    | 2. Build human-readable summary
    | 3. Emit "bridge:sign-request" event
    v
React Shell (ApprovalDialog component)
    | Show dialog to user
    | Wait for user action
    v
User clicks Approve / Reject
    |
    v
Go Backend
    | If approved: sign and return
    | If rejected: return error
    v
React Shell -> postMessage -> dApp iframe
```

### Auto-Reject Timeout

If the user doesn't respond within 60 seconds, the request is automatically rejected. This prevents stale signing requests from accumulating.

## 3. Human-Readable Message Decoding

### Message Type Mapping

Maintain a mapping of Cosmos SDK and BZE-specific message type URLs to human-readable descriptions:

Note: The `@bze/hub-connector` library (see 04-ui-shell.md) handles the postMessage bridge between iframe dApps and the shell. All signing requests flow through the shell's message handler, which forwards them to Go for approval.

```go
var messageTypeNames = map[string]string{
    // Standard Cosmos
    "/cosmos.bank.v1beta1.MsgSend":                     "Send Tokens",
    "/cosmos.staking.v1beta1.MsgDelegate":               "Delegate to Validator",
    "/cosmos.staking.v1beta1.MsgUndelegate":              "Undelegate from Validator",
    "/cosmos.staking.v1beta1.MsgBeginRedelegate":         "Redelegate Stake",
    "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward": "Claim Staking Rewards",
    "/cosmos.gov.v1beta1.MsgVote":                       "Vote on Proposal",
    "/cosmos.gov.v1.MsgVote":                            "Vote on Proposal",

    // IBC
    "/ibc.applications.transfer.v1.MsgTransfer":         "IBC Transfer",

    // BZE TradeBin (DEX)
    "/bze.tradebin.v1.MsgCreateOrder":                   "Create DEX Order",
    "/bze.tradebin.v1.MsgCancelOrder":                   "Cancel DEX Order",

    // BZE Burner
    "/bze.burner.v1.MsgFundBurner":                      "Burn Tokens",

    // BZE TokenFactory
    "/bze.tokenfactory.v1.MsgCreateDenom":               "Create Token",
    "/bze.tokenfactory.v1.MsgMint":                      "Mint Tokens",
    "/bze.tokenfactory.v1.MsgBurn":                      "Burn Custom Token",

    // BZE Rewards
    "/bze.rewards.v1.MsgCreateStakingReward":             "Create Staking Reward",
    "/bze.rewards.v1.MsgJoinStaking":                     "Join Staking Reward",
    "/bze.rewards.v1.MsgExitStaking":                     "Exit Staking Reward",
    "/bze.rewards.v1.MsgClaimStakingRewards":             "Claim Rewards",

    // BZE CoinTrunk
    "/bze.cointrunk.v1.MsgPublishArticle":               "Publish Article",
}
```

### Detail Extraction

For common message types, extract and display relevant fields:

```go
func summarizeMsgSend(msg json.RawMessage) string {
    var send struct {
        FromAddress string `json:"from_address"`
        ToAddress   string `json:"to_address"`
        Amount      []struct {
            Denom  string `json:"denom"`
            Amount string `json:"amount"`
        } `json:"amount"`
    }
    json.Unmarshal(msg, &send)

    return fmt.Sprintf("Send %s %s to %s",
        formatAmount(send.Amount[0].Amount, send.Amount[0].Denom),
        humanDenom(send.Amount[0].Denom),
        truncateAddress(send.ToAddress))
}

func summarizeCreateOrder(msg json.RawMessage) string {
    var order struct {
        MarketId  string `json:"market_id"`
        OrderType string `json:"order_type"`
        Amount    string `json:"amount"`
        Price     string `json:"price"`
    }
    json.Unmarshal(msg, &order)

    return fmt.Sprintf("%s Order: %s at price %s on market %s",
        order.OrderType, order.Amount, order.Price, order.MarketId)
}
```

### Unknown Message Types

For messages not in the mapping:
- Display the raw type URL (e.g., `/unknown.module.v1.MsgSomething`)
- Show a warning icon: "Unknown transaction type - review carefully"
- Still allow approval (the user may know what they're doing)

### Multi-Message Transactions

Some transactions contain multiple messages. Display each one:

```
Transaction contains 3 actions:
  1. Claim Staking Rewards
  2. Delegate to Validator (bzevaloper1...)
  3. Send 100 BZE to bze1xyz...
```

## 4. OS Keyring Security

### Authentication Requirements

| Action | OS Auth Required |
|--------|-----------------|
| App startup (unlock wallet) | Yes (first keyring access) |
| Sign transaction | No (keys already in memory after unlock) |
| View mnemonic | Yes (explicit keyring read) |
| Export private key | Yes (explicit keyring read) |
| Add new account | No (derives from in-memory mnemonic) |
| Delete account | No (but requires UI confirmation) |

### Platform Behavior

| OS | Keyring Backend | Auth Method |
|----|----------------|-------------|
| macOS | Keychain | Touch ID / system password |
| Windows | Credential Manager | Windows Hello / PIN / password |
| Linux | GNOME Keyring / KWallet | Unlock prompt (varies by DE) |

### Memory Security

```go
// Zero out sensitive data when no longer needed
func secureZero(b []byte) {
    for i := range b {
        b[i] = 0
    }
}

// Called on wallet lock and app shutdown
func (w *Wallet) cleanup() {
    if w.session != nil {
        w.session.Lock() // Zeros mnemonic and private keys
    }
}
```

### No Plaintext on Disk

At no point are mnemonics or private keys written to disk in plaintext:
- Keyring entries are encrypted by the OS
- In-memory keys are never serialized to log files
- Crash dumps should not contain key material (Go's garbage collector may retain it briefly; accept this limitation)

## 5. Webview Security

### Single Webview Model

BZE Hub uses a single Wails webview that navigates between dApp URLs (no iframes, no proxy). This simplifies the security model:

- Each dApp page runs in the webview with its own origin (the live URL origin)
- When navigating between dApps, the previous page is fully unloaded
- No cross-origin communication concerns between dApps
- localStorage, cookies, IndexedDB are per-origin (managed by the webview engine)

### Navigation Restrictions

The webview should only navigate to whitelisted URLs:

```go
var allowedOrigins = []string{
    "https://dex.getbze.com",
    "https://burner.getbze.com",
    "https://stake.getbze.com",
    "wails://localhost",  // Dashboard
}

func (a *App) isNavigationAllowed(url string) bool {
    for _, origin := range allowedOrigins {
        if strings.HasPrefix(url, origin) {
            return true
        }
    }
    // Third-party apps check against permissions.json
    return a.hasPermission(url)
}
```

### Injected Code Isolation

The `window.keplr` bridge and UI elements (tab bar, status bar, approval dialog) are injected via the webview's native script injection API. They:
- Run before the page's own JavaScript
- Cannot be overridden by page scripts (if injected at document creation time)
- Use high z-index and inline styles to prevent visual interference

## 6. Third-Party dApp Permissions (Future)

### Permission Types

```go
type Permission string

const (
    PermConnect      Permission = "connect"      // Can call enable() and getKey()
    PermSign         Permission = "sign"          // Can request transaction signing
    PermSuggestChain Permission = "suggestChain"  // Can call experimentalSuggestChain
)
```

### Permission Grant Flow

When a new (non-built-in) dApp is loaded:

1. The first `window.keplr.enable(chainId)` call triggers a permission dialog
2. Dialog shows: "**example.com** wants to connect to your BZE wallet. Allow?"
3. User can grant or deny
4. If granted, store permission in `{appdata}/config/permissions.json`
5. Future requests from the same origin skip the permission dialog

### Permission Storage

```json
{
    "permissions": {
        "dex.getbze.com": {
            "connect": true,
            "sign": true,
            "suggestChain": true,
            "grantedAt": "2026-03-29T12:00:00Z"
        },
        "example-third-party.com": {
            "connect": true,
            "sign": true,
            "suggestChain": false,
            "grantedAt": "2026-03-29T14:00:00Z"
        }
    }
}
```

### Built-In dApps

Built-in dApps (DEX, Burner, Staking) have all permissions pre-granted. They still require signing approval for each transaction.

### Permission Revocation

In the Dashboard > Security section:
- List all dApps with granted permissions
- Toggle individual permissions on/off
- "Revoke All" button per dApp
- Clear all permissions button

## 7. Data Isolation

### Between dApp Pages

Since BZE Hub uses a single webview with navigation (no iframes):
- Each dApp runs at its own origin (e.g., `https://dex.getbze.com`)
- localStorage, cookies, IndexedDB, sessionStorage are per-origin (webview engine default)
- When navigating away from a dApp, its JavaScript context is fully unloaded
- No two dApps run simultaneously, so there's no cross-dApp communication risk

### Between dApps and Dashboard

- The Dashboard runs at `wails://localhost` (embedded Wails frontend)
- dApps run at their live URLs (different origins)
- No shared storage between Dashboard and dApps
- The only bridge is `window.keplr` (injected by Wails) which calls Go backend

### Bridge Message Validation

```go
func (b *KeplrBridge) validateRequest(req BridgeRequest) error {
    // 1. Check method is in allowed list
    allowedMethods := []string{"enable", "getKey", "signAmino", "signDirect", "suggestChain", "signArbitrary"}
    if !contains(allowedMethods, req.Method) {
        return fmt.Errorf("unknown method: %s", req.Method)
    }

    // 2. Validate chain ID
    if req.ChainID != "" && req.ChainID != b.currentChainID {
        return fmt.Errorf("chain ID mismatch: expected %s, got %s", b.currentChainID, req.ChainID)
    }

    // 3. Validate signer address (if provided)
    if req.Signer != "" {
        if _, err := sdk.AccAddressFromBech32(req.Signer); err != nil {
            return fmt.Errorf("invalid signer address: %s", req.Signer)
        }
    }

    return nil
}
```

## 8. Binary Integrity

### Downloaded Binary Verification

- SHA256 checksum verification against GitHub release checksums (see 05-auto-updater.md)
- If checksums file is not available: warn user but allow proceeding

### Application Code Signing (Build Time)

| Platform | Signing Method |
|----------|---------------|
| macOS | Developer ID + Notarization (`codesign` + `xcrun notarytool`) |
| Windows | Authenticode signing (requires code signing certificate) |
| Linux | No standard mechanism (AppImage can be verified via SHA256) |

Code signing is configured in the CI/CD pipeline (see 08-build-distribution.md).

## 9. Threat Model

### Threats and Mitigations

| Threat | Severity | Mitigation |
|--------|----------|------------|
| Malicious dApp requests signing | High | Approval dialog with human-readable details |
| Keyring access by malware | Medium | OS-level auth (Touch ID, etc.) |
| Man-in-the-middle on dApp URLs | Medium | HTTPS for live URLs, local proxy |
| Malicious binary download | High | SHA256 checksum verification |
| Memory dump exposing keys | Low | Zero keys on lock; accept OS-level risk |
| Malicious dApp navigates webview | Low | Navigation whitelist, only approved URLs allowed |
| Cross-dApp data theft | Low | Single webview model - only one dApp loaded at a time, each at own origin |
| Social engineering via fake approval | Medium | Show origin, message details, auto-reject timeout |
| Secret leakage via logs | Medium | Strict log sanitization rules, default level `error`, debug never logs secrets |

### Logging Security

Log files are a common vector for accidental secret exposure. BZE Hub enforces strict rules (see 07-configuration.md for full logging details):

**Never logged at ANY level:**
- Mnemonics, private keys, wallet passwords
- Keyring contents or decrypted data
- Full sign doc payloads (only message type URLs like `/cosmos.bank.v1beta1.MsgSend`)
- Full HTTP response bodies from the proxy
- localStorage contents from iframes

**Default level is `error`** — minimal output. Users enable `debug` only when troubleshooting, and debug logs are safe to share (contain addresses and request metadata, never secrets).

**Code review rule**: Any `log.Debug()` or `log.Info()` call that touches wallet, keyring, bridge, or signing code paths must be reviewed for secret leakage. Add this to the PR review checklist.

### Out of Scope

- Hardware security module (HSM) integration (future: Ledger support)
- Encrypted memory regions (requires OS-specific APIs, diminishing returns)
- Anti-debugging / anti-tampering (desktop apps are user-controlled)

## 10. Audit Checklist

Before each release, verify:

- [ ] No private keys or mnemonics in log files at any log level
- [ ] Grep codebase for `log.Debug`, `log.Info` in wallet/keyring/bridge paths — verify no secrets
- [ ] Set log level to `debug`, run full app flow, inspect `app.log` for leaked secrets
- [ ] Keyring access requires OS authentication (Touch ID on macOS, password on Windows/Linux)
- [ ] All signing requests show approval dialog
- [ ] Unknown message types display warning
- [ ] Third-party dApp origins are sandboxed
- [ ] Binary downloads are checksum-verified
- [ ] Auto-reject timeout works on approval dialog
- [ ] Keys are zeroed on wallet lock and app exit
- [ ] Bridge messages are validated before processing
- [ ] No sensitive data in crash reports
- [ ] Log rotation works (files don't grow unbounded)
