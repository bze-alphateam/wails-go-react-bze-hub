# Epic 2 Plan: Keyring + Wallet

## Goal

Full wallet backend (keyring, BIP44 derivation, account management, signing) and first-run wizard + dashboard wallet panel. After this epic the app can create/import mnemonics, derive addresses, import PKs, export phrases, and switch accounts.

## Implementation Order

1. Go: `internal/config/` — paths, settings.json, accounts.json
2. Go: `internal/crypto/` — AES-256-GCM + Argon2id (Windows/Linux encryption)
3. Go: `internal/wallet/keyring.go` — platform-adaptive keyring abstraction
4. Go: `internal/wallet/derivation.go` — BIP44 + mnemonic generation
5. Go: `internal/wallet/wallet.go` — high-level orchestrator
6. Go: `internal/wallet/signing.go` — SignAmino + SignDirect
7. Go: `app.go` — Wails bindings for all wallet operations
8. Go: unit tests
9. React: wizard components (8 steps)
10. React: App.tsx flow (first-run detection, wizard/dashboard routing)
11. React: dashboard wallet panel (account list, import/export dialogs)

## New Go Dependencies

- `github.com/zalando/go-keyring` — OS keyring
- `github.com/cosmos/go-bip39` — BIP39 mnemonic
- `github.com/cosmos/cosmos-sdk` — crypto/hd, keys/secp256k1, types
- `golang.org/x/crypto` — argon2

## Key Design Decisions

- macOS: no app password (Keychain + Touch ID handles auth)
- Windows/Linux: app password required (AES-256-GCM + Argon2id encryption before keyring storage)
- Keyring stores mnemonics and PKs separately; app fetches only what each operation needs
- Multiple mnemonics supported, each labeled
- Signing not wired to bridge yet (that's Epic 4) — implemented and unit tested only
