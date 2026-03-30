# Epic 2 Complete: Keyring + Wallet

## What Was Done

Implemented the full wallet backend and first-run wizard UI. The app can now create/import mnemonics, derive BZE addresses, store secrets in the OS keyring, and manage multiple accounts.

## Go Backend

### internal/config/
| File | Purpose |
|------|---------|
| `paths.go` | Platform-specific app data dirs (macOS, Windows, Linux). Creates config/, logs/, bin/, node/ subdirs. |
| `settings.go` | `AppSettings` struct with normal + developer mode fields. Load/save from `settings.json`. Forward-compatible (unmarshals into defaults). |
| `accounts.go` | `AccountStore` with `MnemonicRef[]` + `Account[]` + active address. Full CRUD operations. `NextIndex()` for HD derivation tracking. |

### internal/crypto/
| File | Purpose |
|------|---------|
| `encryption.go` | AES-256-GCM + Argon2id encrypt/decrypt for Windows/Linux keyring entries. `SecureZero()` helper. |

### internal/wallet/
| File | Purpose |
|------|---------|
| `keyring.go` | Platform-adaptive keyring: direct on macOS (Keychain handles auth), encrypted on Windows/Linux. `StoreSecret()`, `GetSecret()`, `DeleteSecret()` with `MnemonicKey()` and `PKKey()` helpers. |
| `derivation.go` | BIP44 derivation at `m/44'/118'/0'/0/N` with `bze` bech32 prefix. `GenerateMnemonic()` (24 words), `ValidateMnemonic()` (12 or 24), `DeriveKey()`, `AddressFromPrivKey()`. Sets cosmos-sdk bech32 config on init. |
| `signing.go` | `SignAmino()` and `SignDirect()` with canonical JSON sorting. Returns Keplr-compatible response structs (`AminoSignResponse`, `DirectSignResponse`). |
| `wallet.go` | High-level orchestrator: `GenerateNewWallet()`, `ImportMnemonic()`, `ImportPrivateKey()`, `DeriveNewAddress()`, `ExportMnemonic()`, `SignAminoTx()`, `SignDirectTx()`, `DeleteAccount()`. Minimal keyring access (PK for signing, mnemonic for derive/export). `GetRandomVerificationIndices()` and `VerifyMnemonicWords()` for wizard. |

### app.go (Wails Bindings)
- `IsFirstRun()`, `NeedsPassword()` — startup detection
- `GenerateNewWallet()`, `GetVerificationIndices()`, `VerifyMnemonicWords()`, `CompleteSetup()` — wizard flow
- `ImportMnemonic()`, `ImportPrivateKey()`, `DeriveNewAddress()`, `ExportMnemonic()` — wallet operations
- `DeleteAccount()`, `RenameAccount()`, `SwitchAccount()`, `GetAccounts()` — account management
- `Unlock()` — password verification for Windows/Linux
- `GetSettings()`, `GetVersion()` — settings and version

### Tests (10 passing)
- `internal/crypto/` — encrypt/decrypt round-trip, wrong password rejection, different ciphertexts per encryption, secure zero
- `internal/wallet/` — mnemonic generation (24 words), validation (empty, too few, invalid, valid 12), key derivation (address prefix, HD path, different indices), address-from-privkey round-trip, deterministic derivation, word verification

## React Frontend

### Wizard Components (`frontend/src/components/wizard/`)
| Component | Purpose |
|-----------|---------|
| `WizardLayout.tsx` | Step indicator with numbered circles, centered content area, version footer |
| `StepWelcome.tsx` | Hero with "Welcome to BZE Hub" + Get Started button |
| `StepChoice.tsx` | Two cards: "Create new" vs "Import existing" |
| `StepCreate.tsx` | Name field + password fields (Win/Linux only). Validation (min 8 chars, match). macOS shows Keychain info. |
| `StepImport.tsx` | Name + password + mnemonic textarea. Word count validation (12 or 24). |
| `StepShowPhrase.tsx` | 4-column grid of 24 words. Red security warnings. Checkbox acknowledgment required. |
| `StepVerifyPhrase.tsx` | 4 random word inputs. Error message on incorrect. Back button to re-view. |
| `StepTrust.tsx` | Two cards: "Remember me" (recommended) vs "Don't remember me" with descriptions. |
| `StepComplete.tsx` | Success checkmark, wallet name + truncated address, "Open BZE Hub" button. |
| `Wizard.tsx` | State machine orchestrating all steps. Calls Go bindings. Handles loading/error states. |

### App.tsx
Routes between three views: `loading` → `wizard` (if first run) → `main` (shell with tabs). Loads accounts and shows active wallet in tab bar.

### TabBar.tsx
Updated to show active account label + truncated address on the right side.

## Dependencies Added (go.mod)
- `github.com/zalando/go-keyring v0.2.8` — OS keyring
- `github.com/cosmos/go-bip39 v1.0.0` — BIP39 mnemonic
- `github.com/cosmos/cosmos-sdk v0.50.15` — crypto/hd, keys/secp256k1, types
- `golang.org/x/crypto v0.49.0` — argon2

## Design Decisions

1. **Mnemonics and PKs stored separately in keyring** — signing only fetches PK, never touches mnemonic. Minimizes exposure window.
2. **Platform-adaptive auth** — macOS: no app password (Keychain + Touch ID). Windows/Linux: AES-256-GCM + Argon2id encrypted entries.
3. **Multiple mnemonics** — each labeled, stored independently. Import adds alongside, never replaces.
4. **Secrets zeroed after use** — `crypto.SecureZero()` on all byte slices containing keys/mnemonics.
5. **Verification flow** — 4 random word positions (not sequential) to prove user backed up phrase.
6. **Dashboard placeholder** — shows wallet name + address. Full wallet panel with import/export dialogs deferred to refinement.

## Data Files Created on First Run

```
~/Library/Application Support/bze-hub/
  config/
    settings.json    — { trusted: true/false, autoStartNode: true, ... }
    accounts.json    — { mnemonics: [...], accounts: [...], activeAddress: "bze1..." }
  logs/
  bin/
  node/
```

macOS Keychain entries:
```
bze-hub / mnemonic:{label}    — 24-word phrase
bze-hub / pk:{bze1address}    — hex-encoded secp256k1 private key
```

## How to Run

```bash
cd bze-hub
PATH="/Users/stefan.balea/sdk/go1.25.3/bin:$PATH" ~/go/bin/wails build
open "build/bin/BZE Hub.app"
```

To test with fresh state: `rm -rf ~/Library/Application\ Support/bze-hub/`

## What's Next (Epic 3)

Node manager + proxy + background state:
- `internal/state/` — AppState with RWMutex, observable via Wails events
- `internal/node/` — binary download, init, state sync, health monitor, crash recovery
- `internal/proxy/` — REST/RPC reverse proxies with circuit breaker
- Routine tracking with graceful shutdown
- Top bar: node status indicator (local/public) + background activity text
