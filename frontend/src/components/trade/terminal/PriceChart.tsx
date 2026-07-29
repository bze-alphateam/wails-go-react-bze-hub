import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Center, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { GetCandles } from "../../../../wailsjs/go/main/App";
import { useMarketEvents } from "../../../hooks/useMarketEvents";
import {
  TIMEFRAMES,
  DEFAULT_TIMEFRAME,
  timeframeFor,
  localTimeOffsetSeconds,
  parseCandles,
  candleOp,
  candlestickData,
  isSparse,
  priceFormatFor,
  type ChartCandle,
} from "./chartHelpers";

/** Height of the chart area, matching the terminal slot it replaces. */
const CHART_HEIGHT = 260;
/** Candles fetched on a live merge — the last in-progress bar plus a spare so a
 * freshly-opened interval is appended without a full reload. */
const MERGE_LIMIT = 2;

type ChartStatus = "loading" | "ready" | "empty" | "error";
type SeriesKind = "candlestick" | "line";
type AnySeries = ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;

interface PriceChartProps {
  marketId: string;
}

/** Colors for the candlestick lib, per applied theme (mirrors the web palette). */
function chartColors(dark: boolean) {
  return {
    up: "#26a69a",
    down: "#ef5350",
    line: "#26a69a",
    text: dark ? "#a0a0a0" : "#666666",
    grid: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.1)",
    background: "rgba(0,0,0,0)",
  };
}

/** Push one candle onto the series, in the shape its kind expects. */
function updateSeries(series: AnySeries, kind: SeriesKind, c: ChartCandle): void {
  if (kind === "line") {
    (series as ISeriesApi<"Line">).update({ time: c.time as Time, value: c.close });
  } else {
    (series as ISeriesApi<"Candlestick">).update({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    });
  }
}

/** A candle worth drawing for the given series kind (skips empty/zero bars). */
function drawable(c: ChartCandle, kind: SeriesKind): boolean {
  return kind === "line"
    ? c.close > 0
    : c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0;
}

/**
 * The terminal's price chart: an embedded (bundled, no runtime network fetch)
 * lightweight-charts candlestick fed by the aggregator's `format=tv` candles via
 * the `GetCandles` binding. A timeframe switcher mirrors the web presets; live
 * `chain:trade` events merge the latest candle in place (update-last or append)
 * with no full-chart reload. Falls back to a close-price line for thin markets,
 * and shows friendly panels while loading, with no trades, or when the
 * aggregator is unavailable.
 */
