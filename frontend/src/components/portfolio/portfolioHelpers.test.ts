import { describe, it, expect } from "vitest";
import BigNumber from "bignumber.js";
import type { AssetBalance } from "../../hooks/useAssets";
import {
  typeBadge,
  usdLabel,
  hasBalance,
  matchesSearch,
  sortByUsdValue,
  visibleAssets,
  totalUsdValue,
  type UsdLookup,
} from "./portfolioHelpers";

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

/** Build a usdValue lookup from a denom→unit-price map (display-amount based). */
function lookupFrom(prices: Record<string, string>): UsdLookup {
  return (denom, uAmount) => {
    const p = prices[denom];
    if (!p) return null;
    // Test fixtures all use 6 decimals, matching the asset() factory.
    return new BigNumber(p).multipliedBy(new BigNumber(uAmount).shiftedBy(-6));
  };
}

describe("typeBadge", () => {
  it("maps engine types to labels and palettes", () => {
    expect(typeBadge("native")).toEqual({ label: "Native", colorPalette: "purple" });
    expect(typeBadge("factory")).toEqual({ label: "Factory", colorPalette: "blue" });
    expect(typeBadge("ibc")).toEqual({ label: "IBC", colorPalette: "teal" });
    expect(typeBadge("lp")).toEqual({ label: "LP", colorPalette: "gray" });
  });

  it("falls back to a neutral badge for unknown types", () => {
    expect(typeBadge("weird")).toEqual({ label: "WEIRD", colorPalette: "gray" });
    expect(typeBadge("")).toEqual({ label: "Unknown", colorPalette: "gray" });
  });
});

describe("usdLabel", () => {
  it("formats values >= 1 with two decimals and thousands separators", () => {
    expect(usdLabel(new BigNumber("1234.5"))).toBe("$1,234.5");
    expect(usdLabel(new BigNumber("1"))).toBe("$1");
  });

  it("formats sub-dollar values with significant decimals", () => {
    expect(usdLabel(new BigNumber("0.00046927"))).toBe("$0.00046927");
  });

  it("hides zero / negative / null values (never renders $0)", () => {
    expect(usdLabel(new BigNumber(0))).toBeNull();
    expect(usdLabel(new BigNumber("-5"))).toBeNull();
    expect(usdLabel(null)).toBeNull();
    expect(usdLabel(undefined)).toBeNull();
  });
});

describe("hasBalance", () => {
  it("is true only for positive balances", () => {
    expect(hasBalance(asset({ amount: "2000000" }))).toBe(true);
    expect(hasBalance(asset({ amount: "0" }))).toBe(false);
    expect(hasBalance(asset({ amount: "" }))).toBe(false);
  });
});

describe("matchesSearch", () => {
  const vdl = asset({ denom: "factory/bze1x/uvdl", symbol: "VDL", name: "Vidulum" });

  it("matches symbol, name and denom case-insensitively", () => {
    expect(matchesSearch(vdl, "vdl")).toBe(true);
    expect(matchesSearch(vdl, "vidul")).toBe(true);
    expect(matchesSearch(vdl, "factory/bze1x")).toBe(true);
    expect(matchesSearch(vdl, "ATOM")).toBe(false);
  });

  it("treats an empty/whitespace term as match-all", () => {
    expect(matchesSearch(vdl, "")).toBe(true);
    expect(matchesSearch(vdl, "   ")).toBe(true);
  });
});

describe("sortByUsdValue", () => {
  it("orders by USD value descending, unpriced last", () => {
    const bze = asset({ denom: "ubze", amount: "1000000" }); // $0.0005
    const vdl = asset({ denom: "uvdl", symbol: "VDL", type: "factory", amount: "1000000" }); // $0.01
    const abc = asset({ denom: "uabc", symbol: "ABC", type: "factory", amount: "1000000", price: "" }); // no price
    const usd = lookupFrom({ ubze: "0.0005", uvdl: "0.01" });

    const sorted = sortByUsdValue([bze, abc, vdl], usd);
    expect(sorted.map((a) => a.denom)).toEqual(["uvdl", "ubze", "uabc"]);
  });

  it("breaks ties: native first, then verified, then name", () => {
    const usd: UsdLookup = () => null; // everything unpriced → all tie at 0
    const native = asset({ denom: "ubze", symbol: "BZE", type: "native", verified: false });
    const verified = asset({ denom: "uv", symbol: "VER", type: "factory", name: "Verified", verified: true });
    const zed = asset({ denom: "uz", symbol: "ZED", type: "factory", name: "Zed", verified: false });
    const abc = asset({ denom: "ua", symbol: "ABC", type: "factory", name: "Abc", verified: false });

    const sorted = sortByUsdValue([zed, verified, abc, native], usd);
    expect(sorted.map((a) => a.symbol)).toEqual(["BZE", "VER", "ABC", "ZED"]);
  });
});

describe("visibleAssets", () => {
  const bze = asset({ denom: "ubze", amount: "1000000" }); // held, $0.0005
  const vdl = asset({ denom: "uvdl", symbol: "VDL", name: "Vidulum", type: "factory", amount: "5000000" }); // held, $0.05
  const empty = asset({ denom: "uabc", symbol: "ABC", name: "Abc", type: "factory", amount: "0" }); // zero balance
  const all = [bze, empty, vdl];
  const usd = lookupFrom({ ubze: "0.0005", uvdl: "0.01" });

  it("shows holdings only by default, sorted by value desc", () => {
    const rows = visibleAssets(all, { search: "", showAll: false, usdValue: usd });
    expect(rows.map((a) => a.denom)).toEqual(["uvdl", "ubze"]);
  });

  it("reveals zero-balance known assets when showAll is on", () => {
    const rows = visibleAssets(all, { search: "", showAll: true, usdValue: usd });
    expect(rows.map((a) => a.denom)).toContain("uabc");
    expect(rows).toHaveLength(3);
  });

  it("filters by search across the current view", () => {
    const rows = visibleAssets(all, { search: "vidul", showAll: true, usdValue: usd });
    expect(rows.map((a) => a.denom)).toEqual(["uvdl"]);
  });
});

describe("totalUsdValue", () => {
  it("sums per-asset USD values, ignoring unpriced assets, big-number-safe", () => {
    const bze = asset({ denom: "ubze", amount: "1000000" }); // $0.0005
    const vdl = asset({ denom: "uvdl", symbol: "VDL", amount: "5000000" }); // $0.05
    const abc = asset({ denom: "uabc", symbol: "ABC", amount: "1000000", price: "" }); // no price
    const usd = lookupFrom({ ubze: "0.0005", uvdl: "0.01" });

    expect(totalUsdValue([bze, vdl, abc], usd).toString()).toBe("0.0505");
  });

  it("is zero for an empty / all-unpriced portfolio", () => {
    expect(totalUsdValue([], () => null).toString()).toBe("0");
    expect(totalUsdValue([asset({ price: "" })], () => null).toString()).toBe("0");
  });
});
