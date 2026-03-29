# Epic 03: Wallet

OS keyring integration, BIP44 key derivation, account management, mnemonic lifecycle, import/export, and transaction signing.

## 1. Overview

The Hub wallet is a **key manager and signer**. It does NOT replicate full wallet functionality — balances, transaction history, staking, trading, and all other wallet features are handled by the dApps (DEX, Burner, Staking) running in iframes.

### What the Hub Wallet Does

- **Key storage** in the OS-native keyring — mnemonics and private keys stored separately
- **Multiple mnemonics** — user can generate and import multiple mnemonics, each labeled
- **Import private key** — standalone PK import for users who don't have a mnemonic
- **BIP44 HD derivation** for generating addresses from any stored mnemonic
- **Transaction signing** (SignDirect and SignAmino) with user approval — only fetches the PK needed for that signature
- **Account switching** reflected across all dApp tabs instantly
- **Export mnemonic** (reveal with auth, copy to clipboard)

### Purpose

The app provides a better desktop solution for wallet management and navigating the BZE ecosystem, while lowering the load on public endpoints. Using local endpoints achieves higher speed.

### What the dApps Handle

Everything else:
- Balances and token lists
- Transaction history
- Staking / delegation / rewards
- Trading (DEX orders, AMM)
- Token burning and raffles
- IBC transfers
- Address book, contacts

The wallet never exposes private keys to the frontend. All cryptographic operations happen in the Go backend.

## 2. OS Keyring Integration

### Library Choice

Primary: `github.com/zalando/go-keyring`
- Simple API: `Set(service, user, password)`, `Get(service, user)`, `Delete(service, user)`
- macOS: Keychain, Windows: Credential Manager, Linux: Secret Service (GNOME Keyring / KWallet)

Alternative: `github.com/99designs/keyring` (more backends, including file-based fallback)

### Service Name

```go
const keyringService = "bze-hub"
```

### What Gets Stored in Keyring

The keyring stores **two types of secrets**, separately:

| Keyring Key | Value | When Accessed |
|-------------|-------|---------------|
| `bze-hub:mnemonic:{label}` | Encrypted mnemonic (12 or 24 words) | Only for: export mnemonic, derive new address |
| `bze-hub:pk:{bze1address}` | Encrypted private key (secp256k1) | Only for: signing transactions |

**Key principle**: The app accesses only what it needs per operation.
- **Signing a transaction** → fetches only the PK for the signing address. Never touches the mnemonic.
- **Deriving a new address** → fetches only the mnemonic it's deriving from. Stores the new PK separately.
- **Exporting a mnemonic** → fetches only that mnemonic.

This minimizes keyring access and reduces the window where sensitive data is in memory.

### Encryption Layer (Platform-Adaptive)

The protection model depends on the OS because keyring implementations vary significantly:

| OS | OS Keyring Behavior | App Password | Protection Model |
|----|-------------------|-------------|-----------------|
| **macOS** | Keychain can require Touch ID / system password **per access** via `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` + biometric access control | **Not needed** | OS handles auth natively. Mnemonic stored directly in Keychain. Every access triggers Touch ID or system password prompt. |
| **Windows** | Credential Manager uses DPAPI - encrypted per-user, but any process running as the user can read items **silently** with no prompt | **Required** | Mnemonic encrypted with app password (AES-256-GCM + Argon2id) before storing in Credential Manager. |
| **Linux** | GNOME Keyring / KWallet unlocks at login and stays open for the session. Any user-space process can read items. | **Required** | Same as Windows - mnemonic encrypted with app password before storing in Secret Service. |

```go
func NeedsAppPassword() bool {
    return runtime.GOOS != "darwin"
}
```

**macOS**: The mnemonic is stored in Keychain as-is (Keychain encrypts at rest). Access control flags ensure the OS prompts for Touch ID or password on every read. No application password needed.

**Windows/Linux**: The mnemonic is encrypted with the user's wallet password (AES-256-GCM, Argon2id key derivation) before being stored. The OS keyring provides storage but not meaningful per-access protection, so the app password is the real security boundary.

See section 5 (Mnemonic Lifecycle > Storage) for the encryption implementation.

### Fallback for Headless Linux

