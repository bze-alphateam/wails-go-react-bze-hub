import BigNumber from "bignumber.js";
import type { AssetBalance } from "../../hooks/useAssets";
import type { StakingOverview } from "../../utils/stakingTypes";
import { uAmountToBigNumberAmount } from "../../utils/amount";

/**
 * Presentational logic for the asset-detail view, kept pure (no React, no hooks)
 * so it can be unit-tested directly and reused by the AssetDetail component.
 */

/** The chain's native staking/gas token (mirrors Go `assets.NativeDenom`). */
export const NATIVE_DENOM = "ubze";

/**
 * Total ubze a wallet has staked, in raw base units: native delegations plus any
 * ubze-denominated reward-program participations. Mirrors the totals computed in
 * StakingCompact so the detail view agrees with the Earn section. BigInt math —
 * chain amounts routinely exceed Number.MAX_SAFE_INTEGER.
 */
export function stakedUbzeFromOverview(overview: StakingOverview | null | undefined): string {
  if (!overview) return "0";
  let total = 0n;
  for (const d of overview.delegations || []) {
    total += BigInt(d.balance?.amount || "0");
  }
  const rewards = overview.stakingRewards || [];
  for (const p of overview.rewardParticipants || []) {
    const r = rewards.find((x) => x.reward_id === p.reward_id);
    if (r?.staking_denom === NATIVE_DENOM) total += BigInt(p.amount || "0");
  }
  return total.toString();
}

/** One line of the balance breakdown: a labelled amount and its USD value. */
export interface BreakdownRow {
  label: string;
  /** Raw base-unit amount. */
  uAmount: string;
  /** Human (display-unit) amount, big-number-safe. */
  amount: BigNumber;
  /** USD value of this row, or null when the asset has no known price. */
  usd: BigNumber | null;
}

/**
 * The balance-breakdown rows for an asset. Always shows **Available** (the liquid
 * bank balance — `asset.amount`, since delegated tokens leave the bank balance).
 * When a staked base-unit amount is known (the native token, from the staking
 * overview) it adds **Staked** and **Total** rows; otherwise the available balance
 * is the whole story and only that row is returned. USD is null-safe throughout —
 * a priceless asset never shows "$0".
 */
export function balanceBreakdown(
  asset: AssetBalance,
  stakedUAmount: string | null | undefined,
  price: BigNumber | null
): BreakdownRow[] {
  const toUsd = (human: BigNumber): BigNumber | null =>
    price && price.gt(0) ? price.multipliedBy(human) : null;

  const row = (label: string, uAmount: string): BreakdownRow => {
    const amount = uAmountToBigNumberAmount(uAmount, asset.decimals);
    return { label, uAmount, amount, usd: toUsd(amount) };
  };

  const available = row("Available", asset.amount || "0");
  if (stakedUAmount == null) return [available];

  const staked = row("Staked", stakedUAmount || "0");
  const totalU = (BigInt(asset.amount || "0") + BigInt(stakedUAmount || "0")).toString();
  const total = row("Total", totalU);
  return [available, staked, total];
}
