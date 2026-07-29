import { useCallback } from "react";
import { useTx } from "./useTx";
import {
  buildAddLiquidityMsg,
  buildRemoveLiquidityMsg,
  minWithSlippage,
  type NumLike,
} from "../components/trade/pools/poolHelpers";

/** Add-liquidity request. All amounts are raw base-unit integers (strings/BigNumber). */
export interface AddLiquidityParams {
  poolId: string;
  baseAmount: string;
  quoteAmount: string;
  /** Expected LP shares minted, used with `slippage` to floor `min_lp_tokens`. */
  expectedShares: NumLike;
  /** Slippage tolerance in percent (e.g. 0.5). */
  slippage: number;
  onConfirmed?: () => void;
}

/** Remove-liquidity request. All amounts are raw base-unit integers. */
export interface RemoveLiquidityParams {
  poolId: string;
  lpTokens: string;
  /** Expected base/quote out, used with `slippage` to floor `min_base`/`min_quote`. */
  expectedBase: NumLike;
  expectedQuote: NumLike;
  slippage: number;
  onConfirmed?: () => void;
}

export interface UsePoolTxResult {
  /** Build + broadcast a MsgAddLiquidity (min shares floored by slippage). */
  addLiquidity: (params: AddLiquidityParams) => Promise<boolean>;
  /** Build + broadcast a MsgRemoveLiquidity (min-out floored by slippage). */
  removeLiquidity: (params: RemoveLiquidityParams) => Promise<boolean>;
  isSubmitting: boolean;
}

/**
 * Build tradebin liquidity messages and hand them to the generic {@link useTx}
 * pipeline — the same thin-wrapper pattern as {@link useSwapTx}. Minimum LP
 * tokens (add) and minimum amounts out (remove) are the expected values floored
 * by the slippage tolerance (big-number-safe), so the chain rejects any result
 * below them. Signing, fee, broadcast, confirmation and toasts all live in
 * `useTx`; a min-bound failure surfaces as its error toast. Field names are the
 * snake_case proto names the signing codec decodes.
 */
export function usePoolTx(address: string): UsePoolTxResult {
  const { sendTx, isSubmitting } = useTx(address);

  const addLiquidity = useCallback(
    (p: AddLiquidityParams): Promise<boolean> => {
      const msg = buildAddLiquidityMsg({
        creator: address,
        poolId: p.poolId,
        baseAmount: p.baseAmount,
        quoteAmount: p.quoteAmount,
        minLpTokens: minWithSlippage(p.expectedShares, p.slippage),
      });
      return sendTx({
        msgs: [msg],
        pending: "Adding liquidity…",
        success: "Liquidity added",
        onConfirmed: p.onConfirmed,
      });
    },
    [address, sendTx],
  );

  const removeLiquidity = useCallback(
    (p: RemoveLiquidityParams): Promise<boolean> => {
      const msg = buildRemoveLiquidityMsg({
        creator: address,
        poolId: p.poolId,
        lpTokens: p.lpTokens,
        minBase: minWithSlippage(p.expectedBase, p.slippage),
        minQuote: minWithSlippage(p.expectedQuote, p.slippage),
      });
      return sendTx({
        msgs: [msg],
        pending: "Removing liquidity…",
        success: "Liquidity removed",
        onConfirmed: p.onConfirmed,
      });
    },
    [address, sendTx],
  );

  return { addLiquidity, removeLiquidity, isSubmitting };
}