If the OS keyring daemon is not available (headless Linux, WSL):
- Detect by attempting a keyring write and catching the error
- Fall back to encrypted file-based storage at `{appdata}/config/keyring-encrypted`
- Require a password on every app launch in this mode
- Warn the user that OS keyring is preferred

## 3. BIP44 Key Derivation

### Constants

```go
const (
    BIP44CoinType = 118        // Standard Cosmos coin type
    Bech32Prefix  = "bze"      // BZE address prefix
    KeyAlgorithm  = "secp256k1"
    MnemonicBits  = 256        // 24 words
)
```

### Derivation Path

```
m/44'/118'/0'/0/{index}
```

Where `index` starts at 0 and increments for each new account.

### Key Generation Flow

```go
import (
    "github.com/cosmos/go-bip39"
    "github.com/cosmos/cosmos-sdk/crypto/hd"
    "github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
    sdk "github.com/cosmos/cosmos-sdk/types"
)

func GenerateNewWallet() (string, error) {
    // Generate 24-word mnemonic
    entropy, _ := bip39.NewEntropy(256)
    mnemonic, _ := bip39.NewMnemonic(entropy)
    return mnemonic, nil
}

func DeriveKey(mnemonic string, index uint32) (*DerivedKey, error) {
    // Derive seed from mnemonic
    seed := bip39.NewSeed(mnemonic, "") // No passphrase

    // Derive private key using BIP44 path
    hdPath := hd.CreateHDPath(118, 0, index)
    masterKey, chainCode := hd.ComputeMastersFromSeed(seed)
    privKeyBytes, _ := hd.DerivePrivateKeyForPath(masterKey, chainCode, hdPath.String())

    // Create secp256k1 private key
    privKey := &secp256k1.PrivKey{Key: privKeyBytes}
    pubKey := privKey.PubKey()

    // Compute bech32 address
    address := sdk.AccAddress(pubKey.Address()).String() // bze1...

    return &DerivedKey{
        PrivKey:       privKey,
        PubKey:        pubKey,
        Bech32Address: address,
        HDPath:        hdPath.String(),
        Index:         index,
    }, nil
}
```

### Bech32 Prefix Configuration

Set the global prefix on app startup:

```go
func init() {
    config := sdk.GetConfig()
    config.SetBech32PrefixForAccount("bze", "bzepub")
    config.SetBech32PrefixForValidator("bzevaloper", "bzevaloperpub")
    config.SetBech32PrefixForConsensusNode("bzevalcons", "bzevalconspub")
    config.Seal()
}
```

## 4. Account Management

### Data Models

```go
// Stored in {appdata}/config/accounts.json — no secrets, only metadata
type AccountStore struct {
    Mnemonics     []MnemonicRef `json:"mnemonics"`
    Accounts      []Account     `json:"accounts"`
    ActiveAddress string        `json:"activeAddress"`
}

// Reference to a mnemonic stored in keyring (not the mnemonic itself)
type MnemonicRef struct {
    Label     string `json:"label"`     // User-assigned label (e.g., "My Main Wallet")
    CreatedAt string `json:"createdAt"` // ISO 8601
}

// An address derived from a mnemonic or imported as a standalone PK
type Account struct {
    Label         string `json:"label"`         // User-friendly label
    Bech32Address string `json:"bech32Address"` // bze1...
    PubKeyHex     string `json:"pubKeyHex"`     // Hex-encoded compressed pubkey
    HDPath        string `json:"hdPath"`        // e.g., "m/44'/118'/0'/0/0" (empty for imported PK)
    AccountIndex  uint32 `json:"accountIndex"`  // HD index (0 for imported PK)
    MnemonicLabel string `json:"mnemonicLabel"` // Which mnemonic this was derived from ("" for imported PK)
    IsImportedPK  bool   `json:"isImportedPK"`  // True if this is a standalone imported private key
    CreatedAt     string `json:"createdAt"`
}
```

### Account Storage Example

