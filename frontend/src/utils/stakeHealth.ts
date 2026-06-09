// Stake-health detection for the compact staking view.
//
// An "unhealthy" stake is one that no longer produces revenue. There are two
// kinds, per the product spec:
//
//   1. A native delegation to a validator that stopped earning — the validator
//      is jailed (or has otherwise dropped out of the active/bonded set). This
//      is FIXABLE: we redelegate the stuck amount to a healthy validator chosen
//      by the same scoring rules used for auto-staking (see validatorScoring).
//
//   2. A participation in an x/rewards staking program that has FINISHED
//      (payouts >= duration). No more prize is ever distributed. This is NOT
//      fixable — the user can only start the unlock (MsgExitStaking) or leave
//      the stake in place hoping the creator tops the program up again.
//
// All logic here is pure so it can be unit-tested without a chain or wallet.

import type {
  Validator,
  DelegationResponse,
  StakingReward,
  StakingRewardParticipant,
} from "./stakingTypes";
import { scoreValidators, selectTopValidators } from "./validatorScoring";

export type StakeIssueType = "validator_inactive" | "finished_reward";

/** Why a validator delegation stopped earning. */
export type ValidatorIssueReason = "jailed" | "unbonded" | "unbonding";

export interface StakeIssue {
  type: StakeIssueType;
  /** Human-readable explanation of what is wrong with this stake. */
  message: string;
  /** Affected amount in base units (ubze for native, staking_denom units for rewards). */
  amount: string;
  /** Base denom of the affected amount. */
  denom: string;
  /** Whether the Hub can fix this automatically (true ⇒ show a Fix button). */
  fixable: boolean;

  // validator_inactive only
  reason?: ValidatorIssueReason;
  srcValidator?: string;
  srcMoniker?: string;
  /** Healthy validator chosen to redelegate into (only set when fixable). */
  dstValidator?: string;
  dstMoniker?: string;

  // finished_reward only
  rewardId?: string;
  /** Lock period in days that applies after exiting (unlock delay). */
  lockDays?: number;
}

export interface StakeHealth {
  status: "healthy" | "warning";
  issues: StakeIssue[];
}

/** True when a validator is currently earning (bonded and not jailed). */
export function isValidatorHealthy(v: Validator): boolean {
  return !v.jailed && v.status === "BOND_STATUS_BONDED";
}

function validatorIssueReason(v: Validator): ValidatorIssueReason {
  if (v.jailed) return "jailed";
  if (v.status === "BOND_STATUS_UNBONDING") return "unbonding";
  return "unbonded";
}

function reasonMessage(moniker: string, reason: ValidatorIssueReason): string {
  switch (reason) {
    case "jailed":
      return `Your stake with ${moniker} stopped earning — the validator is jailed.`;
    case "unbonding":
      return `Your stake with ${moniker} stopped earning — the validator is leaving the active set.`;
    case "unbonded":
      return `Your stake with ${moniker} stopped earning — the validator is inactive (out of the active set).`;
  }
}

/**
 * Pick the single best healthy validator to redelegate into, using the shared
 * scoring rules (lowest voting power wins, for decentralization). Excludes the
 * given source address. Returns null if no healthy validator is available.
 */
export function pickFixValidator(
  validators: Validator[],
  excludeAddr?: string
): { operatorAddress: string; moniker: string } | null {
  const scores = scoreValidators(validators).filter(
    (s) => s.operatorAddress !== excludeAddr
  );
  const top = selectTopValidators(scores, 1);
  if (top.length === 0) return null;
  return { operatorAddress: top[0].operatorAddress, moniker: top[0].moniker };
}

export interface ComputeStakeHealthParams {
  delegations: DelegationResponse[];
  /** Full validator objects for the validators the user delegated to (incl. jailed). */
  delegatedValidators: Validator[];
  /** Bonded validators — the pool of candidates to redelegate into. */
  bondedValidators: Validator[];
  rewardParticipants: StakingRewardParticipant[];
  stakingRewards: StakingReward[];
}

/**
 * Inspect every native delegation and reward participation and return the list
 * of stake-health issues (empty ⇒ healthy).
 */
export function computeStakeHealth({
  delegations,
  delegatedValidators,
  bondedValidators,
  rewardParticipants,
  stakingRewards,
}: ComputeStakeHealthParams): StakeHealth {
  const issues: StakeIssue[] = [];

  const valByAddr = new Map<string, Validator>();
  for (const v of delegatedValidators) {
    valByAddr.set(v.operator_address, v);
  }

  // 1. Native delegations on validators that stopped earning.
  for (const del of delegations) {
    const addr = del.delegation.validator_address;
    const amount = del.balance?.amount || "0";
    if (BigInt(amount) <= 0n) continue;

    const v = valByAddr.get(addr);
    // If we can't resolve the validator, assume it's still bonded (don't false-alarm).
    if (!v || isValidatorHealthy(v)) continue;

    const reason = validatorIssueReason(v);
    const moniker = v.description?.moniker || addr;
    const fix = pickFixValidator(bondedValidators, addr);

    issues.push({
      type: "validator_inactive",
      reason,
      message: reasonMessage(moniker, reason),
      amount,
      denom: "ubze",
      fixable: fix !== null,
      srcValidator: addr,
      srcMoniker: moniker,
      dstValidator: fix?.operatorAddress,
      dstMoniker: fix?.moniker,
    });
  }

  // 2. Reward participations in finished programs.
  const rewardById = new Map<string, StakingReward>();
  for (const r of stakingRewards) {
    rewardById.set(r.reward_id, r);
  }

  for (const p of rewardParticipants) {
    if (BigInt(p.amount || "0") <= 0n) continue;
    const reward = rewardById.get(p.reward_id);
    // A participation whose reward is absent has been removed (fully finished).
    const finished = !reward || reward.payouts >= reward.duration;
    if (!finished) continue;

    issues.push({
      type: "finished_reward",
      message:
        "A staking reward you joined has ended — it no longer pays out. You can start the unlock or wait in case it is topped up.",
      amount: p.amount,
      denom: reward?.staking_denom || "ubze",
      fixable: false,
      rewardId: p.reward_id,
      lockDays: reward?.lock ?? 0,
    });
  }

  return {
    status: issues.length > 0 ? "warning" : "healthy",
    issues,
  };
}
