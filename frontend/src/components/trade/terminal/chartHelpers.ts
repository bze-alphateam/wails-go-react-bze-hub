import { tradebin } from "../../../../wailsjs/go/models";

/**
 * A candle in the shape lightweight-charts consumes: `time` is a UNIX timestamp
 * in **seconds** (the aggregator's `format=tv` shape), the OHLC + volume are
 * numbers. The Go `GetCandles` binding returns these fields as strings; the
 * parse helpers below widen them to numbers.
 */
export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  value: number;
}

/** A selectable timeframe and the query it maps to. */
export interface Timeframe {
  /** Button label, e.g. "1D". */
  label: string;
  /** Candle interval in minutes — the `minutes` arg to GetCandles. */
  minutes: number;
  /** Max candles to fetch — the `limit` arg to GetCandles. */
  limit: number;
  /** How many candles the initial view frames (mirrors the web's visible window). */
  visibleIntervals: number;
}

/**
 * Timeframe presets mirrored 1:1 from the web DEX
 * (`packages/ui-kit/src/utils/charts.ts`): interval `minutes` from
 * `getChartMinutes`, `limit` from `getChartIntervalsLimit`, `visibleIntervals`
 * from `getNoOfIntervalsNeeded`. Order and default match the web (buttons run
 * 4H → 1Y, 1D is the default). Arithmetic is left un-multiplied to read as the
 * web source does.
 */
export const TIMEFRAMES: Timeframe[] = [
  { label: "4H", minutes: 5, limit: 12 * 24 * 7, visibleIntervals: 12 * 4 },
  { label: "1D", minutes: 15, limit: 4 * 24 * 30, visibleIntervals: 4 * 24 },
  { label: "7D", minutes: 60, limit: 24 * 90, visibleIntervals: 24 * 7 },
  { label: "30D", minutes: 240, limit: 6 * 365, visibleIntervals: 6 * 30 },
  { label: "1Y", minutes: 1440, limit: 365 * 3, visibleIntervals: 365 },
];

/** The timeframe selected on first render (web parity). */
export const DEFAULT_TIMEFRAME = "1D";

/** The timeframe for a label, falling back to the default for unknown labels. */
export function timeframeFor(label: string): Timeframe {
  return (
    TIMEFRAMES.find((t) => t.label === label) ??
    TIMEFRAMES.find((t) => t.label === DEFAULT_TIMEFRAME)!
  );
}

/** The `{minutes, limit}` GetCandles query for a timeframe label. */
export function timeframeQuery(label: string): { minutes: number; limit: number } {
  const tf = timeframeFor(label);
  return { minutes: tf.minutes, limit: tf.limit };
}

/**
 * The seconds to subtract from a UTC candle time so lightweight-charts' UTC axis
 * reads as the viewer's local time — the same trick the web chart uses
 * (`getTimezoneOffset() * 60`). Pass a fixed `now` in tests for determinism.
 */
export function localTimeOffsetSeconds(now: Date = new Date()): number {
  return now.getTimezoneOffset() * 60;
}

/**
 * Parse one aggregator candle into a numeric {@link ChartCandle}. `offsetSeconds`
 * (see {@link localTimeOffsetSeconds}) is subtracted from the UTC time so the
 * axis shows local time; pass 0 to keep raw UTC seconds.
 */
export function parseCandle(raw: tradebin.Candle, offsetSeconds = 0): ChartCandle {
  return {
    time: Math.trunc(Number(raw.time)) - offsetSeconds,
    open: Number(raw.open),
    high: Number(raw.high),
    low: Number(raw.low),
    close: Number(raw.close),
    value: Number(raw.value),
  };
}

/**
 * Parse a candle list: widen to numbers, drop rows with a non-finite time, and
 * sort ascending by time (lightweight-charts requires strictly ordered data).
 */
export function parseCandles(
  raw: tradebin.Candle[] | null | undefined,
  offsetSeconds = 0,
): ChartCandle[] {
  if (!raw) return [];
  const out = raw
    .map((c) => parseCandle(c, offsetSeconds))
    .filter((c) => Number.isFinite(c.time));
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** How an incoming candle relates to the series' current last bar. */
export type CandleOp = "append" | "update" | "stale";

/**
 * Classify a candle at `incomingTime` against a series whose last bar is at
 * `lastTime` (null when the series is empty). lightweight-charts' `series.update`
 * both **appends** a bar (newer time) and **rewrites the last** bar (equal time);
 * an older time is **stale** and must be dropped, or `update` throws. This is the
 * "update-last vs append" decision the live merge relies on.
 */
export function candleOp(lastTime: number | null, incomingTime: number): CandleOp {
  if (lastTime === null) return "append";
  if (incomingTime > lastTime) return "append";
  if (incomingTime === lastTime) return "update";
  return "stale";
}

/**
 * Fold the newest candle into the existing series array (state bookkeeping that
 * mirrors what {@link candleOp} tells the chart series to do). A stale candle
 * leaves the array unchanged; the input is never mutated.
 */
export function applyLatestCandle(existing: ChartCandle[], latest: ChartCandle): ChartCandle[] {
  const lastTime = existing.length ? existing[existing.length - 1].time : null;
  switch (candleOp(lastTime, latest.time)) {
    case "update": {
      const next = existing.slice();
      next[next.length - 1] = latest;
      return next;
    }
    case "append":
      return [...existing, latest];
    case "stale":
      return existing;
  }
}

/**
 * Candles drawable as candlesticks: all four OHLC values present and positive
 * (mirrors the web chart, which filters out empty/zero intervals from the
 * candlestick series).
 */
export function candlestickData(candles: ChartCandle[]): ChartCandle[] {
  return candles.filter((c) => c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0);
}

/**
 * True when there are too few real candles to draw meaningful candlesticks, in
 * which case the chart falls back to a close-price line — a Hub enhancement for
 * thin / brand-new markets (the web always draws candlesticks).
 */
export function isSparse(candles: ChartCandle[]): boolean {
  return candlestickData(candles).length < 2;
}

/** A lightweight-charts price-format precision for a series. */
export interface PriceFormat {
  precision: number;
  minMove: number;
}

/**
 * A sensible axis precision bucketed by the average candle price — approximates
 * the web's `formatByAverage` so low-priced assets show enough decimals. Uses
 * the mean of the highs and lows across the window.
 */
export function priceFormatFor(candles: ChartCandle[]): PriceFormat {
  const prices = candles
    .flatMap((c) => [c.high, c.low])
    .filter((n) => Number.isFinite(n) && n > 0);
  const avg = prices.length ? prices.reduce((s, n) => s + n, 0) / prices.length : 0;
  if (avg >= 1) return { precision: 2, minMove: 0.01 };
  if (avg >= 0.01) return { precision: 4, minMove: 0.0001 };
  if (avg >= 0.0001) return { precision: 6, minMove: 0.000001 };
  return { precision: 7, minMove: 0.0000001 };
}
