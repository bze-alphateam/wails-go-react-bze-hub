import { describe, it, expect } from "vitest";
import {
  computeStakeHealth,
  pickFixValidator,
  isValidatorHealthy,
} from "./stakeHealth";
import type {
  Validator,
  DelegationResponse,
  StakingReward,
  StakingRewardParticipant,
} from "./stakingTypes";

// --- fixtures -------------------------------------------------------------

function val(
  addr: string,
  opts: Partial<Validator> & { moniker?: string; tokens?: string } = {}
): Validator {
  return {
    operator_address: addr,
    consensus_pubkey: { "@type": "", key: "" },
    jailed: opts.jailed ?? false,
    status: opts.status ?? "BOND_STATUS_BONDED",
    tokens: opts.tokens ?? "1000000",
    delegator_shares: "0",
    description: {
      moniker: opts.moniker ?? addr,
      identity: "",
      website: "",
      security_contact: "",
      details: "",
    },
    unbonding_height: "0",
    unbonding_time: "",
    commission: {
      commission_rates: { rate: "0.05", max_rate: "0.2", max_change_rate: "0.01" },
      update_time: "",
    },
    min_self_delegation: "1",
  };
}

function del(validatorAddr: string, amount: string): DelegationResponse {
  return {
    delegation: {
      delegator_address: "bze1me",
      validator_address: validatorAddr,
      shares: amount,
    },
    balance: { denom: "ubze", amount },
  };
}

function reward(id: string, opts: Partial<StakingReward> = {}): StakingReward {
  return {
    reward_id: id,
    prize_amount: opts.prize_amount ?? "100",
    prize_denom: opts.prize_denom ?? "ubze",
    staking_denom: opts.staking_denom ?? "ubze",
    duration: opts.duration ?? 30,
    payouts: opts.payouts ?? 0,
    min_stake: opts.min_stake ?? "0",
    lock: opts.lock ?? 0,
    staked_amount: opts.staked_amount ?? "1000000",
    distributed_stake: opts.distributed_stake ?? "0",
  };
}

function participant(rewardId: string, amount: string): StakingRewardParticipant {
  return { address: "bze1me", reward_id: rewardId, amount, joined_at: "0" };
}

// --- isValidatorHealthy ---------------------------------------------------

describe("isValidatorHealthy", () => {
  it("is healthy when bonded and not jailed", () => {
    expect(isValidatorHealthy(val("v1"))).toBe(true);
  });
  it("is unhealthy when jailed", () => {
    expect(isValidatorHealthy(val("v1", { jailed: true }))).toBe(false);
  });
  it("is unhealthy when not bonded", () => {
    expect(isValidatorHealthy(val("v1", { status: "BOND_STATUS_UNBONDED" }))).toBe(false);
  });
});

// --- pickFixValidator -----------------------------------------------------

describe("pickFixValidator", () => {
  it("picks the lowest-voting-power healthy validator", () => {
    const pool = [
      val("big", { tokens: "9000000" }),
      val("small", { tokens: "10" }),
      val("mid", { tokens: "500000" }),
    ];
    const pick = pickFixValidator(pool);
    expect(pick?.operatorAddress).toBe("small");
  });

  it("excludes the source validator and skips jailed/unbonded", () => {
    const pool = [
      val("src", { tokens: "1", jailed: true }),
      val("healthy", { tokens: "5" }),
    ];
    const pick = pickFixValidator(pool, "src");
    expect(pick?.operatorAddress).toBe("healthy");
  });

  it("returns null when no healthy validator exists", () => {
    const pool = [val("a", { jailed: true }), val("b", { status: "BOND_STATUS_UNBONDED" })];
    expect(pickFixValidator(pool)).toBeNull();
  });
});

// --- computeStakeHealth ---------------------------------------------------

