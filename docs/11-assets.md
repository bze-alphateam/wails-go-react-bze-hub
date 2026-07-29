# 11 — Assets (token display & decimals)

BZE Hub shows balances, stakes, and rewards in many denoms: the native `ubze`,
token-factory tokens (`factory/{addr}/{subdenom}`), and IBC tokens (`ibc/{HASH}`).
Each can have its own **decimals** and a friendly **symbol** that the raw denom does
not tell you (e.g. `factory/…/uvdl` displays as **VDL** with 6 decimals). The
`frontend/src/assets/` module is the single, reusable way to render any of them
correctly.

> Historically the app hardcoded 6 decimals everywhere (`ubzeToHuman`) and showed the
> raw sub-denom (e.g. "uvdl"). That's correct for `ubze` but wrong for other tokens.
> This module fixes both.

## How the ecosystem does it (and why ours is lighter)

The web apps (`dex`, `burner`) resolve assets through `@bze/bze-ui-kit`, which leans
on the heavy **chain-registry** npm package plus on-chain bank metadata and IBC
denom-trace queries, all surfaced through an `AssetsContext` / `useAssets()` hook
(`Asset { denom, decimals, symbol, name, logo, verified, … }`).

A desktop app shouldn't bundle chain-registry. Instead we use the **on-chain bank
denom-metadata** as the native source of truth — it carries every factory token's
decimals/symbol/name — and layer a tiny static registry on top. The public API
(`useAssets()`, `AssetMeta`) intentionally mirrors the kit so the mental model
transfers.

## Resolution: a layered registry (`registry.ts`)

`resolveAsset(denom, chainMap)` returns an `AssetMeta` for any denom, first hit wins:

1. **Static built-ins** — denoms the chain's bank metadata does *not* carry. Today
   just native `ubze` → `BZE`/6 (the chain returns no metadata for `ubze`).
2. **Curated IBC** (`KNOWN_IBC`) — bank metadata never covers IBC tokens (they'd need
   denom-trace + counterparty lookups). Seeded with USDC; **this map is the extension
   point** for adding IBC tokens without a chain-registry dependency.
3. **Chain metadata** — the bank `denoms_metadata`, fetched at runtime. Covers all
   factory tokens. Decimals = the exponent of the `denom_unit` whose denom equals
   `display` (falls back to the largest exponent present); symbol/name from the entry.
4. **Heuristic fallback** — type-detected best effort: `decimals = 6` (the ecosystem
   norm) and a short label (`shortDenomLabel`). Flagged `resolved: false` so the UI
   can treat it as approximate.

`resolveAsset` works **before** chain metadata loads (static/known/heuristic still
answer), so `ubze` always renders correctly at startup.

### Backend (`app.go` → `GetDenomsMetadata`)

Queries `/cosmos/bank/v1beta1/denoms_metadata?pagination.limit=1000` through the local
proxy and returns the raw `Metadata` list. Cached **10 minutes** (metadata changes
rarely); the last good value is served if a refresh fails, so the UI never regresses
to "unknown decimals" on a transient blip. Wails binding: `GetDenomsMetadata(): Promise<Record<string,any>[]>`.

## Provider & hook (`AssetsProvider.tsx`)

`<AssetsProvider>` (mounted in `main.tsx` inside `ChakraProvider`) loads the metadata
once, retries with backoff if the node/proxy isn't ready yet, and refreshes every
10 minutes. `useAssets()` exposes:

| Member | What |
|--------|------|
| `getAsset(denom)` | full `AssetMeta` (never null) |
| `decimals(denom)` / `symbol(denom)` | the two most-used fields |
| `toHuman(amount, denom)` | base units → exact human string |
| `format(amount, denom, opts?)` | base units → grouped display string |
| `assets` | all known assets (static + curated + chain), for pickers |
| `reload()` | force a metadata refresh |

## The component (`AssetAmount.tsx`)

The reusable display primitive. Give it base units + denom; it resolves decimals and
symbol and formats:

```tsx
<AssetAmount amount="164006001296" denom="ubze" />              // 164,006.001296 BZE
<AssetAmount amount={pending} denom={reward.prize_denom} />     // 10 VDL
<AssetAmount amount={pool} denom={stakingDenom} maxDecimals={2} showLogo />
<AssetAmount amount={big} denom="ubze" abbreviate />            // 1.64M BZE
```

Props: `amount`, `denom`, optional `decimals`/`symbol` overrides, `showSymbol`
(default true), `showLogo`, `abbreviate`, `maxDecimals` (default `min(decimals, 6)`),
plus any Chakra `TextProps`. `AssetLogo` renders the token logo with a first-letter
monogram fallback.

## Pure helpers (`format.ts`, `denom.ts`)

- `uAmountToHuman(amount, decimals)` / `humanToUAmount(human, decimals)` — BigInt-exact
  base↔human conversion (generalize the old hardcoded-6 `ubzeToHuman`/`humanToUbze`).
  `humanToUAmount` truncates excess fraction digits (never rounds up funds).
- `formatAmount` (grouping + max fraction digits), `shortNumberFormat` (1.2M/3.4B),
  `formatUAmount` (convert + format in one call).
- `getDenomType`, `isFactory/Ibc/Lp/NativeDenom`, `shortDenomLabel`, `truncateDenom`.

All pure and unit-tested (`format.test.ts`, `registry.test.ts`) — 24 tests covering
exact conversion, truncation, the layered resolver, the real VDL metadata shape, the
unknown-denom heuristic, and the empty-fallback path.

## Where it's wired in

Compact + advanced staking reward views and the join-reward modal now resolve symbols
and decimals through this module, so factory tokens show their real symbol (**VDL**,
not "uvdl") and non-`ubze` staking programs convert with the correct exponent. Adding
a new asset-aware surface is just `<AssetAmount amount={…} denom={…} />`.