export function PriceChart({ marketId }: PriceChartProps) {
  const [timeframe, setTimeframe] = useState<string>(DEFAULT_TIMEFRAME);
  const [status, setStatus] = useState<ChartStatus>("loading");
  // Bumped to force a full reload (recover from empty/error, e.g. once trades
  // start flowing or the aggregator comes back).
  const [reloadKey, setReloadKey] = useState(0);
  const [dark, setDark] = useState<boolean>(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<AnySeries | null>(null);
  const kindRef = useRef<SeriesKind>("candlestick");
  const lastTimeRef = useRef<number | null>(null);
  // The local-time shift is computed once so bars don't drift if the effect re-runs.
  const offsetRef = useRef<number>(localTimeOffsetSeconds());
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Keep closures reading current values without re-subscribing.
  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;
  const statusRef = useRef(status);
  statusRef.current = status;

  // Track the applied theme (the app toggles a `dark`/`light` class on <html>);
  // a change rebuilds the chart with the matching palette.
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDark(el.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Full (re)build: create the chart, fetch the window, draw it. Runs on market,
  // timeframe, theme or an explicit reload — never on a live trade.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !marketId) return;

    let cancelled = false;
    const colors = chartColors(dark);
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.text },
      grid: { horzLines: { color: colors.grid }, vertLines: { color: colors.grid } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: colors.grid, rightOffset: 4 },
      rightPriceScale: { borderColor: colors.grid },
      handleScale: { axisPressedMouseMove: false },
    });
    chartRef.current = chart;
    seriesRef.current = null;
    lastTimeRef.current = null;
    setStatus("loading");

    const tf = timeframeFor(timeframeRef.current);
    (async () => {
      let candles: ChartCandle[];
      try {
        const res = await GetCandles(marketId, tf.minutes, tf.limit);
        candles = parseCandles(res, offsetRef.current);
      } catch {
        if (!cancelled) setStatus("error");
        return;
      }
      if (cancelled) return;

      const kind: SeriesKind = isSparse(candles) ? "line" : "candlestick";
      kindRef.current = kind;
      const { precision, minMove } = priceFormatFor(candles);
      const priceFormat = { type: "price" as const, precision, minMove };

      const series: AnySeries =
        kind === "line"
          ? chart.addSeries(LineSeries, { color: colors.line, lineWidth: 2, priceFormat })
          : chart.addSeries(CandlestickSeries, {
              upColor: colors.up,
              downColor: colors.down,
              borderVisible: false,
              wickUpColor: colors.up,
              wickDownColor: colors.down,
              priceFormat,
            });
      seriesRef.current = series;

      const drawn = candles.filter((c) => drawable(c, kind));
      if (kind === "line") {
        (series as ISeriesApi<"Line">).setData(drawn.map((c) => ({ time: c.time as Time, value: c.close })));
      } else {
        (series as ISeriesApi<"Candlestick">).setData(
          drawn.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })),
        );
      }
      lastTimeRef.current = candles.length ? candles[candles.length - 1].time : null;

      // Frame the last N bars, matching the web's initial visible window.
      if (drawn.length > 0) {
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, drawn.length - tf.visibleIntervals),
          to: drawn.length,
        });
      }
      setStatus(candles.length === 0 ? "empty" : "ready");
    })();

    return () => {
      cancelled = true;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [marketId, timeframe, dark, reloadKey]);

  // Live merge: on a trade for this market, fetch the tail and update the last
  // bar / append a new one in place. If we're not showing a live chart yet
  // (empty/error), fall back to a full reload so the series kind is chosen fresh.
  const onTrade = useCallback(async () => {
    const series = seriesRef.current;
    if (!series || statusRef.current !== "ready") {
      setReloadKey((k) => k + 1);
      return;
    }
    const tf = timeframeFor(timeframeRef.current);
    let incoming: ChartCandle[];
    try {
      const res = await GetCandles(marketId, tf.minutes, MERGE_LIMIT);
      incoming = parseCandles(res, offsetRef.current);
    } catch {
      return; // transient aggregator hiccup — keep the current chart
    }
    if (seriesRef.current !== series) return; // rebuilt while we awaited
    for (const c of incoming) {
      if (candleOp(lastTimeRef.current, c.time) === "stale") continue;
      if (!drawable(c, kindRef.current)) continue;
      updateSeries(series, kindRef.current, c);
      lastTimeRef.current = c.time;
    }
  }, [marketId]);

  useMarketEvents(marketId, { onTrade });

  return (
    <VStack gap="2" align="stretch">
      <HStack gap="1" justify="flex-end">
        {TIMEFRAMES.map((tf) => (
          <Button
            key={tf.label}
            size="xs"
            variant={tf.label === timeframe ? "solid" : "ghost"}
            colorPalette="blue"
            onClick={() => setTimeframe(tf.label)}
          >
            {tf.label}
          </Button>
        ))}
      </HStack>

      <Box position="relative" borderWidth="1px" borderRadius="lg" overflow="hidden" height={`${CHART_HEIGHT}px`}>
        <Box ref={containerRef} height="100%" width="100%" />
        {status !== "ready" && (
          <Center position="absolute" inset="0" bg="bg.panel" px="4">
            {status === "loading" ? (
              <Spinner size="md" colorPalette="blue" />
            ) : status === "empty" ? (
              <Text color="fg.muted" fontSize="sm">
                No trades yet
              </Text>
            ) : (
              <VStack gap="1">
                <Text fontWeight="semibold" color="fg.muted">
                  Chart data unavailable
                </Text>
                <Text fontSize="sm" color="fg.muted" textAlign="center">
                  The market data service is unreachable. Trading is unaffected.
                </Text>
              </VStack>
            )}
          </Center>
        )}
      </Box>
    </VStack>
  );
}