describe("computeStakeHealth", () => {
  it("reports healthy when all delegations are bonded and rewards active", () => {
    const health = computeStakeHealth({
      delegations: [del("v1", "1000000")],
      delegatedValidators: [val("v1")],
      bondedValidators: [val("v1")],
      rewardParticipants: [participant("r1", "500000")],
      stakingRewards: [reward("r1", { payouts: 5, duration: 30 })],
    });
    expect(health.status).toBe("healthy");
    expect(health.issues).toHaveLength(0);
  });

  it("flags a jailed-validator delegation as fixable and picks a target", () => {
    const health = computeStakeHealth({
      delegations: [del("jailedVal", "2000000")],
      delegatedValidators: [val("jailedVal", { jailed: true, status: "BOND_STATUS_UNBONDED" })],
      bondedValidators: [val("healthy", { tokens: "10" })],
      rewardParticipants: [],
      stakingRewards: [],
    });
    expect(health.status).toBe("warning");
    expect(health.issues).toHaveLength(1);
    const issue = health.issues[0];
    expect(issue.type).toBe("validator_inactive");
    expect(issue.reason).toBe("jailed");
    expect(issue.fixable).toBe(true);
    expect(issue.srcValidator).toBe("jailedVal");
    expect(issue.dstValidator).toBe("healthy");
    expect(issue.amount).toBe("2000000");
  });

  it("flags a jailed delegation as NOT fixable when no healthy validator exists", () => {
    const health = computeStakeHealth({
      delegations: [del("jailedVal", "2000000")],
      delegatedValidators: [val("jailedVal", { jailed: true })],
      bondedValidators: [val("jailedVal", { jailed: true })],
      rewardParticipants: [],
      stakingRewards: [],
    });
    expect(health.issues[0].fixable).toBe(false);
    expect(health.issues[0].dstValidator).toBeUndefined();
  });

  it("flags a finished reward as not fixable with its lock period", () => {
    const health = computeStakeHealth({
      delegations: [],
      delegatedValidators: [],
      bondedValidators: [],
      rewardParticipants: [participant("r1", "750000")],
      stakingRewards: [reward("r1", { payouts: 30, duration: 30, lock: 7, staking_denom: "ubze" })],
    });
    expect(health.status).toBe("warning");
    expect(health.issues[0].type).toBe("finished_reward");
    expect(health.issues[0].fixable).toBe(false);
    expect(health.issues[0].rewardId).toBe("r1");
    expect(health.issues[0].lockDays).toBe(7);
    expect(health.issues[0].amount).toBe("750000");
  });

  it("treats a participation whose reward was removed as finished", () => {
    const health = computeStakeHealth({
      delegations: [],
      delegatedValidators: [],
      bondedValidators: [],
      rewardParticipants: [participant("gone", "100")],
      stakingRewards: [],
    });
    expect(health.issues).toHaveLength(1);
    expect(health.issues[0].type).toBe("finished_reward");
  });

  it("ignores zero-amount delegations and participations", () => {
    const health = computeStakeHealth({
      delegations: [del("jailedVal", "0")],
      delegatedValidators: [val("jailedVal", { jailed: true })],
      bondedValidators: [val("healthy")],
      rewardParticipants: [participant("r1", "0")],
      stakingRewards: [reward("r1", { payouts: 30, duration: 30 })],
    });
    expect(health.status).toBe("healthy");
  });

  it("does not false-alarm when the delegated validator is unresolved", () => {
    const health = computeStakeHealth({
      delegations: [del("unknown", "1000000")],
      delegatedValidators: [], // validator object missing
      bondedValidators: [val("healthy")],
      rewardParticipants: [],
      stakingRewards: [],
    });
    expect(health.status).toBe("healthy");
  });

  it("collects multiple issues together", () => {
    const health = computeStakeHealth({
      delegations: [del("jailedVal", "1000000"), del("good", "1000000")],
      delegatedValidators: [val("jailedVal", { jailed: true }), val("good")],
      bondedValidators: [val("good", { tokens: "10" })],
      rewardParticipants: [participant("r1", "500000")],
      stakingRewards: [reward("r1", { payouts: 30, duration: 30 })],
    });
    expect(health.issues).toHaveLength(2);
    expect(health.issues.map((i) => i.type).sort()).toEqual([
      "finished_reward",
      "validator_inactive",
    ]);
  });
});
