import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import BigNumber from "bignumber.js";

// Capture what usePoolTx hands to the generic tx pipeline.
const { sendTx } = vi.hoisted(() => ({ sendTx: vi.fn() }));
vi.mock("./useTx", () => ({
  useTx: () => ({ sendTx, isSubmitting: false }),
}));

import { usePoolTx } from "./usePoolTx";

beforeEach(() => {
  sendTx.mockReset();
  sendTx.mockResolvedValue(true);
});

describe("usePoolTx", () => {
  it("builds MsgAddLiquidity with slippage-floored min_lp_tokens", async () => {
    const { result } = renderHook(() => usePoolTx("bze1abc"));
    await act(async () => {
      await result.current.addLiquidity({
        poolId: "ubze/uvdl",
        baseAmount: "1000",
        quoteAmount: "2000",
        expectedShares: new BigNumber("1000"), // 1% → min = floor(1000 * 0.99) = 990
        slippage: 1,
      });
    });
    expect(sendTx.mock.calls[0][0].msgs[0]).toEqual({
      "@type": "/bze.tradebin.MsgAddLiquidity",
      creator: "bze1abc",
      pool_id: "ubze/uvdl",
      base_amount: "1000",
      quote_amount: "2000",
      min_lp_tokens: "990",
    });
  });

  it("builds MsgRemoveLiquidity with slippage-floored min_base/min_quote", async () => {
    const { result } = renderHook(() => usePoolTx("bze1abc"));
    await act(async () => {
      await result.current.removeLiquidity({
        poolId: "ubze/uvdl",
        lpTokens: "500",
        expectedBase: new BigNumber("1000"), // 0.5% → floor(1000 * 0.995) = 995
        expectedQuote: new BigNumber("2000"), // floor(2000 * 0.995) = 1990
        slippage: 0.5,
      });
    });
    expect(sendTx.mock.calls[0][0].msgs[0]).toEqual({
      "@type": "/bze.tradebin.MsgRemoveLiquidity",
      creator: "bze1abc",
      pool_id: "ubze/uvdl",
      lp_tokens: "500",
      min_base: "995",
      min_quote: "1990",
    });
  });
});
