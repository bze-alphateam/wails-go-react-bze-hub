import BigNumber from "bignumber.js";
import { toBigNumber } from "../../../utils/amount";
import { type ProtoMsg } from "../../../hooks/useTx";

/** Numeric input accepted by the pool math (what `toBigNumber` takes). */
export type NumLike = string | number | BigNumber;

/** The tradebin add/remove-liquidity proto type URLs (signed by the Go codec). */
export const TYPE_ADD_LIQUIDITY = "/bze.tradebin.MsgAddLiquidity";
export const TYPE_REMOVE_LIQUIDITY = "/bze.tradebin.MsgRemoveLiquidity";

/** Slippage presets (percent) offered when adding/removing — web parity. */
export const SLIPPAGE_PRESETS = [0.5, 1, 3];

/**
 * Decimals used to display LP-share amounts. The chain's LP tokens use 12
 * decimals; the web hardcodes the same constant (`LP_ASSETS_DECIMALS`). Only
 * affects display/parse of the share figure — message amounts stay raw.
 */
export const LP_SHARE_DECIMALS = 12;

/**
 * The orientation-independent pool key `base_quote` (denoms sorted). Ported from
 * the web `createPoolId`; used to match aggregator pool stats to a pool
 * regardless of base/quote ordering.
 */
export function createPoolId(base: string, quote: string): string {
  return base > quote ? `${quote}_${base}` : `${base}_${quote}`;
}

/** The pool reserves needed by the ratio math (a structural subset of `amm.Pool`). */
export interface PoolReserves {
  base: string;
  quote: string;
  reserveBase: string;
  reserveQuote: string;
}

/**
 * The opposite-side amount that keeps the pool's current ratio, given `amount`
 * of one side. Ported from the web `calculatePoolOppositeAmount` (and identical
 * to the chain's `BalanceProvidedAmounts`: base·reserveQuote/reserveBase, or
 * quote·reserveBase/reserveQuote). Returns a display-precision BigNumber (no
 * truncation, matching the web util); the caller floors to base units when it
 * builds the message. `isBase` = the provided `amount` is the base side.
 */
export function calculatePoolOppositeAmount(
  pool: PoolReserves,
  amount: string | BigNumber,
  isBase: boolean,
): BigNumber {
  const amountBN = toBigNumber(amount);
  if (amountBN.isZero() || amountBN.isNaN()) {
    return toBigNumber(0);
  }

  const reserveBase = toBigNumber(pool.reserveBase);
  const reserveQuote = toBigNumber(pool.reserveQuote);

  if (reserveBase.isZero() || reserveQuote.isZero()) {
    return toBigNumber(0);
  }

  return isBase
    ? amountBN.multipliedBy(reserveQuote).dividedBy(reserveBase)
    : amountBN.multipliedBy(reserveBase).dividedBy(reserveQuote);
}

/**
 * The price of `denom` expressed in the other token, from the pool reserves.
 * Ported from the web `calculatePoolPrice`; null for a denom not in the pool or
 * an empty pool.
 */
export function calculatePoolPrice(denom: string, pool: PoolReserves): BigNumber | null {
  if (!pool || !denom) return null;

  const reserveBase = toBigNumber(pool.reserveBase);
  const reserveQuote = toBigNumber(pool.reserveQuote);
  if (reserveBase.lte(0) || reserveQuote.lte(0)) return null;

  if (denom === pool.base) return reserveQuote.dividedBy(reserveBase);
  if (denom === pool.quote) return reserveBase.dividedBy(reserveQuote);
  return null;
}

/** A user's position in a pool. */
export interface UserPoolData {
  /** Share of the pool 0..100. */
  userSharesPercentage: number;
  /** USD value of the position (0 when the pool has no known USD value). */
  userLiquidityUsd: BigNumber;
}

/**
 * A user's pool position from their LP-share balance and the pool's total share
 * supply, plus the pool's USD value (TVL) for the liquidity figure. Ported from
 * the web `calculateUserPoolData`; both share amounts are raw base units and the
 * math is division-safe (zeros when there is no balance or supply).
 */
export function calculateUserPoolData(
  userShares: NumLike,
  totalShares: NumLike,
  tvlUsd?: BigNumber | null,
): UserPoolData {
  const zero = toBigNumber(0);
  const shares = toBigNumber(userShares);
  const total = toBigNumber(totalShares);
  if (shares.isNaN() || shares.lte(0) || total.isNaN() || total.lte(0)) {
    return { userSharesPercentage: 0, userLiquidityUsd: zero };
  }

  const fraction = shares.dividedBy(total);
  const userSharesPercentage = fraction.multipliedBy(100).toNumber();
  const userLiquidityUsd = tvlUsd && tvlUsd.gt(0) ? fraction.multipliedBy(tvlUsd) : zero;
  return { userSharesPercentage, userLiquidityUsd };
}

/**
 * Expected LP shares minted for a balanced deposit — the chain's mint formula
 * (`mintDepositLpTokens`): `floor( min(base/reserveBase, quote/reserveQuote) ×
 * totalShares )`. All amounts are raw base units; `totalShares` is the LP denom
 * supply. Returns 0 for an empty pool or non-positive inputs.
 */
