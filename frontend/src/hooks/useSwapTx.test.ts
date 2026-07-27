import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { amm } from "../../wailsjs/go/models";

// Capture what useSwapTx hands to the generic tx pipeline.
const { sendTx } = vi.hoisted(() => ({ sendTx: vi.fn() }));
vi.mock("./useTx", () => ({
  useTx: () => ({ sendTx, isSubmitting: false }),
}));

import { useSwapTx } from "./useSwapTx";

const QUOTE = {
  noRoute: false,
  routes: ["1", "2"],
  expectedOut: "2500000",
  priceImpact: "1.5",
} as unknown as amm.SwapQuote;

beforeEach(() => {
  sendTx.mockReset();
  sendTx.mockResolvedValue(true);
});

describe("useSwapTx", () => {
  it("composes a MsgMultiSwap from the quote with a slippage-floored min_output", async () => {
    const { result } = renderHook(() => useSwapTx("bze1abc"));
    await act(async () => {
      await result.current.swap({
        quote: QUOTE,
        denomIn: "ubze",
        denomOut: "uvdl",
        uAmountIn: "1000000",
        slippage: 1, // 1% → min = floor(2500000 * 0.99) = 2475000
      });
    });

    expect(sendTx).toHaveBeenCalledTimes(1);
    const opts = sendTx.mock.calls[0][0];
    expect(opts.msgs).toHaveLength(1);
    expect(opts.msgs[0]).toEqual({
      "@type": "/bze.tradebin.MsgMultiSwap",
      creator: "bze1abc",
      routes: ["1", "2"],
      input: { denom: "ubze", amount: "1000000" },
      min_output: { denom: "uvdl", amount: "2475000" },
    });
  });

  it("floors min_output down (no float drift)", async () => {
    const { result } = renderHook(() => useSwapTx("bze1abc"));
    await act(async () => {
      await result.current.swap({
        quote: { ...QUOTE, expectedOut: "1000001" } as amm.SwapQuote,
        denomIn: "ubze",
        denomOut: "uvdl",
        uAmountIn: "1",
        slippage: 0.5, // floor(1000001 * 0.995) = floor(995000.995) = 995000
      });
    });
    expect(sendTx.mock.calls[0][0].msgs[0].min_output.amount).toBe("995000");
  });
});
