import { useCallback } from "react";
import { useTx, type ProtoMsg } from "./useTx";

/** The MsgSend proto type URL — the cosmos bank send message. */
const TYPE_SEND = "/cosmos.bank.v1beta1.MsgSend";

export interface SendParams {
  /** Recipient bech32 address. */
  to: string;
  /** Denom being sent (base denom, e.g. "ubze"). */
  denom: string;
  /** Amount in base units (integer string). */
  uAmount: string;
  /** Optional memo. */
  memo?: string;
  /** Called once the tx is confirmed on-chain — use it to refresh balances. */
  onConfirmed?: () => void;
}

export interface UseSendTxResult {
  /** Build a MsgSend and broadcast it through the shared tx pipeline. */
  send: (params: SendParams) => Promise<boolean>;
  isSubmitting: boolean;
}

/**
 * Build the `MsgSend` proto-JSON ({@link TYPE_SEND}) and hand it to the generic
 * {@link useTx} hook — the same thin-wrapper pattern as `useStakingTx`. Signing,
 * gas/fee, broadcast, on-chain confirmation and the toast lifecycle (pending →
 * confirmed with explorer link → error) all live in `useTx`; this hook only
 * shapes the message and the toast copy.
 */
export function useSendTx(address: string): UseSendTxResult {
  const { sendTx, isSubmitting } = useTx(address);

  const send = useCallback(
    ({ to, denom, uAmount, memo = "", onConfirmed }: SendParams): Promise<boolean> => {
      const msg: ProtoMsg = {
        "@type": TYPE_SEND,
        from_address: address,
        to_address: to,
        amount: [{ denom, amount: uAmount }],
      };
      return sendTx({
        msgs: [msg],
        pending: "Sending…",
        success: "Transfer submitted",
        memo,
        onConfirmed,
      });
    },
    [address, sendTx]
  );

  return { send, isSubmitting };
}
