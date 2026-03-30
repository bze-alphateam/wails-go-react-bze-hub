# Epic 4a Plan: iframe dApp Loading

## Goal

Load BZE dApps (DEX, Burner, Staking) in iframes within the Hub shell. Tab switching shows/hides iframes. dApps render from their live URLs. No wallet integration yet — just the visual shell with real dApps loading inside.

## Context

Currently the tab bar has buttons for DEX/Burner/Staking but clicking them shows "coming in Epic 4". This epic replaces that with actual iframes loading the live dApp URLs.

## What Exists

- Tab bar with 4 tabs (Dashboard, DEX, Burner, Staking)
- Dashboard fully functional (balance, articles, links, settings)
- StatusBar with node status, proxy info, settings, theme toggle
- Proxy servers running (REST :2317, RPC :36657)

## Deliverables

### React Components

**DAppFrame.tsx** — iframe wrapper component:
- Loads a URL in an iframe (full width/height of content area)
- Loading state with spinner while iframe loads
- Error state if iframe fails to load (with retry button)
- `onLoad` / `onError` handlers

**App.tsx changes:**
- When activeTab is "dex", "burner", or "staking" → render DAppFrame with the live URL
- All iframes mounted once and kept alive via `display: none/block` (preserves state across tab switches)
- Lazy loading: iframe only mounts on first tab activation

### dApp Server Changes

Each dApp needs to allow being framed:
- Add `X-Frame-Options: ALLOWALL` or remove the header
- Or use `Content-Security-Policy: frame-ancestors *`
- This is a Next.js config change in each dApp repo (not in the Hub)

### What This Does NOT Include

- No hub-connector library
- No Keplr bridge / wallet connection
- No postMessage communication
- dApps will load but won't be able to connect a wallet (user sees the normal Keplr/Leap connect dialog which won't work since there's no extension)

### Verification

1. Click DEX tab → dex.getbze.com loads in iframe
2. Click Burner tab → burner.getbze.com loads
3. Switch back to DEX → it's still loaded (not re-rendered)
4. Dashboard tab still works
5. iframes respect the shell layout (between tab bar and status bar)
6. If a dApp blocks framing (X-Frame-Options), show error with "Open in browser" fallback button

## Files

| File | Action |
|------|--------|
| `frontend/src/components/DAppFrame.tsx` | New — iframe wrapper |
| `frontend/src/App.tsx` | Modified — replace placeholder with DAppFrame |