```json
{
    "mnemonics": [
        { "label": "My Main Wallet", "createdAt": "2026-03-29T12:00:00Z" },
        { "label": "Hardware Backup", "createdAt": "2026-03-30T10:00:00Z" }
    ],
    "accounts": [
        {
            "label": "My Main Wallet",
            "bech32Address": "bze1abc...",
            "pubKeyHex": "02abc...",
            "hdPath": "m/44'/118'/0'/0/0",
            "accountIndex": 0,
            "mnemonicLabel": "My Main Wallet",
            "isImportedPK": false,
            "createdAt": "2026-03-29T12:00:00Z"
        },
        {
            "label": "Trading",
            "bech32Address": "bze1xyz...",
            "pubKeyHex": "03def...",
            "hdPath": "m/44'/118'/0'/0/1",
            "accountIndex": 1,
            "mnemonicLabel": "My Main Wallet",
            "isImportedPK": false,
            "createdAt": "2026-03-29T14:00:00Z"
        },
        {
            "label": "Old Wallet",
            "bech32Address": "bze1qrs...",
            "pubKeyHex": "02fed...",
            "hdPath": "",
            "accountIndex": 0,
            "mnemonicLabel": "",
            "isImportedPK": true,
            "createdAt": "2026-03-30T11:00:00Z"
        }
    ],
    "activeAddress": "bze1abc..."
}
```

In this example:
- "My Main Wallet" mnemonic has 2 derived addresses (index 0 and 1)
- "Hardware Backup" mnemonic exists but has no derived addresses yet (user imported it for safekeeping)
- "Old Wallet" is a standalone imported private key (no mnemonic)

### Operations

**Generate Mnemonic** (first run or manual):
1. Generate 24-word BIP39 mnemonic
2. User provides a label (e.g., "My Main Wallet")
3. Show mnemonic, require backup confirmation (4 random words)
4. Store mnemonic in keyring under `bze-hub:mnemonic:{label}`
5. Derive first address (index 0) with the same label
6. Store PK in keyring under `bze-hub:pk:{bze1address}`
7. Add mnemonic ref and account to `accounts.json`

**Import Mnemonic** (adds alongside existing ones, does NOT replace):
1. User provides a label and the 12/24-word mnemonic
2. Validate against BIP39 word list
3. Store mnemonic in keyring under `bze-hub:mnemonic:{label}`
4. Derive first address (index 0) with the same label
5. Store PK in keyring under `bze-hub:pk:{bze1address}`
6. Add mnemonic ref and account to `accounts.json`
7. Show derived address to user for confirmation

**Import Private Key** (standalone, no mnemonic):
1. User provides a label and hex-encoded private key
2. Derive address from PK
3. Store PK in keyring under `bze-hub:pk:{bze1address}`
4. Add account to `accounts.json` with `isImportedPK: true`
5. Note: cannot derive additional addresses from this — only the one PK

**Create New Address** (derive from existing mnemonic):
1. If user has multiple mnemonics → ask which one to derive from
2. If user has one mnemonic → use it
3. If user has zero mnemonics (only imported PKs) → redirect to Generate Mnemonic flow
4. Fetch mnemonic from keyring (auth required)
5. Determine next unused index for that mnemonic
6. Derive key, store PK in keyring under `bze-hub:pk:{bze1address}`
7. User provides a label for the new address
8. Add account to `accounts.json`

**Export Mnemonic**:
1. User selects which mnemonic to export (by label)
2. Auth required (Touch ID on macOS, password on Windows/Linux)
3. Fetch mnemonic from keyring
4. Display with auto-hide timer and copy button

**Rename Account**: Update label in `accounts.json`.

**Delete Account**:
- Remove from `accounts.json`
- Remove PK from keyring (`bze-hub:pk:{address}`)
- If this was the last account derived from a mnemonic, ask: "Also remove the mnemonic '{label}' from keyring?"
- Cannot delete the last remaining account

**Switch Active Account**: Update `activeAddress` in `accounts.json`. Emit `wallet:account-changed` Wails event. All dApp iframes receive `keplr_keystorechange`.

### What the UI Makes Clear

The wallet panel always shows:
- Which mnemonic each address was derived from (grouped visually)
- The derivation path for each address
- Whether an address is from an imported PK (marked differently)
- The active address (highlighted)

