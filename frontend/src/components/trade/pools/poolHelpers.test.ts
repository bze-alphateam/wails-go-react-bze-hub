import { describe, it, expect } from "vitest";
import BigNumber from "bignumber.js";
import {
  calculatePoolOppositeAmount,
  calculatePoolPrice,
  calculateUserPoolData,
  calculateSharesFromAmounts,
  calculateRemoveAmounts,
  minWithSlippage,
  createPoolId,
  poolAprPercent,
  buildAddLiquidityMsg,
  buildRemoveLiquidityMsg,
  TYPE_ADD_LIQUIDITY,
  TYPE_REMOVE_LIQUIDITY,
  type PoolReserves,
} from "./poolHelpers";

// Same fixture as the web's liquidity_pool.test.ts, adapted to the hub's
// camelCase pool shape — expectations are identical (web parity).
const pool: PoolReserves = {
  base: "ubze",
  quote: "uusdt",
  reserveBase: "1000",
  reserveQuote: "2000",
};

describe("calculatePoolOppositeAmount (web parity)", () => {
  it("computes quote amount from base amount using the reserves ratio", () => {
    expect(calculatePoolOppositeAmount(pool, "10", true).toString()).toBe("20");
  });
  it("computes base amount from quote amount", () => {
    expect(calculatePoolOppositeAmount(pool, "20", false).toString()).toBe("10");
  });
  it("returns 0 for zero or invalid amounts", () => {
    expect(calculatePoolOppositeAmount(pool, "0", true).toString()).toBe("0");
    expect(calculatePoolOppositeAmount(pool, "garbage", true).toString()).toBe("0");
  });
  it("returns 0 when a reserve is empty", () => {
    expect(calculatePoolOppositeAmount({ ...pool, reserveBase: "0" }, "10", true).toString()).toBe("0");
  });
});

describe("calculatePoolPrice (web parity)", () => {
  it("prices the base denom in quote units", () => {
    expect(calculatePoolPrice("ubze", pool)?.toString()).toBe("2");
  });
  it("prices the quote denom in base units", () => {
    expect(calculatePoolPrice("uusdt", pool)?.toString()).toBe("0.5");
  });
  it("returns null for a denom not in the pool", () => {
    expect(calculatePoolPrice("uatom", pool)).toBeNull();
  });
  it("returns null for empty reserves or missing input", () => {
    expect(calculatePoolPrice("ubze", { ...pool, reserveQuote: "0" })).toBeNull();
    expect(calculatePoolPrice("", pool)).toBeNull();
  });
});

describe("calculateUserPoolData (web parity)", () => {
  it("computes share percentage and USD value", () => {
    const r = calculateUserPoolData("100", "1000", new BigNumber(500));
    expect(r.userSharesPercentage).toBe(10);
    expect(r.userLiquidityUsd.toString()).toBe("50");
  });
  it("returns zeros when the user has no balance", () => {
    const r = calculateUserPoolData("0", "1000", new BigNumber(500));
    expect(r.userSharesPercentage).toBe(0);
    expect(r.userLiquidityUsd.isZero()).toBe(true);
  });
  it("returns zeros when total supply is zero (no division by zero)", () => {
    const r = calculateUserPoolData("100", "0", new BigNumber(500));
    expect(r.userSharesPercentage).toBe(0);
    expect(r.userLiquidityUsd.isZero()).toBe(true);
  });
  it("computes share percentage without USD value when TVL is missing", () => {
    const r = calculateUserPoolData("100", "1000", null);
    expect(r.userSharesPercentage).toBe(10);
    expect(r.userLiquidityUsd.isZero()).toBe(true);
  });
});

