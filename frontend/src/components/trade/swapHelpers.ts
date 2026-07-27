import BigNumber from "bignumber.js";
import type { AssetBalance } from "../../hooks/useAssets";
import { amountToBigNumberUAmount, toBigNumber } from "../../utils/amount";

/**
 * Pure helpers for the Simple swap card. Kept free of React and Wails so they
 * can be unit-tested directly. All math is BigNumber-based — chain amounts
 * routinely exceed Number.MAX_SAFE_INTEGER, so float math would lose precision.
 */

/** The minimal shape of a liquidity pool this module needs (structural). */
export interface PoolLike {
  base: string;
  quote: string;
}

/** Slippage presets offered as quick-select buttons, in percent. */
export const SLIPPAGE_PRESETS = [0.5, 1, 2] as const;

/** Default slippage tolerance, in percent (web parity — dex page ~line 33). */
export const DEFAULT_SLIPPAGE = 0.5;

/**
 * Filter assets by a free-text query against symbol or name (case-insensitive).
 * An empty/whitespace query returns the list unchanged.
 */
export function filterAssets(assets: AssetBalance[], query: string): AssetBalance[] {
  const q = query.trim().toLowerCase();
  if (!q) return assets;
  return assets.filter(
    (a) =>
      a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
  );
}

/**
 * Order assets for the picker: held balances first, then verified, then
 * alphabetically by symbol — mirroring the web dex swap page's ordering so the
 * tokens a user is most likely to swap surface at the top.
 */
export function sortAssetsForPicker(assets: AssetBalance[]): AssetBalance[] {
  return [...assets].sort((a, b) => {
    const aHasBalance = toBigNumber(a.amount || 0).gt(0);
    const bHasBalance = toBigNumber(b.amount || 0).gt(0);
    if (aHasBalance !== bHasBalance) return aHasBalance ? -1 : 1;
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    return a.symbol.localeCompare(b.symbol);
  });
}

/**
 * Whether a chain of pools structurally connects `fromDenom` to `toDenom`,
 * ignoring reserves. Used only to tell a genuinely unroutable pair ("no route")
 * apart from a pair whose pools exist but can't fill the trade ("insufficient
 * liquidity") — the QuoteSwap binding collapses both into a NoRoute result.
 */
export function hasConnectingPath(
  pools: PoolLike[],
  fromDenom: string,
  toDenom: string,
): boolean {
  if (!fromDenom || !toDenom || fromDenom === toDenom) return false;

  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const pool of pools) {
    if (!pool.base || !pool.quote) continue;
    link(pool.base, pool.quote);
    link(pool.quote, pool.base);
  }

  const seen = new Set<string>([fromDenom]);
  const queue = [fromDenom];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toDenom) return true;
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * Parse a display-unit amount (e.g. "1.5") into an integer base-unit string for
 * the given token decimals, or `null` when the input is empty, non-numeric or
 * not strictly positive. Excess decimals are truncated (never rounded up).
 */
export function parseAmountToBase(
  input: string,
  decimals: number,
): string | null {
  const amount = toBigNumber(input);
  if (amount.isNaN() || amount.lte(0)) return null;
  return amountToBigNumberUAmount(amount, decimals)
    .integerValue(BigNumber.ROUND_DOWN)
    .toFixed(0);
}

/**
 * Minimum acceptable output (base units) after applying a slippage tolerance to
 * an expected output. Rounded down so the guaranteed floor is never overstated.
 */
export function minOutputBase(
  expectedOutBase: string,
  slippagePercent: BigNumber.Value,
): string {
  const out = toBigNumber(expectedOutBase);
  if (out.isNaN() || out.lte(0)) return "0";
  const multiplier = new BigNumber(1).minus(
    new BigNumber(slippagePercent).dividedBy(100),
  );
  return out
    .multipliedBy(multiplier)
    .integerValue(BigNumber.ROUND_DOWN)
    .toFixed(0);
}

/** Whether a slippage value (percent) is within the accepted 0–50% range. */
export function isValidSlippage(value: BigNumber.Value): boolean {
  const n = new BigNumber(value);
  return !n.isNaN() && n.gte(0) && n.lte(50);
}

/**
 * Keep only characters valid in a positive decimal amount: digits and a single
 * decimal point. Any later dots are dropped, so the input can never become NaN.
 */
export function sanitizeAmountInput(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return (
    cleaned.slice(0, firstDot + 1) +
    cleaned.slice(firstDot + 1).replace(/\./g, "")
  );
}

/** A resolved problem with the current swap inputs, or "none". */
export type SwapIssue =
  | "none"
  | "same-asset"
  | "no-route"
  | "insufficient-liquidity"
  | "insufficient-balance";

/** The minimal quote shape needed to resolve an issue. */
interface QuoteLike {
  noRoute: boolean;
}

/**
 * Classify the current swap inputs into a single actionable issue. Empty/≤0
 * amounts are treated as "none" (a neutral prompt, not an error). A NoRoute
 * quote is split into "insufficient-liquidity" (the pools connect the pair) vs
 * "no-route" (they don't).
 */
export function resolveSwapIssue(params: {
  fromDenom: string;
  toDenom: string;
  amountBase: string | null;
  balanceBase: string;
  quote: QuoteLike | null;
  pools: PoolLike[];
}): SwapIssue {
  const { fromDenom, toDenom, amountBase, balanceBase, quote, pools } = params;
  if (!fromDenom || !toDenom) return "none";
  if (fromDenom === toDenom) return "same-asset";
  if (!amountBase) return "none";
  if (toBigNumber(amountBase).gt(toBigNumber(balanceBase || 0))) {
    return "insufficient-balance";
  }
  if (quote && quote.noRoute) {
    return hasConnectingPath(pools, fromDenom, toDenom)
      ? "insufficient-liquidity"
      : "no-route";
  }
  return "none";
}

/** Human-friendly message for a swap issue, or `null` when there's nothing to say. */
export function swapIssueMessage(issue: SwapIssue): string | null {
  switch (issue) {
    case "same-asset":
      return "Choose two different tokens to swap.";
    case "no-route":
      return "No swap route connects these two tokens.";
    case "insufficient-liquidity":
      return "Not enough liquidity in the pool to complete this swap. Try a smaller amount.";
    case "insufficient-balance":
      return "You don't have enough balance for this amount.";
    default:
      return null;
  }
}

/** Chakra colorPalette for a price-impact badge, escalating with severity. */
export function priceImpactPalette(priceImpactPercent: BigNumber.Value): string {
  const impact = new BigNumber(priceImpactPercent);
  if (impact.isNaN()) return "gray";
  if (impact.gt(1)) return "red";
  if (impact.gt(0.5)) return "yellow";
  return "green";
}
