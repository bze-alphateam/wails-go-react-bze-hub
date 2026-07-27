import BigNumber from "bignumber.js";
import { tradebin } from "../../../../wailsjs/go/models";
import { toBigNumber, uAmountToAmount, uPriceToPrice } from "../../../utils/amount";

/** How the market list can be ordered. */
export type MarketSort = "volume" | "change";

/** A resolver from denom → its symbol/decimals/verified flag (from useAssets). */
export interface AssetInfo {
  symbol: string;
  decimals: number;
  verified: boolean;
}
export type ResolveAsset = (denom: string) => AssetInfo | undefined;

/** A market is verified when both of its assets are verified (web parity). */
export function isVerifiedMarket(m: tradebin.MarketWithStats, resolve: ResolveAsset): boolean {
  return !!resolve(m.base)?.verified && !!resolve(m.quote)?.verified;
}

/**
 * filterMarkets keeps markets whose base/quote symbol or denom matches the
 * (case-insensitive, trimmed) search term. An empty term matches everything.
 */
export function filterMarkets(
  markets: tradebin.MarketWithStats[],
  search: string,
  resolve: ResolveAsset,
): tradebin.MarketWithStats[] {
  const q = search.trim().toLowerCase();
  if (!q) return markets;
  return markets.filter((m) => {
    const baseSym = resolve(m.base)?.symbol ?? "";
    const quoteSym = resolve(m.quote)?.symbol ?? "";
    return (
      baseSym.toLowerCase().includes(q) ||
      quoteSym.toLowerCase().includes(q) ||
      m.base.toLowerCase().includes(q) ||
      m.quote.toLowerCase().includes(q)
    );
  });
}

function statNumber(value: string | undefined): BigNumber {
  const n = toBigNumber(value || 0);
  return n.isNaN() ? new BigNumber(0) : n;
}

/**
 * sortMarkets orders markets descending by the chosen stat (24h quote volume or
 * 24h % change). Markets without stats sort last, preserving a stable order
 * among themselves. Does not mutate the input.
 */
export function sortMarkets(
  markets: tradebin.MarketWithStats[],
  sort: MarketSort,
): tradebin.MarketWithStats[] {
  const key = (m: tradebin.MarketWithStats): BigNumber | null => {
    if (!m.statsAvailable || !m.stats) return null;
    return sort === "volume" ? statNumber(m.stats.quoteVolume) : statNumber(m.stats.change);
  };
  return [...markets].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return kb.comparedTo(ka) ?? 0;
  });
}

/** One orderbook price level with display values and cumulative depth. */
export interface DepthLevel {
  /** Display price (quote per base), for showing and for onPriceSelect. */
  price: string;
  /** Display base amount at this level. */
  amount: string;
  /** Display quote total at this level (price × amount). */
  total: string;
  /** Cumulative display base amount from the best price to here. */
  cumulative: string;
  /** Cumulative depth as a fraction 0..100 of this side's deepest level. */
  depthPct: number;
}

/**
 * buildDepth converts raw aggregated orderbook levels (chain u-price / u-amount)
 * into display DepthLevels with cumulative base depth and a per-side depth
 * percentage for the background bars. Levels are consumed in the order given
 * (the query already returns each side best-price-first). maxCumulative can be
 * passed to normalise both sides against a shared scale; when omitted each side
 * normalises to its own deepest level.
 */
export function buildDepth(
  levels: tradebin.OrderbookLevel[],
  baseDecimals: number,
  quoteDecimals: number,
  maxCumulative?: BigNumber,
): DepthLevel[] {
  let cumU = new BigNumber(0);
  const rows = levels.map((lvl) => {
    cumU = cumU.plus(toBigNumber(lvl.amount || 0));
    const price = uPriceToPrice(lvl.price, quoteDecimals, baseDecimals);
    const amount = uAmountToAmount(lvl.amount, baseDecimals);
    const total = toBigNumber(price).multipliedBy(amount).toString();
    return { price, amount, total, cumU: cumU };
  });
  const max = maxCumulative ?? cumU; // cumU now holds the side's total depth
  return rows.map((r) => ({
    price: r.price,
    amount: r.amount,
    total: r.total,
    cumulative: uAmountToAmount(r.cumU.toFixed(0), baseDecimals),
    depthPct: max.isZero() ? 0 : r.cumU.dividedBy(max).multipliedBy(100).toNumber(),
  }));
}

/** cumulativeMaxU returns the total (raw u-amount) base depth of a side. */
export function cumulativeMaxU(levels: tradebin.OrderbookLevel[]): BigNumber {
  return levels.reduce((acc, l) => acc.plus(toBigNumber(l.amount || 0)), new BigNumber(0));
}

/**
 * spread returns the display spread between the best sell (lowest ask) and best
 * buy (highest bid), plus its percentage of the mid price. Returns null when
 * either side is empty. buy is highest-first and sell is lowest-first (as the
 * orderbook query returns them).
 */
export function spread(
  buy: tradebin.OrderbookLevel[],
  sell: tradebin.OrderbookLevel[],
  baseDecimals: number,
  quoteDecimals: number,
): { value: string; percent: string } | null {
  if (buy.length === 0 || sell.length === 0) return null;
  const bestBid = toBigNumber(uPriceToPrice(buy[0].price, quoteDecimals, baseDecimals));
  const bestAsk = toBigNumber(uPriceToPrice(sell[0].price, quoteDecimals, baseDecimals));
  const value = bestAsk.minus(bestBid);
  const mid = bestAsk.plus(bestBid).dividedBy(2);
  const percent = mid.isZero() ? new BigNumber(0) : value.dividedBy(mid).multipliedBy(100);
  return { value: value.toString(), percent: percent.toFixed(2) };
}
