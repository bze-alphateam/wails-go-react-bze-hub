import { describe, it, expect } from "vitest";
import {
  scoreValidators,
  selectTopValidators,
  splitDelegation,
  getDefaultScoringConfig,
} from "./validatorScoring";
import type { Validator } from "./stakingTypes";

/** Minimal validator factory; bonded + not jailed unless overridden. */
function val(
  addr: string,
  opts: { tokens?: string; commission?: string; jailed?: boolean; status?: string } = {}
): Validator {
  return {
    operator_address: addr,
    consensus_pubkey: { "@type": "", key: "" },
    jailed: opts.jailed ?? false,
    status: opts.status ?? "BOND_STATUS_BONDED",
    tokens: opts.tokens ?? "1000000",
    delegator_shares: "0",
    description: {
      moniker: addr,
      identity: "",
      website: "",
      security_contact: "",
      details: "",
    },
    unbonding_height: "0",
    unbonding_time: "",
    commission: {
      commission_rates: {
        rate: opts.commission ?? "0.05",
        max_rate: "0.2",
        max_change_rate: "0.01",
      },
      update_time: "",
    },
    min_self_delegation: "1",
  };
}

const addrs = (scores: { operatorAddress: string }[]) => scores.map((s) => s.operatorAddress);

describe("scoreValidators — eligibility", () => {
  it("excludes jailed and non-bonded validators", () => {
    const out = scoreValidators([
      val("ok"),
      val("jailed", { jailed: true }),
      val("unbonding", { status: "BOND_STATUS_UNBONDING" }),
      val("unbonded", { status: "BOND_STATUS_UNBONDED" }),
    ]);
    expect(addrs(out)).toEqual(["ok"]);
  });

  it("returns [] when nothing is eligible", () => {
    expect(scoreValidators([val("j", { jailed: true })])).toEqual([]);
  });

  it("excludes validators above maxCommission", () => {
    const out = scoreValidators([
      val("fair", { commission: "0.10" }),
      val("greedy", { commission: "0.90" }), // > 0.5 default cap
    ]);
    expect(addrs(out)).toEqual(["fair"]);
  });

  it("falls back to all active when every validator is above the cap", () => {
    const out = scoreValidators([
      val("a", { commission: "0.80" }),
      val("b", { commission: "0.60" }),
    ]);
    // Neither excluded (fallback), cheaper one wins.
    expect(addrs(out)).toEqual(["b", "a"]);
  });
});

describe("scoreValidators — decentralization (equal commission)", () => {
  it("ranks smaller validators higher when commission is equal", () => {
    const out = scoreValidators([
      val("big", { tokens: "9000000" }),
      val("small", { tokens: "10" }),
      val("mid", { tokens: "500000" }),
    ]);
    expect(addrs(out)).toEqual(["small", "mid", "big"]);
  });

  it("treats near-equal commissions (<1% apart) as neutral → size decides", () => {
    const out = scoreValidators([
      val("small", { tokens: "10", commission: "0.052" }),
      val("big", { tokens: "9000000", commission: "0.050" }),
    ]);
    // Despite big being very slightly cheaper, the gap is < neutral range, so
    // commission is neutral and the smaller validator wins.
    expect(addrs(out)[0]).toBe("small");
  });
});

describe("scoreValidators — commission pondering", () => {
  it("a meaningfully cheaper mid-size validator beats a tiny expensive one", () => {
    // small: tiny but 25% commission; cheap: bigger but 2% commission.
    const out = scoreValidators([
      val("small", { tokens: "10", commission: "0.25" }),
      val("cheap", { tokens: "500000", commission: "0.02" }),
      val("big", { tokens: "9000000", commission: "0.10" }),
    ]);
    expect(addrs(out)[0]).toBe("cheap");
  });

  it("commissionScore is min-max normalized across the set", () => {
    const out = scoreValidators([
      val("cheapest", { tokens: "100", commission: "0.05" }),
      val("dearest", { tokens: "200", commission: "0.25" }),
    ]);
    const cheapest = out.find((s) => s.operatorAddress === "cheapest")!;
    const dearest = out.find((s) => s.operatorAddress === "dearest")!;
    expect(cheapest.commissionScore).toBeCloseTo(1, 5);
    expect(dearest.commissionScore).toBeCloseTo(0, 5);
  });
});

describe("scoreValidators — custom multipliers", () => {
  it("applies a per-validator multiplier to the final score", () => {
    const cfg = getDefaultScoringConfig();
    cfg.customMultipliers = { boosted: 5 };
    const out = scoreValidators(
      [val("boosted", { tokens: "9000000" }), val("normal", { tokens: "10" })],
      cfg
    );
    // 'normal' would win on size, but the 5× boost lifts 'boosted' above it.
    expect(addrs(out)[0]).toBe("boosted");
  });
});

describe("selectTopValidators", () => {
  it("defaults to topN=3", () => {
    expect(getDefaultScoringConfig().topN).toBe(3);
    const scores = scoreValidators([
      val("a", { tokens: "1" }),
      val("b", { tokens: "2" }),
      val("c", { tokens: "3" }),
      val("d", { tokens: "4" }),
    ]);
    expect(selectTopValidators(scores)).toHaveLength(3);
  });

  it("honors an explicit n", () => {
    const scores = scoreValidators([val("a"), val("b", { tokens: "2" })]);
    expect(selectTopValidators(scores, 1)).toHaveLength(1);
  });
});

describe("splitDelegation", () => {
  it("splits equally with the remainder on the first validator", () => {
    const scores = scoreValidators([
      val("a", { tokens: "1" }),
      val("b", { tokens: "2" }),
      val("c", { tokens: "3" }),
    ]);
    const top = selectTopValidators(scores, 3);
    const splits = splitDelegation("1000000", top);
    const sum = splits.reduce((acc, s) => acc + BigInt(s.amount), 0n);
    expect(sum).toBe(1000000n);
    // 1000000 / 3 = 333333 r1 → first gets 333334
    expect(splits[0].amount).toBe("333334");
    expect(splits[1].amount).toBe("333333");
    expect(splits[2].amount).toBe("333333");
  });

  it("returns [] for no validators", () => {
    expect(splitDelegation("100", [])).toEqual([]);
  });
});
