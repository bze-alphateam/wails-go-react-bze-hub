import { useCallback } from "react";
import { useTx, type ProtoMsg } from "./useTx";
import { amm } from "../../wailsjs/go/models";
import { minOutputBase } from "../components/trade/swapHelpers";

/** The tradebin multi-swap proto type URL. */
const TYPE_MULTI_SWAP = "/bze.tradebin.MsgMultiSwap";

export interface SwapParams {
  /** The current AMM quote (its `routes` map straight onto MsgMultiSwap.routes). */
  quote: amm.SwapQuote;
  /** Input denom being spent. */
  denomIn: string;
  /** Output denom being received. */
  denomOut: string;
  /** Input amount in base units (integer string). */
  uAmountIn: string;
  /** Slippage tolerance in percent (e.g. 0.5). */
  slippage: number;
  /** Called once the swap is confirmed on-chain — refresh balances. */
  onConfirmed?: () => void;
}

export interface UseSwapTxResult {
  /** Build a MsgMultiSwap from the quote and broadcast it. */
  swap: (params: SwapParams) => Promise<boolean>;
  isSubmitting: boolean;
}

/**
 * Build the tradebin `MsgMultiSwap` proto-JSON from a quote and hand it to the
 * generic {@link useTx} pipeline — the same thin-wrapper pattern as `useSendTx`.
 * `min_output.amount` is the expected output floored by the slippage tolerance
 * (via {@link minOutputBase}, big-number-safe, no floats), so the chain rejects
 * any fill below it. Signing, fee, broadcast, on-chain confirmation and the toast
 * lifecycle all live in `useTx`; a min-output (slippage) failure surfaces as its
 * error toast. Field names are the snake_case proto names the signing codec
 * decodes (`min_output`).
 */
export function useSwapTx(address: string): UseSwapTxResult {
  const { sendTx, isSubmitting } = useTx(address);

  const swap = useCallback(
    ({ quote, denomIn, denomOut, uAmountIn, slippage, onConfirmed }: SwapParams): Promise<boolean> => {
      const msg: ProtoMsg = {
        "@type": TYPE_MULTI_SWAP,
        creator: address,
        routes: quote.routes,
        input: { denom: denomIn, amount: uAmountIn },
        min_output: { denom: denomOut, amount: minOutputBase(quote.expectedOut, slippage) },
      };
      return sendTx({
        msgs: [msg],
        pending: "Swapping…",
        success: "Swap submitted",
        onConfirmed,
      });
    },
    [address, sendTx],
  );

  return { swap, isSubmitting };
}