```
+-------------------------------------------------------------------+
|  Wallet                                                            |
|                                                                    |
|  Active: My Main Wallet (bze1abc...def)            [ Switch v ]    |
|                                                                    |
|  --- My Main Wallet (mnemonic) --- [ Export ] -------------------- |
|  (*) My Main Wallet   bze1abc...def   m/44'/118'/0'/0/0    [...]  |
|  ( ) Trading           bze1xyz...ghi   m/44'/118'/0'/0/1    [...]  |
|                                                                    |
|  --- Hardware Backup (mnemonic) --- [ Export ] -------------------- |
|  ( ) Savings           bze1qrs...tuv   m/44'/118'/0'/0/0    [...]  |
|                                                                    |
|  --- Imported Keys ------------------------------------------------ |
|  ( ) Old Wallet        bze1fed...cba   (imported PK)        [...]  |
|                                                                    |
|  [ + New Address ]   [ Import Mnemonic ]   [ Import Key ]          |
|  [ Generate New Mnemonic ]                                         |
+-------------------------------------------------------------------+
```

## 5. Mnemonic Lifecycle

### Multiple Mnemonics

Unlike typical wallet apps that manage a single mnemonic, BZE Hub supports **multiple mnemonics**. Each is labeled and stored independently in the keyring. A user might have:
- Their main BZE mnemonic (generated during first run)
- An imported mnemonic from a hardware wallet backup
- An imported mnemonic from another Cosmos wallet

Each mnemonic can have multiple derived addresses.

### First Run

During the first-run setup wizard (see 07-configuration.md section 9):
1. Generate 24-word BIP39 mnemonic
2. User provides a label for the mnemonic AND the first address (same label)
3. Display with security warnings
4. Require backup acknowledgment (checkbox)
5. **Verify backup**: user confirms 4 random words from the phrase
6. Store mnemonic in keyring under `bze-hub:mnemonic:{label}` (encrypted on Windows/Linux)
7. Derive first address (index 0), store PK in keyring under `bze-hub:pk:{bze1address}`

### Subsequent Mnemonic Generation

Users can generate additional mnemonics from the wallet panel at any time. Same flow as first run (label, show phrase, confirm 4 words, store).

### Keyring Access Pattern

The app minimizes keyring access:

| Operation | What is fetched from keyring |
|-----------|------------------------------|
| Sign a transaction | Only `bze-hub:pk:{signing_address}` |
| Derive new address | Only `bze-hub:mnemonic:{label}` of the chosen mnemonic |
| Export mnemonic | Only `bze-hub:mnemonic:{label}` of the chosen mnemonic |
| Switch active account | Nothing (metadata is in `accounts.json`) |
| Show address | Nothing (metadata is in `accounts.json`) |

Mnemonics are **never loaded into memory for signing**. Only the specific PK needed for the transaction is fetched. This is the key security design — even if a signing operation is compromised, only one private key is exposed, not the entire mnemonic.

### Storage (Platform-Adaptive)

Both mnemonics and private keys use the same storage abstraction — the only difference is the keyring key prefix (`mnemonic:` vs `pk:`).

**macOS**: Store directly in Keychain. OS handles encryption and per-access auth (Touch ID / system password).

**Windows/Linux**: Encrypt with app password (AES-256-GCM + Argon2id) before storing in the OS keyring.

```go
// Unified interface — abstracts platform differences
func (w *Wallet) StoreSecret(keyringKey string, secret string, password string) error {
    if runtime.GOOS == "darwin" {
        return keyring.Set(keyringService, keyringKey, secret)
    }
    encrypted, err := encryptWithPassword([]byte(secret), password)
    if err != nil {
        return err
    }
    return keyring.Set(keyringService, keyringKey, base64.StdEncoding.EncodeToString(encrypted))
}

func (w *Wallet) GetSecret(keyringKey string, password string) (string, error) {
    if runtime.GOOS == "darwin" {
        return keyring.Get(keyringService, keyringKey) // OS handles auth
    }
    encrypted, err := keyring.Get(keyringService, keyringKey)
    if err != nil {
        return "", err
    }
    data, _ := base64.StdEncoding.DecodeString(encrypted)
    decrypted, err := decryptWithPassword(data, password)
    if err != nil {
        return "", errors.New("incorrect password")
    }
    return string(decrypted), nil
}

// Convenience wrappers
func (w *Wallet) StoreMnemonic(label, mnemonic, password string) error {
    return w.StoreSecret("mnemonic:"+label, mnemonic, password)
}

func (w *Wallet) StorePK(address, pkHex, password string) error {
    return w.StoreSecret("pk:"+address, pkHex, password)
}

func (w *Wallet) GetMnemonic(label, password string) (string, error) {
    return w.GetSecret("mnemonic:"+label, password)
}

func (w *Wallet) GetPK(address, password string) (string, error) {
    return w.GetSecret("pk:"+address, password)
}
```

