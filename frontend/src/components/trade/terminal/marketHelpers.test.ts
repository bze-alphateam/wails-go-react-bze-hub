import { describe, it, expect } from "vitest";
import { tradebin } from "../../../../wailsjs/go/models";
import {
  filterMarkets,
  sortMarkets,
  isVerifiedMarket,
  buildDepth,
  spread,
  type ResolveAsset,
} from "./marketHelpers";

// resolve stub: symbol is the denom without its leading "u", uppercased; ubze
// and uusdc are the verified assets.
const resolve: ResolveAsset = (denom) =>
  denom.startsWith("u")
    ? { symbol: denom.slice(1).toUpperCase(), decimals: 0, verified: denom === "ubze" || denom === "uusdc" }
    : undefined;

function market(
  base: string,
  quote: string,
  stats: Partial<tradebin.MarketStats> | null,
): tradebin.MarketWithStats {
  return {
    marketId: `${base}/${quote}`,
    base,
    quote,
    creator: "bze1x",
    statsAvailable: stats !== null,
    stats: stats as tradebin.MarketStats,
  } as tradebin.MarketWithStats;
}

const m1 = market("ubze", "uusdc", { quoteVolume: "1000", change: "5", lastPrice: "1.5" });
const m2 = market("uatom", "ubze", { quoteVolume: "5000", change: "-2", lastPrice: "10" });
const m3 = market("ux", "uy", null); // no stats

describe("filterMarkets", () => {
  it("matches by asset symbol", () => {
    expect(filterMarkets([m1, m2, m3], "atom", resolve).map((m) => m.marketId)).toEqual(["uatom/ubze"]);
  });
  it("matches by quote symbol", () => {
    expect(filterMarkets([m1, m2, m3], "usdc", resolve).map((m) => m.marketId)).toEqual(["ubze/uusdc"]);
  });
  it("matches by denom", () => {
    expect(filterMarkets([m1, m2, m3], "ux", resolve).map((m) => m.marketId)).toEqual(["ux/uy"]);
  });
  it("empty term returns all", () => {
    expect(filterMarkets([m1, m2, m3], "  ", resolve)).toHaveLength(3);
  });
});

describe("sortMarkets", () => {
  it("by volume descending, no-stats last", () => {
    expect(sortMarkets([m1, m2, m3], "volume").map((m) => m.marketId)).toEqual([
      "uatom/ubze",
      "ubze/uusdc",
      "ux/uy",
    ]);
  });
  it("by change descending, no-stats last", () => {
    expect(sortMarkets([m1, m2, m3], "change").map((m) => m.marketId)).toEqual([
      "ubze/uusdc",
      "uatom/ubze",
      "ux/uy",
    ]);
  });
  it("does not mutate the input", () => {
    const input = [m1, m2, m3];
    sortMarkets(input, "volume");
    expect(input.map((m) => m.marketId)).toEqual(["ubze/uusdc", "uatom/ubze", "ux/uy"]);
  });
});

describe("isVerifiedMarket", () => {
  it("true only when both assets are verified", () => {
    expect(isVerifiedMarket(m1, resolve)).toBe(true); // ubze + uusdc
    expect(isVerifiedMarket(m2, resolve)).toBe(false); // uatom not verified
  });
});

describe("buildDepth", () => {
  it("computes cumulative depth and per-side percentages", () => {
    const levels: tradebin.OrderbookLevel[] = [
      { price: "10", amount: "100" } as tradebin.OrderbookLevel,
      { price: "11", amount: "50" } as tradebin.OrderbookLevel,
    ];
    const rows = buildDepth(levels, 0, 0);
    expect(rows[0].price).toBe("10");
    expect(rows[0].amount).toBe("100");
    expect(rows[0].total).toBe("1000");
    expect(rows[0].cumulative).toBe("100");
    expect(rows[0].depthPct).toBeCloseTo(66.67, 1);
    expect(rows[1].cumulative).toBe("150");
    expect(rows[1].depthPct).toBe(100);
  });
});

describe("spread", () => {
  it("computes value and percent from best bid/ask", () => {
    const s = spread(
      [{ price: "9", amount: "1" } as tradebin.OrderbookLevel],
      [{ price: "11", amount: "1" } as tradebin.OrderbookLevel],
      0,
      0,
    );
    expect(s).toEqual({ value: "2", percent: "20.00" });
  });
  it("null when a side is empty", () => {
    expect(spread([], [{ price: "11", amount: "1" } as tradebin.OrderbookLevel], 0, 0)).toBeNull();
  });
});
