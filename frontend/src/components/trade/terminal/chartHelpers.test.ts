import { describe, it, expect } from "vitest";
import { tradebin } from "../../../../wailsjs/go/models";
import {
  TIMEFRAMES,
  DEFAULT_TIMEFRAME,
  timeframeFor,
  timeframeQuery,
  localTimeOffsetSeconds,
  parseCandle,
  parseCandles,
  candleOp,
  applyLatestCandle,
  candlestickData,
  isSparse,
  priceFormatFor,
  type ChartCandle,
} from "./chartHelpers";

/** Build a raw aggregator candle (string fields), overriding what a test cares about. */
function raw(over: Partial<Record<keyof tradebin.Candle, string>> = {}): tradebin.Candle {
  return {
    time: "1720000000",
    open: "1",
    high: "2",
    low: "0.5",
    close: "1.5",
    value: "1000",
    ...over,
  } as tradebin.Candle;
}

/** Build a numeric ChartCandle. */
function candle(over: Partial<ChartCandle> = {}): ChartCandle {
  return { time: 0, open: 1, high: 2, low: 0.5, close: 1.5, value: 100, ...over };
}

describe("timeframe → query mapping (web parity)", () => {
  it("maps every preset to the web's exact minutes/limit", () => {
    expect(timeframeQuery("4H")).toEqual({ minutes: 5, limit: 2016 });
    expect(timeframeQuery("1D")).toEqual({ minutes: 15, limit: 2880 });
    expect(timeframeQuery("7D")).toEqual({ minutes: 60, limit: 2160 });
    expect(timeframeQuery("30D")).toEqual({ minutes: 240, limit: 2190 });
    expect(timeframeQuery("1Y")).toEqual({ minutes: 1440, limit: 1095 });
  });

  it("carries the web's visible-window sizes", () => {
    expect(timeframeFor("4H").visibleIntervals).toBe(48);
    expect(timeframeFor("1D").visibleIntervals).toBe(96);
    expect(timeframeFor("7D").visibleIntervals).toBe(168);
    expect(timeframeFor("30D").visibleIntervals).toBe(180);
    expect(timeframeFor("1Y").visibleIntervals).toBe(365);
  });

  it("falls back to the default timeframe for an unknown label", () => {
    expect(timeframeFor("nope").label).toBe(DEFAULT_TIMEFRAME);
    expect(timeframeQuery("nope")).toEqual(timeframeQuery(DEFAULT_TIMEFRAME));
  });

  it("exposes presets in the web's button order, default 1D", () => {
    expect(TIMEFRAMES.map((t) => t.label)).toEqual(["4H", "1D", "7D", "30D", "1Y"]);
    expect(DEFAULT_TIMEFRAME).toBe("1D");
  });
});

describe("parseCandle / parseCandles", () => {
  it("widens string fields to numbers, truncating time to whole seconds", () => {
    expect(parseCandle(raw({ time: "1720000000.9", open: "1.2", close: "1.4", value: "1000" }))).toEqual({
      time: 1720000000,
      open: 1.2,
      high: 2,
      low: 0.5,
      close: 1.4,
      value: 1000,
    });
  });

  it("subtracts the local-time offset from the UTC time", () => {
    expect(parseCandle(raw({ time: "1720000000" }), 7200).time).toBe(1720000000 - 7200);
  });

  it("returns [] for null/undefined", () => {
    expect(parseCandles(null)).toEqual([]);
    expect(parseCandles(undefined)).toEqual([]);
  });

  it("sorts ascending by time and drops non-finite times", () => {
    const out = parseCandles([
      raw({ time: "30" }),
      raw({ time: "abc" }),
      raw({ time: "10" }),
      raw({ time: "20" }),
    ]);
    expect(out.map((c) => c.time)).toEqual([10, 20, 30]);
  });

  it("localTimeOffsetSeconds is getTimezoneOffset() in seconds", () => {
    const d = new Date("2024-07-03T00:00:00Z");
    expect(localTimeOffsetSeconds(d)).toBe(d.getTimezoneOffset() * 60);
  });
});

describe("candleOp — update-last vs append", () => {
  it("appends when the series is empty", () => {
    expect(candleOp(null, 100)).toBe("append");
  });
  it("appends a strictly newer candle", () => {
    expect(candleOp(100, 200)).toBe("append");
  });
  it("updates the last candle on an equal time", () => {
    expect(candleOp(100, 100)).toBe("update");
  });
  it("marks an older candle stale", () => {
    expect(candleOp(100, 50)).toBe("stale");
  });
});

describe("applyLatestCandle", () => {
  it("appends onto an empty series", () => {
    const c = candle({ time: 10 });
    expect(applyLatestCandle([], c)).toEqual([c]);
  });

  it("rewrites the last bar when times match", () => {
    const existing = [candle({ time: 10, close: 1 })];
    const next = applyLatestCandle(existing, candle({ time: 10, close: 9 }));
    expect(next).toHaveLength(1);
    expect(next[0].close).toBe(9);
    expect(existing[0].close).toBe(1); // input not mutated
  });

  it("appends a newer bar", () => {
    const existing = [candle({ time: 10 })];
    const next = applyLatestCandle(existing, candle({ time: 20 }));
    expect(next.map((c) => c.time)).toEqual([10, 20]);
  });

  it("ignores a stale (older) bar", () => {
    const existing = [candle({ time: 10 }), candle({ time: 20 })];
    const next = applyLatestCandle(existing, candle({ time: 15 }));
    expect(next).toBe(existing);
  });
});

describe("candlestickData / isSparse", () => {
  it("keeps only candles with all-positive OHLC", () => {
    const good = candle({ time: 1 });
    const zeroOpen = candle({ time: 2, open: 0 });
    expect(candlestickData([good, zeroOpen])).toEqual([good]);
  });

  it("is sparse with fewer than two real candles", () => {
    expect(isSparse([])).toBe(true);
    expect(isSparse([candle({ time: 1 })])).toBe(true);
    expect(isSparse([candle({ time: 1, open: 0 }), candle({ time: 2, open: 0 })])).toBe(true);
    expect(isSparse([candle({ time: 1 }), candle({ time: 2 })])).toBe(false);
  });
});

describe("priceFormatFor", () => {
  it("buckets precision by average price magnitude", () => {
    expect(priceFormatFor([candle({ high: 12, low: 10 })])).toEqual({ precision: 2, minMove: 0.01 });
    expect(priceFormatFor([candle({ high: 0.06, low: 0.04 })])).toEqual({ precision: 4, minMove: 0.0001 });
    expect(priceFormatFor([candle({ high: 0.0006, low: 0.0004 })])).toEqual({ precision: 6, minMove: 0.000001 });
    expect(priceFormatFor([candle({ high: 0.00006, low: 0.00004 })])).toEqual({ precision: 7, minMove: 0.0000001 });
  });

  it("defaults to the finest precision when there are no prices", () => {
    expect(priceFormatFor([])).toEqual({ precision: 7, minMove: 0.0000001 });
  });
});
