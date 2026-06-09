import { describe, it, expect } from "vitest";
import { isRewardActive } from "./stakingHelpers";

describe("isRewardActive", () => {
  it("active when payouts < duration", () => {
    expect(isRewardActive({ payouts: 189, duration: 381 })).toBe(true);
  });

  it("completed when payouts >= duration", () => {
    expect(isRewardActive({ payouts: 50, duration: 50 })).toBe(false);
    expect(isRewardActive({ payouts: 51, duration: 50 })).toBe(false);
  });

  it("treats a fresh program with undefined payouts (uint32 omitempty) as active", () => {
    // The regression: `undefined < duration` is false, which silently dropped
    // brand-new programs. Coercing through Number(x ?? 0) keeps them active.
    expect(isRewardActive({ duration: 100 })).toBe(true);
    expect(isRewardActive({ payouts: undefined, duration: 100 })).toBe(true);
  });

  it("handles string-encoded values (REST shape)", () => {
    expect(isRewardActive({ payouts: "10", duration: "100" })).toBe(true);
    expect(isRewardActive({ payouts: "100", duration: "100" })).toBe(false);
  });

  it("not active when duration is missing or zero", () => {
    expect(isRewardActive({ payouts: 0, duration: 0 })).toBe(false);
    expect(isRewardActive({})).toBe(false);
  });
});
