import { describe, it, expect } from "vitest";
import type { AssetBalance } from "../../hooks/useAssets";
import {
  filterAssets,
  sortAssetsForPicker,
  hasConnectingPath,
  parseAmountToBase,
  minOutputBase,
  isValidSlippage,
  sanitizeAmountInput,
  resolveSwapIssue,
  swapIssueMessage,
  priceImpactPalette,
  type PoolLike,
} from "./swapHelpers";

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
    amount: "0",
    price: "",
    ...over,
  };
}

const pool = (base: string, quote: string): PoolLike => ({ base, quote });

describe("filterAssets", () => {
  const assets = [
    asset({ denom: "ubze", symbol: "BZE", name: "BeeZee" }),
    asset({ denom: "uvdl", symbol: "VDL", name: "Vidulum" }),
    asset({ denom: "uxyz", symbol: "XYZ", name: "Example Coin" }),
  ];

  it("returns everything for an empty query", () => {
    expect(filterAssets(assets, "  ")).toHaveLength(3);
  });

  it("matches on symbol case-insensitively", () => {
    const out = filterAssets(assets, "vdl");
    expect(out.map((a) => a.denom)).toEqual(["uvdl"]);
  });

  it("matches on name", () => {
    const out = filterAssets(assets, "example");
    expect(out.map((a) => a.denom)).toEqual(["uxyz"]);
  });

  it("returns nothing when no symbol or name matches", () => {
    expect(filterAssets(assets, "zzz-nomatch")).toHaveLength(0);
  });
});

describe("sortAssetsForPicker", () => {
  it("orders held balances first, then verified, then by symbol", () => {
    const assets = [
      asset({ denom: "d1", symbol: "ZZZ", amount: "0", verified: false }),
      asset({ denom: "d2", symbol: "AAA", amount: "0", verified: true }),
      asset({ denom: "d3", symbol: "MMM", amount: "500", verified: false }),
    ];
    const out = sortAssetsForPicker(assets).map((a) => a.denom);
    // d3 has balance → first; then verified d2; then d1.
    expect(out).toEqual(["d3", "d2", "d1"]);
  });

  it("does not mutate the input array", () => {
    const assets = [asset({ denom: "b" }), asset({ denom: "a" })];
    const copy = [...assets];
    sortAssetsForPicker(assets);
    expect(assets).toEqual(copy);
  });
});

describe("hasConnectingPath", () => {
  const pools = [pool("ubze", "uvdl"), pool("uvdl", "uatom")];

  it("finds a direct pool", () => {
    expect(hasConnectingPath(pools, "ubze", "uvdl")).toBe(true);
  });

  it("finds a multi-hop path", () => {
    expect(hasConnectingPath(pools, "ubze", "uatom")).toBe(true);
  });

  it("returns false when there is no connecting pool", () => {
    expect(hasConnectingPath(pools, "ubze", "uosmo")).toBe(false);
  });

  it("returns false for identical/empty denoms", () => {
    expect(hasConnectingPath(pools, "ubze", "ubze")).toBe(false);
    expect(hasConnectingPath(pools, "", "uvdl")).toBe(false);
  });
});

describe("parseAmountToBase", () => {
  it("converts display units to integer base units", () => {
    expect(parseAmountToBase("1.5", 6)).toBe("1500000");
  });

  it("truncates excess decimals rather than rounding up", () => {
    expect(parseAmountToBase("1.2345678", 6)).toBe("1234567");
  });

  it("returns null for empty, zero, negative or non-numeric input", () => {
    expect(parseAmountToBase("", 6)).toBeNull();
    expect(parseAmountToBase("0", 6)).toBeNull();
    expect(parseAmountToBase("-1", 6)).toBeNull();
    expect(parseAmountToBase("abc", 6)).toBeNull();
  });
});

describe("minOutputBase", () => {
  it("applies slippage and rounds down", () => {
    // 1000 * (1 - 0.5%) = 995
    expect(minOutputBase("1000", 0.5)).toBe("995");
  });

  it("floors fractional results", () => {
    // 1001 * (1 - 1%) = 990.99 → 990
    expect(minOutputBase("1001", 1)).toBe("990");
  });

  it("returns 0 for a non-positive expected output", () => {
    expect(minOutputBase("0", 0.5)).toBe("0");
  });
});

describe("isValidSlippage", () => {
  it("accepts the 0–50 range", () => {
    expect(isValidSlippage(0)).toBe(true);
    expect(isValidSlippage(0.5)).toBe(true);
    expect(isValidSlippage(50)).toBe(true);
  });

  it("rejects out-of-range or non-numeric values", () => {
    expect(isValidSlippage(-1)).toBe(false);
    expect(isValidSlippage(51)).toBe(false);
    expect(isValidSlippage("abc")).toBe(false);
  });
});

describe("sanitizeAmountInput", () => {
  it("strips non-numeric characters", () => {
    expect(sanitizeAmountInput("1a2b3")).toBe("123");
  });

  it("keeps only the first decimal point", () => {
    expect(sanitizeAmountInput("1.2.3")).toBe("1.23");
  });
});

describe("resolveSwapIssue", () => {
  const pools = [pool("ubze", "uvdl")];
  const base = {
    fromDenom: "ubze",
    toDenom: "uvdl",
    amountBase: "1000000",
    balanceBase: "5000000",
    pools,
  };

  it("is 'none' with a valid routable quote", () => {
    expect(
      resolveSwapIssue({ ...base, quote: { noRoute: false } }),
    ).toBe("none");
  });

  it("flags the same asset on both sides", () => {
    expect(
      resolveSwapIssue({ ...base, toDenom: "ubze", quote: null }),
    ).toBe("same-asset");
  });

  it("flags insufficient balance", () => {
    expect(
      resolveSwapIssue({ ...base, balanceBase: "1", quote: { noRoute: false } }),
    ).toBe("insufficient-balance");
  });

  it("distinguishes insufficient liquidity (pools connect) from no route", () => {
    expect(
      resolveSwapIssue({ ...base, quote: { noRoute: true } }),
    ).toBe("insufficient-liquidity");
    expect(
      resolveSwapIssue({
        ...base,
        toDenom: "uosmo",
        quote: { noRoute: true },
      }),
    ).toBe("no-route");
  });

  it("is 'none' when no amount is entered", () => {
    expect(
      resolveSwapIssue({ ...base, amountBase: null, quote: null }),
    ).toBe("none");
  });
});

describe("swapIssueMessage", () => {
  it("returns null for 'none' and a message otherwise", () => {
    expect(swapIssueMessage("none")).toBeNull();
    expect(swapIssueMessage("no-route")).toMatch(/no swap route/i);
    expect(swapIssueMessage("insufficient-liquidity")).toMatch(/liquidity/i);
  });
});

describe("priceImpactPalette", () => {
  it("escalates green → yellow → red with impact", () => {
    expect(priceImpactPalette(0.1)).toBe("green");
    expect(priceImpactPalette(0.7)).toBe("yellow");
    expect(priceImpactPalette(2)).toBe("red");
  });
});
