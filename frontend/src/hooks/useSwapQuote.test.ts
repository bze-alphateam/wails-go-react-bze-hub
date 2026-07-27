import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Hoisted Wails mocks: the QuoteSwap binding and an EventsOn that records
// listeners so a test can fire "chain:block" like the Go backend would.
const { QuoteSwap, listeners } = vi.hoisted(() => {
  const listeners: Record<string, (data?: unknown) => void> = {};
  return {
    QuoteSwap: vi.fn(),
    EventsOn: vi.fn((event: string, cb: (data?: unknown) => void) => {
      listeners[event] = cb;
      return () => {
        delete listeners[event];
      };
    }),
    listeners,
  };
});

vi.mock("../../wailsjs/go/main/App", () => ({ QuoteSwap }));
vi.mock("../../wailsjs/runtime/runtime", () => {
  // Re-declare here: the runtime module only needs EventsOn.
  return { EventsOn: vi.fn((event: string, cb: (d?: unknown) => void) => {
    listeners[event] = cb;
    return () => delete listeners[event];
  }) };
});

import { useSwapQuote } from "./useSwapQuote";

const QUOTE = {
  noRoute: false,
  routes: ["1"],
  path: ["ubze", "uvdl"],
  expectedOut: "2500000",
  priceImpact: "1.5",
  totalFees: "5000",
  feesPerHop: ["3000"],
};

beforeEach(() => {
  QuoteSwap.mockReset();
  for (const key of Object.keys(listeners)) delete listeners[key];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSwapQuote", () => {
  it("debounces, then quotes and exposes the result", async () => {
    QuoteSwap.mockResolvedValue(QUOTE);
    const { result } = renderHook(() =>
      useSwapQuote("ubze", "uvdl", "1000000", "bze1abc"),
    );

    // Nothing fires before the debounce elapses.
    expect(QuoteSwap).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(QuoteSwap).toHaveBeenCalledWith("ubze", "uvdl", "1000000");
    expect(result.current.quoted?.quote.expectedOut).toBe("2500000");
    expect(result.current.quoted?.amountIn).toBe("1000000");
    expect(result.current.isQuoting).toBe(false);
  });

  it("does not quote when the two denoms are identical", async () => {
    QuoteSwap.mockResolvedValue(QUOTE);
    const { result } = renderHook(() =>
      useSwapQuote("ubze", "ubze", "1000000", "bze1abc"),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(QuoteSwap).not.toHaveBeenCalled();
    expect(result.current.quoted).toBeNull();
  });

  it("does not quote when there is no amount", async () => {
    QuoteSwap.mockResolvedValue(QUOTE);
    renderHook(() => useSwapQuote("ubze", "uvdl", null, "bze1abc"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(QuoteSwap).not.toHaveBeenCalled();
  });

  it("re-quotes on a new block and stamps the quote with that block height", async () => {
    QuoteSwap.mockResolvedValue(QUOTE);
    const { result } = renderHook(() =>
      useSwapQuote("ubze", "uvdl", "1000000", "bze1abc"),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    // First quote predates any block event.
    expect(result.current.quoted?.blockHeight).toBe("");

    await act(async () => {
      listeners["chain:block"]?.({ height: "42" });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(QuoteSwap).toHaveBeenCalledTimes(2);
    expect(result.current.quoted?.blockHeight).toBe("42");
  });

  it("returns a no-route result as a quote, not an error", async () => {
    QuoteSwap.mockResolvedValue({ noRoute: true });
    const { result } = renderHook(() =>
      useSwapQuote("ubze", "uosmo", "1000000", "bze1abc"),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.quoted?.quote.noRoute).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
