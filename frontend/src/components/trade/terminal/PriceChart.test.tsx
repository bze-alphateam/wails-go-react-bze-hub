import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { renderWithChakra } from "../../../test/render";
import { PriceChart } from "./PriceChart";

// Fake lightweight-charts: a chart whose series records setData/update calls.
const { createChart, chartApi, seriesApi } = vi.hoisted(() => {
  const seriesApi = {
    setData: vi.fn(),
    update: vi.fn(),
    priceScale: () => ({ applyOptions: () => {} }),
  };
  const chartApi = {
    addSeries: vi.fn(() => seriesApi),
    timeScale: () => ({ setVisibleLogicalRange: () => {} }),
    applyOptions: () => {},
    remove: vi.fn(),
  };
  return { createChart: vi.fn(() => chartApi), chartApi, seriesApi };
});
vi.mock("lightweight-charts", () => ({
  createChart,
  CandlestickSeries: "Candlestick",
  LineSeries: "Line",
  ColorType: { Solid: "solid" },
}));

const { GetCandles } = vi.hoisted(() => ({ GetCandles: vi.fn() }));
vi.mock("../../../../wailsjs/go/main/App", () => ({
  GetCandles: (...args: unknown[]) => GetCandles(...args),
}));

// Capture the market-event handlers so a test can fire chain:trade directly.
let marketHandlers: { onOrderbook?: () => void; onTrade?: () => void } = {};
vi.mock("../../../hooks/useMarketEvents", () => ({
  useMarketEvents: (_marketId: string, handlers: typeof marketHandlers) => {
    marketHandlers = handlers;
  },
}));

const rich = [
  { time: "1000", open: "1", high: "2", low: "0.5", close: "1.5", value: "100" },
  { time: "2000", open: "1.5", high: "2.5", low: "1", close: "2", value: "200" },
];

beforeEach(() => {
  marketHandlers = {};
  GetCandles.mockReset();
  createChart.mockClear();
  chartApi.addSeries.mockClear();
  chartApi.remove.mockClear();
  seriesApi.setData.mockClear();
  seriesApi.update.mockClear();
});

describe("PriceChart", () => {
  it("renders the timeframe switcher and draws candles once loaded", async () => {
    GetCandles.mockResolvedValue(rich);
    renderWithChakra(<PriceChart marketId="ubze/uusdc" />);

    // The default 1D query is issued (minutes 15, limit 2880).
    await waitFor(() => expect(GetCandles).toHaveBeenCalledWith("ubze/uusdc", 15, 2880));
    await waitFor(() => expect(seriesApi.setData).toHaveBeenCalled());
    expect(chartApi.addSeries).toHaveBeenCalledWith("Candlestick", expect.anything());

    // All five presets are shown.
    for (const label of ["4H", "1D", "7D", "30D", "1Y"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("shows a friendly empty panel when there are no candles", async () => {
    GetCandles.mockResolvedValue([]);
    renderWithChakra(<PriceChart marketId="ubze/uusdc" />);
    expect(await screen.findByText("No trades yet")).toBeInTheDocument();
  });

  it("shows an aggregator-down panel when the fetch fails", async () => {
    GetCandles.mockRejectedValue(new Error("aggregator unreachable"));
    renderWithChakra(<PriceChart marketId="ubze/uusdc" />);
    expect(await screen.findByText("Chart data unavailable")).toBeInTheDocument();
  });

  it("merges a live trade in place (no full reload) via series.update", async () => {
    GetCandles.mockResolvedValue(rich);
    renderWithChakra(<PriceChart marketId="ubze/uusdc" />);
    await waitFor(() => expect(seriesApi.setData).toHaveBeenCalled());

    const createdBefore = createChart.mock.calls.length;
    GetCandles.mockClear();

    await act(async () => {
      await marketHandlers.onTrade?.();
    });

    // Merge refetches a tiny tail window (limit 2) and updates the series...
    expect(GetCandles).toHaveBeenCalledWith("ubze/uusdc", 15, 2);
    expect(seriesApi.update).toHaveBeenCalled();
    // ...without tearing the chart down and rebuilding it.
    expect(createChart.mock.calls.length).toBe(createdBefore);
  });

  it("refetches with the new query when the timeframe changes", async () => {
    GetCandles.mockResolvedValue(rich);
    renderWithChakra(<PriceChart marketId="ubze/uusdc" />);
    await waitFor(() => expect(GetCandles).toHaveBeenCalledWith("ubze/uusdc", 15, 2880));
    GetCandles.mockClear();

    await act(async () => {
      screen.getByRole("button", { name: "7D" }).click();
    });

    // 7D → minutes 60, limit 2160.
    await waitFor(() => expect(GetCandles).toHaveBeenCalledWith("ubze/uusdc", 60, 2160));
  });
});