describe("calculateSharesFromAmounts (chain mint parity)", () => {
  it("mints min(base/reserveBase, quote/reserveQuote) × totalShares, floored", () => {
    // balanced: 100/1000 == 200/2000 == 0.1 → 0.1 × 1000 = 100
    expect(calculateSharesFromAmounts("100", "200", "1000", "2000", "1000").toString()).toBe("100");
  });
  it("uses the smaller ratio when the deposit is unbalanced", () => {
    // base 0.1, quote 0.05 → min 0.05 × 1000 = 50
    expect(calculateSharesFromAmounts("100", "100", "1000", "2000", "1000").toString()).toBe("50");
  });
  it("floors fractional shares", () => {
    // 1/3 × 1000 = 333.33 → 333
    expect(calculateSharesFromAmounts("1", "2", "3", "6", "1000").toString()).toBe("333");
  });
  it("returns 0 for an empty pool or zero supply", () => {
    expect(calculateSharesFromAmounts("100", "200", "0", "2000", "1000").toString()).toBe("0");
    expect(calculateSharesFromAmounts("100", "200", "1000", "2000", "0").toString()).toBe("0");
  });
});

describe("calculateRemoveAmounts (chain payout parity)", () => {
  it("returns reserves × lpTokens/totalShares per side, floored", () => {
    const out = calculateRemoveAmounts("100", "1000", "1000", "2000");
    expect(out.base.toString()).toBe("100");
    expect(out.quote.toString()).toBe("200");
  });
  it("floors each side", () => {
    const out = calculateRemoveAmounts("1", "3", "1000", "2000");
    expect(out.base.toString()).toBe("333");
    expect(out.quote.toString()).toBe("666");
  });
  it("returns zeros for zero shares or empty supply", () => {
    expect(calculateRemoveAmounts("0", "1000", "1000", "2000").base.isZero()).toBe(true);
    expect(calculateRemoveAmounts("100", "0", "1000", "2000").quote.isZero()).toBe(true);
  });
});

describe("minWithSlippage", () => {
  it("floors the amount by the slippage tolerance", () => {
    expect(minWithSlippage("1000", 0.5)).toBe("995");
    expect(minWithSlippage("1000", 1)).toBe("990");
    expect(minWithSlippage("1000", 3)).toBe("970");
  });
  it("returns 0 for non-positive or invalid amounts", () => {
    expect(minWithSlippage("0", 1)).toBe("0");
    expect(minWithSlippage("garbage", 1)).toBe("0");
  });
});

describe("createPoolId", () => {
  it("sorts denoms so orientation does not matter", () => {
    expect(createPoolId("ubze", "uusdt")).toBe("ubze_uusdt");
    expect(createPoolId("uusdt", "ubze")).toBe("ubze_uusdt");
  });
});

describe("poolAprPercent", () => {
  it("annualises daily LP fees over TVL", () => {
    // volume 10000 × fee 0.01 × providers 1 = 100/day; 100/36500 × 365 × 100 = 100%
    expect(poolAprPercent("10000", "0.01", "1", "36500")).toBeCloseTo(100, 6);
  });
  it("scales down by the providers fraction", () => {
    expect(poolAprPercent("10000", "0.01", "0.5", "36500")).toBeCloseTo(50, 6);
  });
  it("is 0 when TVL is zero or unknown", () => {
    expect(poolAprPercent("10000", "0.01", "1", "0")).toBe(0);
  });
});

describe("message builders (proto-JSON shapes)", () => {
  it("builds MsgAddLiquidity with snake_case fields", () => {
    expect(
      buildAddLiquidityMsg({
        creator: "bze1abc",
        poolId: "ubze/uusdt",
        baseAmount: "1000",
        quoteAmount: "2000",
        minLpTokens: "990",
      }),
    ).toEqual({
      "@type": TYPE_ADD_LIQUIDITY,
      creator: "bze1abc",
      pool_id: "ubze/uusdt",
      base_amount: "1000",
      quote_amount: "2000",
      min_lp_tokens: "990",
    });
  });

  it("builds MsgRemoveLiquidity with snake_case fields", () => {
    expect(
      buildRemoveLiquidityMsg({
        creator: "bze1abc",
        poolId: "ubze/uusdt",
        lpTokens: "500",
        minBase: "495",
        minQuote: "990",
      }),
    ).toEqual({
      "@type": TYPE_REMOVE_LIQUIDITY,
      creator: "bze1abc",
      pool_id: "ubze/uusdt",
      lp_tokens: "500",
      min_base: "495",
      min_quote: "990",
    });
  });
});
