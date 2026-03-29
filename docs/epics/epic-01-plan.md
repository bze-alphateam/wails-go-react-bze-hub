# Epic 1 Plan: Wails Project Setup + React Shell Layout

## Goal

A running Wails v2 app with React 19 + Chakra UI v3 shell layout (tab bar, content area, status bar) that opens in dev mode.

## Prerequisites (verified)

- Go 1.25.3 at `/Users/stefan.balea/sdk/go1.25.3/bin/go`
- Node v24.10.0, npm 11.6.1
- Wails v2.12.0 CLI installed at `~/go/bin/wails`
- Target directory: `/Users/stefan.balea/projects/bze-ecosystem/bze-hub/`

## Steps

### 1. Initialize Wails project

Scaffold with React+TypeScript template in a temp dir, then merge into `bze-hub/` preserving `docs/`.

### 2. Configure wails.json

App name "BZE Hub", output "bze-hub", window 1280x800, min 800x600.

### 3. Go backend (minimal)

- `main.go` — Wails entry point with embedded frontend assets
- `app.go` — App struct with `startup(ctx)` and `shutdown(ctx)` stubs

### 4. React frontend with Chakra UI v3

Packages: `@chakra-ui/react ^3.22.0`, `@emotion/react ^11.14.0`, `react-icons ^5.5.0`

Files:
- `frontend/src/main.tsx` — React root with Chakra Provider
- `frontend/src/App.tsx` — Shell layout (TabBar + ContentArea + StatusBar)
- `frontend/src/components/TabBar.tsx` — Placeholder tab buttons
- `frontend/src/components/StatusBar.tsx` — Static status text
- `frontend/src/components/ContentArea.tsx` — Welcome message centered
- `frontend/src/theme.ts` — Chakra system config

### 5. Shell layout

```
+--------------------------------------------------------------------+
| [Dashboard] [DEX] [Burner] [Staking]         BZE Hub v0.1.0       |
+--------------------------------------------------------------------+
|                                                                    |
|              Welcome to BZE Hub                                    |
|              Let's get you started                                 |
|                                                                    |
+--------------------------------------------------------------------+
| Node: not started  |  Network: Mainnet  |  v0.1.0                 |
+--------------------------------------------------------------------+
```

## Verification

1. `wails dev` opens the app with the shell layout
2. Tab bar visible with 4 placeholder buttons
3. Welcome text centered in content area
4. Status bar at bottom
5. `wails build` produces a standalone binary
