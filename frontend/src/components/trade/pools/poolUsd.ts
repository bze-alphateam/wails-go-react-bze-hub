import BigNumber from "bignumber.js";
import type { amm, tradebin } from "../../../../wailsjs/go/models";
import { toBigNumber } from "../../../utils/amount";
import { createPoolId, poolAprPercent } from "./poolHelpers";

/** USD unit price for a denom, or null when unknown (the asset engine's `price`). */
export type PriceFn = (denom: string) => BigNumber | null;
/** USD value of a raw base-unit amount, or null (the asset engine's `usdValue`). */
export type UsdValueFn = (denom: string, uAmount: string | number | BigNumber) => BigNumber | null;

/**
 * Index pool stats for lookup by pool id and by the orientation-independent
 * `base_quote` key, so a pool matches its stat regardless of id format or
 * base/quote ordering.
 */
export function indexPoolStats(
  stats: tradebin.PoolStat[] | null | undefined,
): Map<string, tradebin.PoolStat> {
  const map = new Map<string, tradebin.PoolStat>();
  for (const s of stats ?? []) {
    if (s.poolId) map.set(s.poolId, s);
    map.set(createPoolId(s.base, s.quote), s);
  }
  return map;
}

/** The stat row for a pool, matched by id first then by base/quote. */
export function findPoolStat(
  pool: amm.Pool,
  index: Map<string, tradebin.PoolStat>,
): tradebin.PoolStat | undefined {
  return index.get(pool.id) ?? index.get(createPoolId(pool.base, pool.quote));
}

/** Pool TVL in USD from both reserves; null when neither side has a known price. */
export function poolTvlUsd(pool: amm.Pool, usdValue: UsdValueFn): BigNumber | null {
  const base = usdValue(pool.base, pool.reserveBase);
  const quote = usdValue(pool.quote, pool.reserveQuote);
  if (base === null && quote === null) return null;
  return (base ?? toBigNumber(0)).plus(quote ?? toBigNumber(0));
}

/** 24h pool volume in USD from the aggregator stat; null when unpriced or no stat. */
export function poolVolumeUsd(
  pool: amm.Pool,
  stat: tradebin.PoolStat | undefined,
  price: PriceFn,
): BigNumber | null {
  if (!stat) return null;
  const pb = price(pool.base);
  if (pb) return pb.multipliedBy(toBigNumber(stat.baseVolume || 0));
  const pq = price(pool.quote);
  if (pq) return pq.multipliedBy(toBigNumber(stat.quoteVolume || 0));
  return null;
}

/** Pool APR% from its fee/providers split, 24h volume and TVL (0 when unknown). */
export function poolApr(
  pool: amm.Pool,
  tvlUsd: BigNumber | null,
  volumeUsd: BigNumber | null,
): number {
  if (!tvlUsd || !volumeUsd || tvlUsd.lte(0)) return 0;
  return poolAprPercent(volumeUsd, pool.fee || "0", pool.feeProviders || "0", tvlUsd);
}
