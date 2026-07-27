import { useCallback } from "react";
import { useTx, type ProtoMsg } from "./useTx";
import { BuildOrderMessages } from "../../wailsjs/go/main/App";
import { tradebin } from "../../wailsjs/go/models";
import { buildCancelMsg } from "../components/trade/terminal/orderHelpers";

export interface UseOrderTxResult {
  /**
   * Ask the Go engine for the ordered message list to place an order (fill
   * crossing levels, then rest the leftover). amount/price are chain-native
   * u-units. The caller reviews the outcome before broadcasting with placeOrder.
   */
  buildOrder: (
    marketId: string,
    isBuy: boolean,
    uAmount: string,
    uPrice: string,
  ) => Promise<Array<Record<string, unknown>>>;
  /** Broadcast a pre-built order message list as one tx. */
  placeOrder: (msgs: Array<Record<string, unknown>>, onConfirmed?: () => void) => Promise<boolean>;
  /** Cancel one or more of the user's orders in a single tx. */
  cancelOrders: (orders: tradebin.Order[], onConfirmed?: () => void) => Promise<boolean>;
  isSubmitting: boolean;
}

/**
 * Order transactions, wrapping the generic {@link useTx} pipeline the same way
 * `useSendTx` does. Placing an order is two steps by design: `buildOrder` returns
 * the message list (so the UI can summarize "fills N, rests the remainder"),
 * then `placeOrder` broadcasts it. Cancels are built entirely client-side.
 */
export function useOrderTx(address: string): UseOrderTxResult {
  const { sendTx, isSubmitting } = useTx(address);

  const buildOrder = useCallback(
    (marketId: string, isBuy: boolean, uAmount: string, uPrice: string) =>
      BuildOrderMessages(marketId, address, isBuy, uAmount, uPrice),
    [address],
  );

  const placeOrder = useCallback(
    (msgs: Array<Record<string, unknown>>, onConfirmed?: () => void) =>
      sendTx({
        msgs: msgs as unknown as ProtoMsg[],
        pending: "Placing order…",
        success: "Order submitted",
        onConfirmed,
      }),
    [sendTx],
  );

  const cancelOrders = useCallback(
    (orders: tradebin.Order[], onConfirmed?: () => void) => {
      const msgs = orders.map((o) => buildCancelMsg(address, o));
      return sendTx({
        msgs,
        pending: orders.length > 1 ? "Cancelling orders…" : "Cancelling order…",
        success: "Cancellation submitted",
        onConfirmed,
      });
    },
    [address, sendTx],
  );

  return { buildOrder, placeOrder, cancelOrders, isSubmitting };
}
