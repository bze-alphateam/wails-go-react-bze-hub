# 06: Security

Signing approval, human-readable transaction decoding, OS keyring authentication, and secret-handling hygiene.

> **Direction note:** BZE Hub no longer embeds web dApps in iframes and has no `window.keplr` postMessage bridge. The security layers that existed only to isolate/validate untrusted embedded web content (origin isolation, bridge message validation, third-party dApp permission model, `experimentalSuggestChain` handling) are **obsolete** and have been removed from this doc. dApp UI is native React talking to the Go backend through Wails bindings. The native signing-approval UI is still being designed (the old bridge-driven `ApprovalDialog` was removed) — sections marked _TBD_ will firm up as it lands.

## 1. Security Architecture Overview

BZE Hub follows a defense-in-depth approach:

```
Layer 1: OS Keyring     - Secrets encrypted by OS, auth required for access
Layer 2: Approval UI    - Every signing request needs explicit user confirmation
Layer 3: Thin frontend  - No secrets in React; all signing/keys live in Go
Layer 4: Log hygiene    - Wallet/keyring/signing paths never log secrets
```

### Trust Model

| Source | Trust Level | Notes |
|--------|------------|-------|
| Native dApp UI (Dashboard, Staking, future DEX/Burner) | High | First-party React, shipped with the app. Still require signing approval. |
| Local node | High | Runs locally, managed by the app |
| Public RPCs | Medium | Fallback only. Data is public anyway. |

Because the UI is entirely first-party native code (no untrusted embedded web content), there is no cross-origin attack surface inside the app. The main trust boundary is the user explicitly approving each signature.

## 2. Signing Approval Flow

### Every Signing Request Requires Approval

No transaction is signed without the user explicitly approving it. This applies to all native dApp features.

> _TBD:_ A native approval dialog needs to be (re)introduced. The previous `ApprovalDialog` was bridge-driven and was removed with the iframe shell; native staking currently signs without an interactive confirmation step. Re-add a native approval step before shipping signing-heavy features.

### Approval Dialog (target shape)

When a native feature requests a signature, the user should see a decoded summary before approving:

```
+-----------------------------------------------------+
|  Approve Transaction                            [X]  |
|                                                      |
|  Action: Create DEX Order                            |
|    Market: BZE/USDT                                  |
|    Side:   Buy                                       |
|    Amount: 1000 BZE                                  |
|    Price:  0.05 USDT                                 |
|                                                      |
|  Fee: 0.025 BZE     Memo: (none)                     |
|  Signer: bze1abc...def (Main Account)                |
|  Chain:  beezee-1                                    |
|                                                      |
|  [  Reject  ]                    [  Approve  ]       |
|  Auto-reject in 57s                                  |
+-----------------------------------------------------+
```

### Flow Sequence (native)

```
Native page (React)
    | user action -> build sign doc
    v
Go binding: SignAmino(chainId, signer, signDocJSON)
    | 1. Decode transaction messages
    | 2. Build human-readable summary
    | 3. Show approval to user, wait for decision
    v
User clicks Approve / Reject
    | If approved: sign with key from keyring, return signed tx
    | If rejected: return error
    v
Native page broadcasts via Go (BroadcastTx)
```

### Auto-Reject Timeout

If the user doesn't respond within ~60 seconds, the request should auto-reject so stale signing prompts don't linger.

## 3. Human-Readable Message Decoding

Maintain a mapping of Cosmos SDK and BZE-specific message type URLs to human-readable descriptions so the approval UI can summarize what is being signed. (The native UI owns this decoding; there is no bridge in between.)

```go
var messageTypeNames = map[string]string{
    // Standard Cosmos
    "/cosmos.bank.v1beta1.MsgSend":                            "Send Tokens",
    "/cosmos.staking.v1beta1.MsgDelegate":                     "Delegate to Validator",
    "/cosmos.staking.v1beta1.MsgUndelegate":                   "Undelegate from Validator",
    "/cosmos.staking.v1beta1.MsgBeginRedelegate":              "Redelegate Stake",
    "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward": "Claim Staking Rewards",
    "/cosmos.gov.v1beta1.MsgVote":                             "Vote on Proposal",
    "/cosmos.gov.v1.MsgVote":                                  "Vote on Proposal",

    // IBC
    "/ibc.applications.transfer.v1.MsgTransfer":               "IBC Transfer",

    // BZE-specific
    "/bze.tradebin.v1.MsgCreateOrder":                         "Create DEX Order",
    "/bze.tradebin.v1.MsgCancelOrder":                         "Cancel DEX Order",
    "/bze.burner.v1.MsgFundBurner":                            "Fund Burner",
    "/bze.rewards.v1.MsgCreateStakingReward":                  "Create Staking Reward",
    "/bze.rewards.v1.MsgJoinStaking":                          "Join Staking Reward",
    "/bze.tokenfactory.v1.MsgCreateDenom":                     "Create Token",
}
```

## 4. OS Keyring Authentication

### Platform-Specific Behavior

macOS:
- Keychain stores secrets. Touch ID / password required for access.
- Each secret access can trigger a biometric prompt (configurable).

Windows:
- Credential Manager stores secrets, encrypted with the user's login credentials.
- Password prompt on app startup (no per-access auth like macOS).

Linux:
- Secret Service (GNOME Keyring / KWallet) stores secrets.
- Password prompt on startup.

### Untrusted Device Handling

On Windows/Linux, the app prompts for a password on startup. This password:
- Encrypts the mnemonic/keys in addition to the OS keyring
- Is held in memory only for the session
- Is never written to disk

## 5. Wallet Security (recap from 03-wallet.md)

- Mnemonics stored in OS keyring, never in plaintext files
- Private keys derived on-demand, used for signing, then discarded from memory
- Export requires re-authentication
- All signing requires explicit user approval

## 6. Secret Handling & Log Hygiene

Secrets must never reach logs or the frontend.

- The React frontend holds no mnemonics, private keys, or session passwords — keys live only in Go and the OS keyring.
- Never log mnemonics, private keys, the session password, or raw signed key material.
- Redact addresses only where necessary; addresses themselves are public.

**Code review rule**: Any `log.Debug()` or `log.Info()` call that touches wallet, keyring, or signing code paths must be reviewed for secret leakage. Keep this on the PR review checklist.

## 7. Security Checklist

- [ ] Every signing path requires explicit user approval before signing
- [ ] No secrets (mnemonic, private key, session password) are ever logged
- [ ] Grep codebase for `log.Debug` / `log.Info` in wallet/keyring/signing paths — verify no secrets
- [ ] Frontend holds no secrets; keys never cross the Wails boundary except as signatures
- [ ] Mnemonic/key export requires re-authentication
- [ ] Keyring access uses OS-native auth (Touch ID / Windows Hello / system password)