Note on macOS: `go-keyring` may not expose fine-grained Keychain access control flags. If not, we may need a thin CGo wrapper or `github.com/99designs/keyring`. Research needed during implementation.

### Password Encryption (Windows/Linux only)

AES-256-GCM with Argon2id key derivation:

```go
func encryptWithPassword(plaintext []byte, password string) ([]byte, error) {
    salt := make([]byte, 16)
    rand.Read(salt)
    key := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
    block, _ := aes.NewCipher(key)
    gcm, _ := cipher.NewGCM(block)
    nonce := make([]byte, gcm.NonceSize())
    rand.Read(nonce)
    ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
    return append(salt, ciphertext...), nil
}

func decryptWithPassword(data []byte, password string) ([]byte, error) {
    salt := data[:16]
    ciphertext := data[16:]
    key := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
    block, _ := aes.NewCipher(key)
    gcm, _ := cipher.NewGCM(block)
    nonceSize := gcm.NonceSize()
    return gcm.Open(nil, ciphertext[:nonceSize], ciphertext[nonceSize:], nil)
}
```

### In-Memory Handling

Unlike the earlier design where all keys were loaded into memory at once, the new model loads secrets **on demand** and zeros them immediately after use:

```go
type WalletSession struct {
    mu       sync.RWMutex
    password []byte // App password (Windows/Linux), held after unlock, zeroed on lock
}

// Sign fetches only the PK, signs, then zeros it
func (w *Wallet) Sign(address string, signDoc []byte) ([]byte, error) {
    pkHex, err := w.GetPK(address, string(w.session.password))
    if err != nil {
        return nil, err
    }
    defer secureZero([]byte(pkHex))

    pkBytes, _ := hex.DecodeString(pkHex)
    defer secureZero(pkBytes)

    privKey := &secp256k1.PrivKey{Key: pkBytes}
    defer secureZero(privKey.Key)

    hash := sha256.Sum256(signDoc)
    return privKey.Sign(hash[:])
}

// DeriveNewAddress fetches only the mnemonic, derives, stores PK, then zeros mnemonic
func (w *Wallet) DeriveNewAddress(mnemonicLabel string, index uint32) (*Account, error) {
    mnemonic, err := w.GetMnemonic(mnemonicLabel, string(w.session.password))
    if err != nil {
        return nil, err
    }
    defer secureZero([]byte(mnemonic))

    key, err := DeriveKey(mnemonic, index)
    if err != nil {
        return nil, err
    }

    // Store the derived PK immediately
    pkHex := hex.EncodeToString(key.PrivKey.Key)
    w.StorePK(key.Bech32Address, pkHex, string(w.session.password))
    secureZero(key.PrivKey.Key)

    return &Account{
        Bech32Address: key.Bech32Address,
        PubKeyHex:     hex.EncodeToString(key.PubKey.Bytes()),
        HDPath:        key.HDPath,
        AccountIndex:  index,
        MnemonicLabel: mnemonicLabel,
    }, nil
}

func secureZero(b []byte) {
    for i := range b {
        b[i] = 0
    }
}
```

**Key difference from before**: No bulk loading of all keys into memory. Each operation fetches only what it needs from the keyring, uses it, and zeros it. This is more secure — at any given moment, at most one secret is in memory.

### Unlock Flow (Platform-Adaptive)

The unlock flow depends on both the platform and the device trust setting.

**macOS** (no app password — OS handles auth via Touch ID / system password):

