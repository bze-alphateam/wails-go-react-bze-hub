// Validator scoring for auto-delegation in the compact staking view.
//
// The compact view never asks the user to pick a validator, so this module
// decides "who deserves the stake". It is intentionally a small, explainable
// weighted model — not a black box — and isolated so factors/weights can be
// tuned or fetched from a remote config later.
//
// Scoring is a weighted blend of normalized factors, each in [0, 1] (1 = best),
// both judged RELATIVE to the current eligible set so the weights are directly
// comparable ("commission counts 1.5× as much as size"):
//
//   • commission  — min-max across the set: cheapest validator → 1, dearest → 0.
//     A guard keeps it neutral when commissions are all within ~1% (everyone
//     gets 1), so it only swings the result when commissions genuinely differ.
//     Commission is the only factor that affects the user's actual returns.
//   • votingPower — rank-based: smallest bonded validator → 1, largest → 0.
//     There's no absolute "right" size, so it's judged relative to the set.
//     Serves decentralization/resilience; it does NOT affect APR (rewards are
//     proportional to stake, net of commission, regardless of validator size).
//
// A hard `maxCommission` filter removes extractive validators outright, with a
// fallback so the set can never end up empty.

import type { Validator } from "./stakingTypes";

/** If every eligible validator's commission is within this band, commission is
 *  treated as a non-factor (all score 1) and decentralization decides. */
const COMMISSION_NEUTRAL_RANGE = 0.01; // 1 percentage point

export interface ScoringWeights {
  /** Weight for reward retention (lower commission is better). */
  commission: number;
  /** Weight for decentralization (smaller validator is better). */
  votingPower: number;
}

export interface ValidatorScore {
  operatorAddress: string;
  moniker: string;
  tokens: string;
  /** Commission rate as a fraction, e.g. 0.05 for 5%. */
  commissionRate: number;
  /** Normalized commission sub-score in [0, 1] (1 = cheapest in the set). */
  commissionScore: number;
  /** Normalized voting-power sub-score in [0, 1] (1 = smallest validator). */
  votingPowerScore: number;
  /** Final weighted score (× any custom multiplier). Higher is better. */
  score: number;
}

export interface ScoringConfig {
  /** Relative factor weights. Need not sum to 1 — normalized internally. */
  weights: ScoringWeights;
  /** Validators charging strictly more than this fraction are excluded
   *  (with a fallback to the full set if the filter would empty it). */
  maxCommission: number;
  /** Per-validator multiplier overrides (operatorAddress → multiplier),
   *  applied to the final score. Reserved for a future remote scoring config. */
  customMultipliers: Record<string, number>;
  /** Number of top validators to select for auto-delegation. */
  topN: number;
}

export interface DelegationSplit {
  validatorAddress: string;
  moniker: string;
  amount: string; // ubze
}

/**
 * Default scoring configuration. Commission is weighted higher than
 * decentralization because it's the only factor that actually changes the
 * user's returns; size is a softer, decentralization-oriented tiebreaker.
 * In the future this could be fetched from a remote config endpoint.
 */
export function getDefaultScoringConfig(): ScoringConfig {
  return {
    weights: { commission: 0.6, votingPower: 0.4 },
    maxCommission: 0.5,
    customMultipliers: {},
    topN: 3,
  };
}

function commissionRate(v: Validator): number {
  const r = parseFloat(v.commission?.commission_rates?.rate ?? "");
  return isNaN(r) ? 1 : r; // missing/garbage commission → treat as worst (100%)
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Ascending comparator on integer token strings (BigInt-precise). */
function compareTokensAsc(a: string, b: string): number {
  try {
    const ta = BigInt(a || "0");
    const tb = BigInt(b || "0");
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  } catch {
    return (parseFloat(a) || 0) - (parseFloat(b) || 0);
  }
}

/**
 * Score the eligible validators with the weighted model described above.
 * Eligibility: bonded, not jailed, commission ≤ maxCommission (with fallback).
 * Returns the scored list sorted best-first.
 */
export function scoreValidators(
  validators: Validator[],
  config: ScoringConfig = getDefaultScoringConfig()
): ValidatorScore[] {
  // 1. Eligibility — must be actively earning.
  const active = validators.filter(
    (v) => v.status === "BOND_STATUS_BONDED" && !v.jailed
  );

  // Commission hard filter, but never empty the set: if every active validator
  // is above the cap, fall back to all active ones (the weight still favors the
  // cheaper ones).
  const withinCap = active.filter((v) => commissionRate(v) <= config.maxCommission);
  const eligible = withinCap.length > 0 ? withinCap : active;
  if (eligible.length === 0) return [];

  // 2. Voting-power sub-score — rank-based, smallest validator = 1, largest = 0.
  const byTokensAsc = [...eligible].sort((a, b) =>
    compareTokensAsc(a.tokens, b.tokens)
  );
  const n = eligible.length;
  const vpScoreByAddr = new Map<string, number>();
  byTokensAsc.forEach((v, i) => {
    vpScoreByAddr.set(v.operator_address, n === 1 ? 1 : 1 - i / (n - 1));
  });

  // Commission sub-score — min-max across the set (cheapest = 1, dearest = 0).
  // When the whole set is within COMMISSION_NEUTRAL_RANGE, treat commission as a
  // non-factor (everyone = 1) so it doesn't nitpick near-identical rates — let
  // decentralization decide instead.
  const rates = eligible.map(commissionRate);
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);
  const rateRange = maxRate - minRate;
  const commissionScoreFor = (rate: number): number =>
    rateRange < COMMISSION_NEUTRAL_RANGE ? 1 : (maxRate - rate) / rateRange;

  // 3. Weighted blend.
  const wc = config.weights.commission;
  const wv = config.weights.votingPower;
  const wSum = wc + wv || 1;

  const scored = eligible.map((v) => {
    const rate = commissionRate(v);
    const commissionScore = clamp01(commissionScoreFor(rate));
    const votingPowerScore = vpScoreByAddr.get(v.operator_address) ?? 0;
    const base = (wc * commissionScore + wv * votingPowerScore) / wSum;
    const multiplier =
      config.customMultipliers[v.operator_address] ?? 1;

    return {
      operatorAddress: v.operator_address,
      moniker: v.description.moniker,
      tokens: v.tokens,
      commissionRate: rate,
      commissionScore,
      votingPowerScore,
      score: base * multiplier,
    };
  });

  // 4. Best first; deterministic tiebreak: smaller validator, then moniker.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      compareTokensAsc(a.tokens, b.tokens) ||
      a.moniker.localeCompare(b.moniker)
  );

  return scored;
}

/**
 * Select the top N validators by score.
 */
export function selectTopValidators(
  scores: ValidatorScore[],
  n?: number
): ValidatorScore[] {
  const topN = n ?? getDefaultScoringConfig().topN;
  return scores.slice(0, topN);
}

/**
 * Split a delegation amount equally across selected validators.
 * Remainder goes to the first validator.
 *
 * @param ubzeAmount - Total amount in ubze to delegate
 * @param validators - Selected validators to split across
 * @returns Array of delegation splits with amounts in ubze
 */
export function splitDelegation(
  ubzeAmount: string,
  validators: ValidatorScore[]
): DelegationSplit[] {
  if (validators.length === 0) return [];

  const total = BigInt(ubzeAmount);
  const count = BigInt(validators.length);
  const perValidator = total / count;
  const remainder = total % count;

  return validators.map((v, i) => ({
    validatorAddress: v.operatorAddress,
    moniker: v.moniker,
    amount: (perValidator + (i === 0 ? remainder : 0n)).toString(),
  }));
}
