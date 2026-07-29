import { describe, it, expect } from "vitest";
import BigNumber from "bignumber.js";
import type { amm, tradebin } from "../../../../wailsjs/go/models";
import { indexPoolStats, findPoolStat, poolTvlUsd, poolVolumeUsd, poolApr } from "./poolUsd";

function pool(over: Partial<amm.Pool> = {}): amm.Pool {
  return {
    id: "ubze/uvdl",
    base: "ubze",
    quote: "uvdl",
    lpDenom: "amm/1",
    creator: "bze1x",
    fee: "0.003",
    feeProviders: "1",
    reserveBase: "1000",
    reserveQuote: "2000",
    stable: false,
    ...over,
  } as amm.Pool;
}

function stat(over: Partial<tradebin.PoolStat> = {}): tradebin.PoolStat {
  return {
    poolId: "ubze/uvdl",
    base: "ubze",
    quote: "uvdl",
    lastPrice: "2",
    baseVolume: "100",
    quoteVolume: "200",
    change: "0",
    ...over,
  } as tradebin.PoolStat;
}

describe("indexPoolStats / findPoolStat", () => {
  it("matches by pool id", () => {
    const idx = indexPoolStats([stat()]);
    expect(findPoolStat(pool(), idx)?.baseVolume).toBe("100");
  });
  it("matches by base/quote regardless of id format or ordering", () => {
    const idx = indexPoolStats([stat({ poolId: "weird-id" })]);
    const p = pool({ id: "no-match", base: "uvdl", quote: "ubze" }); // reversed
    expect(findPoolStat(p, idx)?.baseVolume).toBe("100");
  });
});

describe("poolTvlUsd", () => {
  const usd = (denom: string) => (denom === "ubze" ? new BigNumber(120) : new BigNumber(80));
  it("sums both reserve sides in USD", () => {
    expect(poolTvlUsd(pool(), usd)?.toString()).toBe("200");
  });
  it("uses the known side when one price is missing", () => {
    const partial = (denom: string) => (denom === "ubze" ? new BigNumber(120) : null);
    expect(poolTvlUsd(pool(), partial)?.toString()).toBe("120");
  });
  it("is null when neither side is priced", () => {
    expect(poolTvlUsd(pool(), () => null)).toBeNull();
  });
});

describe("poolVolumeUsd", () => {
  it("prices the base volume", () => {
    const price = (d: string) => (d === "ubze" ? new BigNumber(2) : null);
    expect(poolVolumeUsd(pool(), stat({ baseVolume: "50" }), price)?.toString()).toBe("100");
  });
  it("falls back to the quote side when base is unpriced", () => {
    const price = (d: string) => (d === "uvdl" ? new BigNumber(1) : null);
    expect(poolVolumeUsd(pool(), stat({ quoteVolume: "80" }), price)?.toString()).toBe("80");
  });
  it("is null without a stat", () => {
    expect(poolVolumeUsd(pool(), undefined, () => new BigNumber(2))).toBeNull();
  });
});

describe("poolApr", () => {
  it("annualises fees to LPs over TVL", () => {
    // vol 10000 × fee 0.01 × providers 1 = 100/day; /36500 × 365 × 100 = 100%
    expect(poolApr(pool({ fee: "0.01", feeProviders: "1" }), new BigNumber(36500), new BigNumber(10000))).toBeCloseTo(100, 6);
  });
  it("is 0 without TVL/volume", () => {
    expect(poolApr(pool(), null, new BigNumber(10000))).toBe(0);
    expect(poolApr(pool(), new BigNumber(1000), null)).toBe(0);
  });
});
