import BigNumber from "bignumber.js";
import type { AssetBalance } from "../../hooks/useAssets";
import { prettyAmount, toBigNumber } from "../../utils/amount";
import { formatUsdAmount } from "../../utils/formatter";

/**
 * Presentational logic for the Portfolio section, kept pure (no React, no hooks)
 * so it can be unit-tested directly and reused by the row and the section.
 */

/** A USD-value lookup with the shape of `useAssets().usdValue`: the raw base-unit
 *  amount of a denom → its USD value, or null when the denom has no known price. */
export type UsdLookup = (denom: string, uAmount: string) => BigNumber | null;

export interface TypeBadge {
  label: string;
  /** Chakra `colorPalette` name, resolving in both light and dark themes. */
  colorPalette: string;
}

/**
 * Map an asset `type` (from the Go engine: native/factory/ibc/lp) to a display
 * label and accent colour. Colours mirror the web DEX `/assets` page; LP and any
 * unknown type fall back to a neutral grey.
 */
export function typeBadge(type: string): TypeBadge {
  switch (type) {
    case "native":
      return { label: "Native", colorPalette: "purple" };
    case "factory":
      return { label: "Factory", colorPalette: "blue" };
    case "ibc":
      return { label: "IBC", colorPalette: "teal" };
    case "lp":
      return { label: "LP", colorPalette: "gray" };
    default:
      return { label: type ? type.toUpperCase() : "Unknown", colorPalette: "gray" };
  }
}

/**
 * Format a USD value: "$1,234.56" for values ≥ 1, "$0.00046927" for sub-dollar
 * prices. Returns null when there is no positive value to show — the Portfolio
 * never renders "$0" for an asset without a price.
 */
export function usdLabel(value: BigNumber | null | undefined): string | null {
  if (!value || value.lte(0)) return null;
  if (value.gte(1)) return `$${prettyAmount(value.toFixed(2))}`;
  return `$${formatUsdAmount(value)}`;
}

/** True when the active wallet holds a positive balance of this asset. */
export function hasBalance(asset: AssetBalance): boolean {
  return toBigNumber(asset.amount || "0").gt(0);
}

/** Case-insensitive match of a search term against symbol, name or denom. */
export function matchesSearch(asset: AssetBalance, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return (
    asset.symbol.toLowerCase().includes(q) ||
    asset.name.toLowerCase().includes(q) ||
    asset.denom.toLowerCase().includes(q)
  );
}

/**
 * Sort assets by USD value descending (the Portfolio default). Assets without a
 * price sort as 0. Ties break the way the web DEX orders assets: native first,
 * then verified, then alphabetically by name — so a stable, sensible order even
 * when nothing is priced.
 */
export function sortByUsdValue(assets: AssetBalance[], usdValue: UsdLookup): AssetBalance[] {
  return [...assets].sort((a, b) => {
    const av = usdValue(a.denom, a.amount) ?? new BigNumber(0);
    const bv = usdValue(b.denom, b.amount) ?? new BigNumber(0);
    const cmp = bv.comparedTo(av) ?? 0;
    if (cmp !== 0) return cmp;

    if (a.type === "native" && b.type !== "native") return -1;
    if (b.type === "native" && a.type !== "native") return 1;
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export interface VisibleOpts {
  search: string;
  /** When false, only assets with a positive balance are shown (holdings only).
   *  When true, zero-balance known assets are revealed too. */
  showAll: boolean;
  usdValue: UsdLookup;
}

/**
 * The rows the Portfolio should display: filtered by search and the holdings /
 * "Show all" toggle, then sorted by USD value descending. The asset universe is
 * already scoped to known, non-excluded assets by the Go engine, so "Show all"
 * reveals zero-balance *known* assets, never the whole chain.
 */
export function visibleAssets(assets: AssetBalance[], opts: VisibleOpts): AssetBalance[] {
  const filtered = assets.filter((a) => {
    if (!matchesSearch(a, opts.search)) return false;
    if (!opts.showAll && !hasBalance(a)) return false;
    return true;
  });
  return sortByUsdValue(filtered, opts.usdValue);
}

/**
 * Total portfolio value = sum of every asset's USD value, big-number-safe.
 * Assets without a price contribute nothing (zero-balance assets contribute 0),
 * so this is the value of the wallet's holdings regardless of the current view.
 */
export function totalUsdValue(assets: AssetBalance[], usdValue: UsdLookup): BigNumber {
  return assets.reduce((sum, a) => {
    const v = usdValue(a.denom, a.amount);
    return v ? sum.plus(v) : sum;
  }, new BigNumber(0));
}