export function calculateSharesFromAmounts(
  baseAmount: NumLike,
  quoteAmount: NumLike,
  reserveBase: NumLike,
  reserveQuote: NumLike,
  totalShares: NumLike,
): BigNumber {
  const rb = toBigNumber(reserveBase);
  const rq = toBigNumber(reserveQuote);
  const ts = toBigNumber(totalShares);
  if (rb.lte(0) || rq.lte(0) || ts.lte(0)) return toBigNumber(0);

  const baseRatio = toBigNumber(baseAmount).dividedBy(rb);
  const quoteRatio = toBigNumber(quoteAmount).dividedBy(rq);
  const mintRatio = BigNumber.minimum(baseRatio, quoteRatio);
  if (mintRatio.isNaN() || mintRatio.lte(0)) return toBigNumber(0);

  return mintRatio.multipliedBy(ts).integerValue(BigNumber.ROUND_DOWN);
}

/** The base/quote returned when burning `lpTokens` shares. */
export interface RemoveAmounts {
  base: BigNumber;
  quote: BigNumber;
}

/**
 * Base and quote returned for burning `lpTokens` of a pool — the chain's
 * `RemoveLiquidity` payout: `floor(reserve × lpTokens/totalShares)` per side.
 * All amounts are raw base units.
 */
export function calculateRemoveAmounts(
  lpTokens: NumLike,
  totalShares: NumLike,
  reserveBase: NumLike,
  reserveQuote: NumLike,
): RemoveAmounts {
  const ts = toBigNumber(totalShares);
  const lp = toBigNumber(lpTokens);
  if (ts.lte(0) || lp.lte(0)) return { base: toBigNumber(0), quote: toBigNumber(0) };

  const share = lp.dividedBy(ts);
  return {
    base: toBigNumber(reserveBase).multipliedBy(share).integerValue(BigNumber.ROUND_DOWN),
    quote: toBigNumber(reserveQuote).multipliedBy(share).integerValue(BigNumber.ROUND_DOWN),
  };
}

/**
 * Floor a raw base-unit `amount` by a slippage tolerance (percent) → the minimum
 * acceptable amount as an integer string, for `min_lp_tokens` / `min_base` /
 * `min_quote`. Same big-number-safe math as the swap card's `minOutputBase`.
 */
export function minWithSlippage(amount: NumLike, slippagePercent: NumLike): string {
  const a = toBigNumber(amount);
  if (a.isNaN() || a.lte(0)) return "0";
  const multiplier = new BigNumber(1).minus(new BigNumber(slippagePercent).dividedBy(100));
  return a.multipliedBy(multiplier).integerValue(BigNumber.ROUND_DOWN).toFixed(0);
}

/**
 * A pool's annualised return from trading fees, as a percentage. Mirrors the
 * web: daily fees to LPs (`volumeUsd × feeRate × providersFraction`) over TVL,
 * annualised (`×365×100`). 0 for an empty/unpriced pool. All inputs are USD /
 * fractions (feeRate and providersFraction are fractions of 1, e.g. 0.003, 0.8).
 */
export function poolAprPercent(
  volumeUsd: NumLike,
  feeRate: NumLike,
  providersFraction: NumLike,
  tvlUsd: NumLike,
): number {
  const tvl = toBigNumber(tvlUsd);
  if (tvl.isNaN() || tvl.lte(0)) return 0;
  const dailyToLp = toBigNumber(volumeUsd).multipliedBy(feeRate).multipliedBy(providersFraction);
  const apr = dailyToLp.dividedBy(tvl).multipliedBy(365).multipliedBy(100);
  return apr.isNaN() ? 0 : apr.toNumber();
}

/** Fields for an add-liquidity message. All amounts are raw base-unit integers. */
export interface AddLiquidityParams {
  creator: string;
  poolId: string;
  baseAmount: string;
  quoteAmount: string;
  minLpTokens: string;
}

/** Build the `MsgAddLiquidity` proto-JSON (snake_case fields the signing codec decodes). */
export function buildAddLiquidityMsg(p: AddLiquidityParams): ProtoMsg {
  return {
    "@type": TYPE_ADD_LIQUIDITY,
    creator: p.creator,
    pool_id: p.poolId,
    base_amount: p.baseAmount,
    quote_amount: p.quoteAmount,
    min_lp_tokens: p.minLpTokens,
  };
}

/** Fields for a remove-liquidity message. All amounts are raw base-unit integers. */
export interface RemoveLiquidityParams {
  creator: string;
  poolId: string;
  lpTokens: string;
  minBase: string;
  minQuote: string;
}

/** Build the `MsgRemoveLiquidity` proto-JSON (snake_case fields the signing codec decodes). */
export function buildRemoveLiquidityMsg(p: RemoveLiquidityParams): ProtoMsg {
  return {
    "@type": TYPE_REMOVE_LIQUIDITY,
    creator: p.creator,
    pool_id: p.poolId,
    lp_tokens: p.lpTokens,
    min_base: p.minBase,
    min_quote: p.minQuote,
  };
}
