# Epic 1 Complete: Wails Project Setup + React Shell Layout

## What Was Done

Initialized a Wails v2 desktop app with React 19 + Chakra UI v3, producing a working shell layout with tab bar, content area, and status bar.

## Environment

- **Go**: 1.25.3 at `/Users/stefan.balea/sdk/go1.25.3/bin/go`
- **Wails CLI**: v2.12.0 (installed to `~/go/bin/wails`)
- **Node**: v24.10.0, npm 11.6.1
- **Platform**: macOS ARM64 (Apple M3 Pro)

**Important**: Wails needs Go in PATH. Always run with:
```bash
PATH="/Users/stefan.balea/sdk/go1.25.3/bin:$PATH" ~/go/bin/wails dev
```

## Files Created / Modified

### Go Backend
| File | Purpose |
|------|---------|
| `main.go` | Wails entry point. Window 1280x800, min 800x600. Embeds `frontend/dist`. Binds App struct. |
| `app.go` | App struct with `startup()`, `shutdown()` stubs, and `GetVersion()` returning "0.1.0". |
| `go.mod` | Module `github.com/bze-alphateam/bze-hub`, Go 1.25, Wails v2.12.0. |
| `wails.json` | App name "BZE Hub", output "bze-hub", React+Vite frontend config. |

### React Frontend
| File | Purpose |
|------|---------|
| `frontend/src/main.tsx` | React root with `ChakraProvider` wrapping the App. Imports `style.css` and `theme.ts`. |
| `frontend/src/App.tsx` | Shell layout: `Flex` column with TabBar, ContentArea, StatusBar. Manages `activeTab` state. |
| `frontend/src/theme.ts` | Chakra system config: teal color palette, system-ui font stack, custom radii tokens. |
| `frontend/src/components/TabBar.tsx` | Tab buttons (Dashboard, DEX, Burner, Staking) with icons. Active tab highlighted in teal. Version text on the right. |
| `frontend/src/components/ContentArea.tsx` | Centered "Welcome to BZE Hub / Let's get you started" text. |
| `frontend/src/components/StatusBar.tsx` | Bottom bar: gray dot + "Node: not started", "Network: Mainnet", "v0.1.0". |
| `frontend/src/style.css` | Minimal reset: no margins, 100% height, hidden overflow. |

### Build Artifacts
| Path | Type |
|------|------|
| `build/bin/BZE Hub.app` | macOS app bundle (production build) |

## Design Decisions

1. **Chakra UI v3 with teal palette** — differentiates from DEX (blue) and Burner (orange). Uses `createSystem(defaultConfig, config)` pattern matching existing dApps.

2. **No `next-themes`** — the dApps use it for Next.js SSR. The Wails shell is a SPA (Vite), so Chakra's built-in color mode is sufficient.

3. **react-icons type workaround** — React 19's stricter JSX types make `IconType` from react-icons incompatible as JSX components. Fixed by calling icon functions directly (`LuHouse({})`) and casting to `React.ReactNode`, instead of using `<LuHouse />` syntax.

4. **No `internal/` packages yet** — the Go backend has only the App struct with stubs. Packages for wallet, node, proxy, etc. come in Epic 2 and 3.

5. **Tab state managed in React** — `activeTab` is local React state. In future epics, tab switching will trigger iframe show/hide. For now, only the button highlighting works.

## How to Run

```bash
# Development mode (hot reload)
cd bze-hub
PATH="/Users/stefan.balea/sdk/go1.25.3/bin:$PATH" ~/go/bin/wails dev

# Production build
PATH="/Users/stefan.balea/sdk/go1.25.3/bin:$PATH" ~/go/bin/wails build

# Run the built app
open "build/bin/BZE Hub.app"
```

## What's Next (Epic 2)

Implement the keyring and wallet functionality:
- OS keyring integration (platform-adaptive: macOS Keychain vs password on Windows/Linux)
- `internal/wallet/` package: BIP44 derivation, mnemonic management, PK storage, signing
- `internal/config/` package: `accounts.json`, `settings.json`
- First-run wizard in the React shell: generate mnemonic, confirm 4 words, trust device
- Import mnemonic and import PK flows
- Account switching in the tab bar

The Go backend's `App` struct will gain wallet-related bound methods. The React shell will add a Dashboard panel with wallet management UI.
