# Epic 4c Plan: Bridge Integration + Signing

## Goal

Wire everything together: the shell handles postMessage from hub-connector in iframes, routes signing requests to the Go backend, shows approval dialogs, and manages account/endpoint synchronization across dApp tabs.

## Context

- Epic 4a: dApps load in iframes ✅
- Epic 4b: hub-connector library built ✅
- Epic 4c: connect them — shell mediates between iframe connector and Go wallet

## What the Shell Does

### 1. postMessage Handler (React)

Listen for messages from iframes:

- **Handshake**: respond with config (chainId, proxy ports, storage key version)
- **Bridge requests**: forward to Go via Wails bindings, return result to iframe
  - `enable` → `App.KeplrEnable(chainId)`
  - `getKey` → `App.KeplrGetKey(chainId)`
  - `signAmino` → triggers approval dialog → if approved → `App.KeplrSignAmino(chainId, signer, signDoc)`
  - `signDirect` → same flow with `App.KeplrSignDirect`
  - `suggestChain` → `App.KeplrSuggestChain(chainInfo)` (intercepts to set proxy endpoints)
  - `signArbitrary` → `App.KeplrSignArbitrary(chainId, signer, data)`

### 2. Approval Dialog (React)

When a signing request comes in:
- Show overlay dialog above everything (including iframes)
- Display: requesting dApp origin, transaction type (human-readable), fee, signer address
- Buttons: Approve / Reject
- Auto-reject after 60 seconds
- Result sent back to iframe via postMessage

### 3. Go Keplr Bridge Methods

New Wails-bound methods on App:
- `KeplrEnable(chainId)` — verify chain ID, return success
- `KeplrGetKey(chainId)` — return active account's Key struct (name, pubKey, address, algo)
- `KeplrSignAmino(chainId, signer, signDocJSON)` — sign using the PK from keyring
- `KeplrSignDirect(chainId, signer, signDocJSON)` — same for direct signing
- `KeplrSuggestChain(chainInfoJSON)` — override endpoints with proxy URLs
- `KeplrSignArbitrary(chainId, signer, data)` — off-chain signing (ADR-036)

These methods use the existing `wallet.SignAminoTx()` and `wallet.SignDirectTx()` from Epic 2.

### 4. Account Switching → iframe Notification

When user switches account in the wallet dropdown:
- Shell posts `{ type: "bze-hub:account-changed" }` to all iframes
- Hub-connector dispatches `keplr_keystorechange`
- dApp's @interchain-kit re-queries `window.keplr.getKey()` and gets the new account

### 5. dApp Integration

Each BZE dApp needs:
- `npm install @bze/hub-connector`
- Call `initHubConnector()` in entry point
- `X-Frame-Options: ALLOWALL` header (from Epic 4a)

When in Hub: dApp auto-connects to Hub wallet, no Keplr/Leap selection modal shown.

### 6. Message Type Decoding

For the approval dialog, decode Cosmos message type URLs to human-readable names:
- `/cosmos.bank.v1beta1.MsgSend` → "Send Tokens"
- `/bze.tradebin.v1.MsgCreateOrder` → "Create DEX Order"
- etc. (mapping already defined in 06-security.md)

## Deliverables

### Go Backend
- `app.go` — KeplrEnable, KeplrGetKey, KeplrSignAmino, KeplrSignDirect, KeplrSuggestChain, KeplrSignArbitrary bindings
- Message type → human-readable mapping

### React Frontend
- `hooks/useBridgeHandler.ts` — postMessage listener, request routing to Go
- `components/ApprovalDialog.tsx` — signing approval overlay
- `App.tsx` — integrate bridge handler, pass approval state
- Account switch → notify all iframes

### dApp Changes (in dex/burner/staking repos)
- Install hub-connector
- Call `initHubConnector()`
- Add X-Frame-Options header
- When `isInHub()` is true:
  - Auto-connect to Hub wallet (no wallet selection modal)
  - Hide the "Other" button (wallet selection / external wallet options)
  - The Hub IS the wallet — remove all complexity from the user
  - Force REST/RPC endpoints to the Hub proxy addresses on localhost (not editable by the user)
  - Disable the endpoint fields in the Settings sidebar — the Hub manages endpoints

## Verification

1. Open DEX tab → dApp loads → hub-connector handshakes → wallet auto-connects
2. dApp shows user's BZE address (from Hub wallet)
3. User initiates a trade → approval dialog appears in Hub shell
4. User approves → transaction signed and broadcast
5. User rejects → dApp gets error
6. Switch account in Hub dropdown → dApp updates to new address
7. Burner and Staking tabs work the same way
8. Signing works via local node when synced, via public when not (proxy handles this transparently)