| Trust Setting | On App Launch | On First Signing Action |
|--------------|---------------|------------------------|
| Trusted | Address visible immediately from `settings.json`. No auth prompt. | Touch ID / system password prompt (Keychain access). Mnemonic loaded, keys derived, cached for session. |
| Untrusted | Touch ID / system password prompt immediately (to read address from Keychain). | Already unlocked from launch. |

**Windows / Linux** (app password required):

| Trust Setting | On App Launch | On First Signing Action |
|--------------|---------------|------------------------|
| Trusted | Address visible immediately from `settings.json`. No auth prompt. | App password prompt. Decrypts keyring entry, mnemonic loaded, keys derived, cached for session. |
| Untrusted | App password prompt immediately (to decrypt keyring and read address). | Already unlocked from launch. |
| Untrusted (5 failed attempts) | 60-second cooldown before retrying (anti-brute-force). | — |

In all cases, once the wallet is unlocked, it stays unlocked until the app closes or the user explicitly locks it.

### Auth Model Summary

- **macOS**: No app password. Touch ID / system password is the only layer. Clean, native UX.
- **Windows/Linux**: App password set during first-run setup. Required for every keyring access. The OS keyring provides storage but not meaningful per-access auth.

### Display Mnemonic

Only on explicit user request from the Dashboard wallet panel:
1. Show confirmation dialog: "Are you sure you want to reveal your recovery phrase?"
2. Require wallet password entry
3. Display mnemonic in a modal with copy button
4. Auto-hide after 60 seconds or on close
5. Never log mnemonic to any file

## 6. Import / Export

### Import Mnemonic

```go
func (w *Wallet) ImportMnemonic(name, mnemonic string, startIndex uint32) error {
    // 1. Validate BIP39
    if !bip39.IsMnemonicValid(mnemonic) {
        return errors.New("invalid mnemonic")
    }

    // 2. Store in keyring
    if err := StoreMnemonic(name, mnemonic); err != nil {
        return err
    }

    // 3. Derive account at startIndex
    key, err := DeriveKey(mnemonic, startIndex)
    if err != nil {
        return err
    }

    // 4. Add to accounts
    return w.addAccount(Account{
        Name:         name,
        Bech32Address: key.Bech32Address,
        PubKeyHex:    hex.EncodeToString(key.PubKey.Bytes()),
        HDPath:       key.HDPath,
        AccountIndex: startIndex,
        MnemonicRef:  name,
    })
}
```

### Export Mnemonic

1. Require auth (Touch ID on macOS, password on Windows/Linux)
2. Decrypt and retrieve from keyring
3. Return to frontend for display (over Wails binding, never logged)
4. Frontend shows with auto-hide timer (60 seconds) and copy-to-clipboard

## 7. Signing Operations

### SignAmino

Used by the dApps (they configure `preferredSignType: () => 'amino'`).

```go
type AminoSignDoc struct {
    ChainID       string          `json:"chain_id"`
    AccountNumber string          `json:"account_number"`
    Sequence      string          `json:"sequence"`
    Fee           json.RawMessage `json:"fee"`
    Msgs          json.RawMessage `json:"msgs"`
    Memo          string          `json:"memo"`
}

type AminoSignResponse struct {
    Signed    AminoSignDoc `json:"signed"`
    Signature Signature    `json:"signature"`
}

type Signature struct {
    PubKey    PubKeyJSON `json:"pub_key"`
    Signature string     `json:"signature"` // Base64-encoded
}

func (w *Wallet) SignAmino(chainId, signerAddress string, signDocJSON string) (*AminoSignResponse, error) {
    // 1. Verify chain ID matches expected
    // 2. Get private key for signer address
    privKey, err := w.getPrivateKey(signerAddress)
    if err != nil {
        return nil, err
    }

    // 3. Parse sign doc
    var signDoc AminoSignDoc
    json.Unmarshal([]byte(signDocJSON), &signDoc)

    // 4. Sort and serialize (Amino canonical JSON)
    sortedBytes := sortJSON(signDocJSON)

    // 5. SHA256 hash then sign with secp256k1
    hash := sha256.Sum256(sortedBytes)
    sig, err := privKey.Sign(hash[:])
    if err != nil {
        return nil, err
    }

    // 6. Return response
    return &AminoSignResponse{
        Signed: signDoc,
        Signature: Signature{
            PubKey: PubKeyJSON{
                Type:  "tendermint/PubKeySecp256k1",
                Value: base64.StdEncoding.EncodeToString(privKey.PubKey().Bytes()),
            },
            Signature: base64.StdEncoding.EncodeToString(sig),
        },
    }, nil
}
```

