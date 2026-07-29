// Asset resolution: a layered registry that turns a bare denom into AssetMeta.
//
// Resolution order (first hit wins):
//   1. STATIC_ASSETS  — denoms the chain's bank metadata does NOT carry (native ubze).
//   2. KNOWN_IBC      — curated IBC denoms (bank metadata never covers IBC). Extension point.
//   3. chain metadata — bank denoms_metadata, fetched at runtime (all factory tokens).
//   4. heuristic      — type-detected best-effort guess, flagged resolved:false.
//
// This is intentionally lightweight: the web apps (bze-ui-kit) resolve via the heavy
// chain-registry npm package, which a desktop app shouldn't bundle. The on-chain bank
// metadata is the native equivalent for factory tokens and is authoritative for decimals.

import type { AssetMeta } from "./types";
import { getDenomType, shortDenomLabel, NATIVE_DENOM } from "./denom";

/** Decimals assumed for an otherwise-unknown denom. 6 is the BZE-ecosystem norm. */
export const FALLBACK_DECIMALS = 6;

/** Built-in assets not present in the chain's bank metadata. */
const STATIC_ASSETS: Record<string, AssetMeta> = {
  [NATIVE_DENOM]: {
    denom: NATIVE_DENOM,
    type: "native",
    decimals: 6,
    symbol: "BZE",
    name: "BeeZee",
    verified: true,
    resolved: true,
  },
};

/**
 * Curated IBC denoms. Bank metadata never carries IBC tokens (they'd need denom-trace
 * + counterparty chain-registry lookups). Add confirmed entries here — this map is the
 * extension point for IBC support without a chain-registry dependency.
 */
const KNOWN_IBC: Record<string, AssetMeta> = {
  // USDC (Noble) — flagged as the stablecoin across the BZE ecosystem.
  "ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4": {
    denom: "ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4",
    type: "ibc",
    decimals: 6,
    symbol: "USDC",
    name: "USD Coin",
    verified: true,
    resolved: true,
  },
};

/** Raw bank denom-metadata entry (Cosmos `Metadata`), as returned by the backend. */
export interface ChainDenomMetadata {
  base?: string;
  display?: string;
  name?: string;
  symbol?: string;
  uri?: string;
  denom_units?: { denom: string; exponent: number | string; aliases?: string[] }[];
}

/**
 * Turn one bank-metadata entry into an AssetMeta. Decimals = the exponent of the
 * denom_unit whose denom matches `display` (the convention); falls back to the
 * largest exponent present. Returns null if there's no usable base denom.
 */
export function assetFromChainMetadata(m: ChainDenomMetadata): AssetMeta | null {
  const denom = m.base;
  if (!denom) return null;

  const display = m.display || "";
  const units = m.denom_units || [];
  const displayUnit = units.find((u) => u.denom === display);
  const decimals = displayUnit
    ? Number(displayUnit.exponent) || 0
    : units.reduce((mx, u) => Math.max(mx, Number(u.exponent) || 0), 0);

  const symbol = m.symbol || display || shortDenomLabel(denom);
  return {
    denom,
    type: getDenomType(denom),
    decimals,
    symbol,
    name: m.name || symbol,
    logo: m.uri || undefined,
    verified: false,
    resolved: true,
  };
}

/** Build a denom→AssetMeta map from the chain's bank metadata list. */
export function buildChainAssetMap(
  metadatas: ChainDenomMetadata[]
): Map<string, AssetMeta> {
  const map = new Map<string, AssetMeta>();
  for (const m of metadatas || []) {
    const a = assetFromChainMetadata(m);
    if (a) map.set(a.denom, a);
  }
  return map;
}

/** Best-effort metadata for an unknown denom — never throws, always returns something. */
export function heuristicAsset(denom: string): AssetMeta {
  const label = shortDenomLabel(denom);
  return {
    denom,
    type: getDenomType(denom),
    decimals: FALLBACK_DECIMALS,
    symbol: label,
    name: label,
    verified: false,
    resolved: false,
  };
}

/**
 * Resolve a denom to AssetMeta through the full layered chain. `chainMap` is the
 * runtime bank-metadata map (may be undefined before it loads — static/known/heuristic
 * still work, so ubze always renders correctly even at startup).
 */
export function resolveAsset(
  denom: string,
  chainMap?: Map<string, AssetMeta>
): AssetMeta {
  if (!denom) return heuristicAsset(denom);
  return (
    STATIC_ASSETS[denom] ||
    KNOWN_IBC[denom] ||
    chainMap?.get(denom) ||
    heuristicAsset(denom)
  );
}

/**
 * The full set of known assets (static + curated IBC + chain), for callers that need
 * to enumerate (e.g. an asset picker). Static/known entries override chain on conflict.
 */
export function combineAssets(
  chainMap: Map<string, AssetMeta>
): Map<string, AssetMeta> {
  const map = new Map(chainMap);
  for (const a of Object.values(KNOWN_IBC)) map.set(a.denom, a);
  for (const a of Object.values(STATIC_ASSETS)) map.set(a.denom, a);
  return map;
}

/** Exposed for tests / debugging. */
export const __staticAssets = STATIC_ASSETS;
export const __knownIbc = KNOWN_IBC;
