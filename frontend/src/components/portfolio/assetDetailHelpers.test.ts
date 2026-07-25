import { describe, it, expect } from "vitest";
import BigNumber from "bignumber.js";
import type { AssetBalance } from "../../hooks/useAssets";
import type { StakingOverview, StakingReward } from "../../utils/stakingTypes";
import { stakedUbzeFromOverview, balanceBreakdown } from "./assetDetailHelpers";

function asset(over: Partial<AssetBalance>): AssetBalance {
  return {
    denom: "ubze",
    symbol: "BZE",
    name: "BeeZee",
    decimals: 6,
    type: "native",
    verified: true,
    stable: false,
    supply: "1000000",
    amount: "2000000",
    price: "0.0005",
    ...over,
  };
}

describe("stakedUbzeFromOverview", () => {
  it("returns 0 for a null/empty overview", () => {
    expect(stakedUbzeFromOverview(null)).toBe("0");
    expect(stakedUbzeFromOverview({})).toBe("0");
  });

  it("sums native delegation balances", () => {
    const overview: StakingOverview = {
      delegations: [
        { delegation: { delegator_address: "a", validator_address: "v1", shares: "0" }, balance: { denom: "ubze", amount: "1000000" } },
        { delegation: { delegator_address: "a", validator_address: "v2", shares: "0" }, balance: { denom: "ubze", amount: "500000" } },
      ],
    };
    expect(stakedUbzeFromOverview(overview)).toBe("1500000");
  });

  it("adds ubze reward-program participations but ignores non-ubze ones", () => {
    const overview: StakingOverview = {
      delegations: [
        { delegation: { delegator_address: "a", validator_address: "v1", shares: "0" }, balance: { denom: "ubze", amount: "1000000" } },
      ],
      rewardParticipants: [
        { address: "a", reward_id: "r-bze", amount: "300000", joined_at: "0" },
        { address: "a", reward_id: "r-other", amount: "999", joined_at: "0" },
      ],
      stakingRewards: [
        { reward_id: "r-bze", staking_denom: "ubze" },
        { reward_id: "r-other", staking_denom: "uxyz" },
      ] as StakingReward[],
    };
    // 1_000_000 delegated + 300_000 in the ubze program; the uxyz program is skipped.
    expect(stakedUbzeFromOverview(overview)).toBe("1300000");
  });

  it("is big-number safe beyond Number.MAX_SAFE_INTEGER", () => {
    const big = "90071992547409910000"; // > 2^53
    const overview: StakingOverview = {
      delegations: [
        { delegation: { delegator_address: "a", validator_address: "v1", shares: "0" }, balance: { denom: "ubze", amount: big } },
      ],
    };
    expect(stakedUbzeFromOverview(overview)).toBe(big);
  });
});

describe("balanceBreakdown", () => {
  const price = new BigNumber("0.0005");

  it("returns only Available when no staked amount is known", () => {
    const rows = balanceBreakdown(asset({ denom: "uvdl", amount: "5000000", decimals: 6 }), null, null);
    expect(rows.map((r) => r.label)).toEqual(["Available"]);
    expect(rows[0].amount.toString()).toBe("5");
    expect(rows[0].usd).toBeNull();
  });

  it("returns Available / Staked / Total when a staked amount is provided", () => {
    const rows = balanceBreakdown(asset({ amount: "2000000" }), "3000000", price);
    expect(rows.map((r) => r.label)).toEqual(["Available", "Staked", "Total"]);
    expect(rows[0].amount.toString()).toBe("2"); // 2 BZE available
    expect(rows[1].amount.toString()).toBe("3"); // 3 BZE staked
    expect(rows[2].amount.toString()).toBe("5"); // 5 BZE total
  });

  it("computes USD per row from the unit price, null when priceless", () => {
    const rows = balanceBreakdown(asset({ amount: "2000000" }), "3000000", price);
    expect(rows[0].usd?.toString()).toBe("0.001"); // 2 * 0.0005
    expect(rows[2].usd?.toString()).toBe("0.0025"); // 5 * 0.0005

    const noPrice = balanceBreakdown(asset({ amount: "2000000" }), "3000000", null);
    expect(noPrice.every((r) => r.usd === null)).toBe(true);
  });

  it("totals with big-number-safe integer math", () => {
    const rows = balanceBreakdown(
      asset({ amount: "90071992547409910000", decimals: 6 }),
      "10000000000",
      null
    );
    expect(rows[2].uAmount).toBe("90071992557409910000");
  });
});
