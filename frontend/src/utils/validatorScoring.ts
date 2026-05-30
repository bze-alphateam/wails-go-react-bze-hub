// Validator scoring system for auto-delegation in simple staking view.
//
// The scoring logic is intentionally isolated so it can be extended later
// (e.g., fetching a remote scoring config with per-validator multipliers).

import type { Validator } from "./stakingTypes";

export interface ValidatorScore {
  operatorAddress: string;
  moniker: string;
  tokens: string;
  score: number;
}

export interface ScoringConfig {
  /** Default multiplier applied to all validators. */
  defaultMultiplier: number;
  /** Per-validator multiplier overrides (operatorAddress → multiplier). */
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
 * Returns the default scoring configuration.
 * In the future, this could be fetched from a remote config endpoint.
 */
export function getDefaultScoringConfig(): ScoringConfig {
  return {
    defaultMultiplier: 1.0,
    customMultipliers: {},
    topN: 3,
  };
}

/**
 * Score validators based on the scoring rules.
 * Current rule: active (bonded) validators with lower voting power get higher scores.
 * Score = (1 / votingPower) * multiplier
 *
 * @param validators - List of validators from the chain
 * @param config - Scoring configuration (defaults to getDefaultScoringConfig())
 * @returns Sorted array of scored validators (highest score first)
 */
export function scoreValidators(
  validators: Validator[],
  config: ScoringConfig = getDefaultScoringConfig()
): ValidatorScore[] {
  const bonded = validators.filter(
    (v) => v.status === "BOND_STATUS_BONDED" && !v.jailed
  );

  const scored = bonded.map((v) => {
    const tokens = parseFloat(v.tokens) || 1;
    const multiplier =
      config.customMultipliers[v.operator_address] ?? config.defaultMultiplier;
    const score = (1 / tokens) * multiplier;

    return {
      operatorAddress: v.operator_address,
      moniker: v.description.moniker,
      tokens: v.tokens,
      score,
    };
  });

  // Sort descending by score (lowest VP = highest score)
  scored.sort((a, b) => b.score - a.score);

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