### SignDirect (Protobuf)

```go
type DirectSignDoc struct {
    BodyBytes     []byte `json:"bodyBytes"`     // Protobuf-encoded TxBody
    AuthInfoBytes []byte `json:"authInfoBytes"` // Protobuf-encoded AuthInfo
    ChainID       string `json:"chainId"`
    AccountNumber uint64 `json:"accountNumber"`
}

func (w *Wallet) SignDirect(chainId, signerAddress string, signDocBytes []byte) (*DirectSignResponse, error) {
    privKey, err := w.getPrivateKey(signerAddress)
    if err != nil {
        return nil, err
    }

    // Hash the sign doc bytes
    hash := sha256.Sum256(signDocBytes)

    // Sign
    sig, err := privKey.Sign(hash[:])
    if err != nil {
        return nil, err
    }

    return &DirectSignResponse{
        Signed:    signDocBytes,
        Signature: sig,
    }, nil
}
```

### Approval Flow Integration

Every signing request goes through the approval dialog (see 06-security.md):

```go
func (w *Wallet) RequestSign(method string, chainId string, signer string, signDoc interface{}) (interface{}, error) {
    // 1. Decode transaction messages for human-readable display
    summary := w.summarizeTransaction(signDoc)

    // 2. Emit approval request event to frontend
    requestId := uuid.New().String()
    runtime.EventsEmit(w.ctx, "bridge:sign-request", SignApprovalRequest{
        ID:       requestId,
        Method:   method, // "signAmino" or "signDirect"
        ChainID:  chainId,
        Signer:   signer,
        Summary:  summary,
    })

    // 3. Wait for user approval (or timeout)
    approved := w.waitForApproval(requestId, 60*time.Second)
    if !approved {
        return nil, errors.New("user rejected the signing request")
    }

    // 4. Perform the actual signing
    if method == "signAmino" {
        return w.SignAmino(chainId, signer, signDoc.(string))
    }
    return w.SignDirect(chainId, signer, signDoc.([]byte))
}
```

## 8. Multi-Account UX

### Account Switching

When the user switches the active account:

1. Update `activeAddress` in accounts.json
2. Emit `wallet:account-changed` Wails event to frontend
3. Frontend dispatches `keplr_keystorechange` event to all dApp iframes
4. Each dApp's `@interchain-kit` detects the event and refreshes the connected account
5. dApp UIs update to show the new account's balances and data

```typescript
// In the bridge injection script (runs in each iframe)
window.addEventListener("message", (event) => {
    if (event.data.type === "bze-hub:account-changed") {
        // Dispatch Keplr's standard event
        window.dispatchEvent(new Event("keplr_keystorechange"));
    }
});
```

### Listing Accounts for Keplr Bridge

When a dApp calls `window.keplr.getKey(chainId)`, return the active account:

```go
func (w *Wallet) KeplrGetKey(chainId string) (*KeplrKey, error) {
    active := w.getActiveAccount()
    pubKeyBytes, _ := hex.DecodeString(active.PubKeyHex)

    return &KeplrKey{
        Name:           active.Name,
        Algo:           "secp256k1",
        PubKey:         pubKeyBytes,
        Address:        sdk.AccAddress(pubKeyBytes).Bytes(), // Raw address bytes
        Bech32Address:  active.Bech32Address,
        IsNanoLedger:   false,
        IsKeystone:     false,
    }, nil
}
```

## 9. Security Considerations

- Private keys and mnemonics are NEVER logged, NEVER written to files, NEVER sent over network
- In-memory keys are zeroed on wallet lock and app shutdown
- Keyring access triggers OS-level authentication (Touch ID, Windows Hello, system password)
- All signing operations require explicit user approval via the UI
- The frontend (React shell) never has direct access to private keys - only the Go backend handles crypto
- Export operations require an additional confirmation step with clear warnings
