import { useState, useCallback } from "react";
import { SignAndBroadcast, GetTxStatus, OpenURL } from "../../wailsjs/go/main/App";
import { explorerTxUrl } from "../utils/stakingHelpers";
import { notify } from "../notifications";
import type { LoadingHandle, NotifyAction } from "../notifications";

/**
 * A protobuf message in proto-JSON form: an "@type" plus its fields. The Go
 * backend decodes these via the interface registry, builds a SIGN_MODE_DIRECT
 * tx, signs, encodes, and broadcasts it (see App.SignAndBroadcast).
 */
export interface ProtoMsg {
  "@type": string;
  [key: string]: unknown;
}

/** Arguments to {@link UseTxResult.sendTx}. */
export interface SendTxOptions {
  /** Proto-JSON messages to sign and broadcast in a single tx. */
  msgs: ProtoMsg[];
  /** Toast copy shown while broadcasting and confirming. */
  pending: string;
  /** Toast title shown once the tx is accepted / confirmed. */
  success: string;
  /** Optional transaction memo. */
  memo?: string;
  /**
   * Called once the tx is confirmed on-chain (or accepted with no failure
   * within the confirmation window). Use it for data refreshes — never before
   * confirmation, so the UI stays free of optimistic updates. Not called on a
   * broadcast or on-chain failure.
   */
  onConfirmed?: () => void;
}

export interface UseTxResult {
  /**
   * Sign, broadcast, and track a transaction through its full lifecycle,
   * surfacing progress via the global notification system. Resolves to `true`
   * once the tx is accepted into the mempool (confirmation continues in the
   * background), or `false` if the broadcast is rejected.
   */
  sendTx: (opts: SendTxOptions) => Promise<boolean>;
  /** True while a broadcast is in flight. */
  isSubmitting: boolean;
}

// Post-broadcast confirmation. BROADCAST_MODE_SYNC only confirms mempool
// acceptance (CheckTx); the on-chain (DeliverTx) result is known once the tx is in
// a block. We poll GetTxStatus — first after ~2.5s (≈ one block), then every 2s up
// to ~12.5s total — and only declare success once confirmed. If it never appears in
// the window we fall back to "submitted" (the hash exists, so it's in the mempool).
const CONFIRM_INITIAL_DELAY_MS = 2500;
const CONFIRM_RETRY_DELAY_MS = 2000;
const CONFIRM_MAX_ATTEMPTS = 6;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface TxConfirmation {
  code: number;
  rawLog: string;
}

/** Poll the chain for the tx's on-chain result; null if not committed within the window. */
async function confirmTx(hash: string): Promise<TxConfirmation | null> {
  for (let attempt = 0; attempt < CONFIRM_MAX_ATTEMPTS; attempt++) {
    await sleep(attempt === 0 ? CONFIRM_INITIAL_DELAY_MS : CONFIRM_RETRY_DELAY_MS);
    try {
      const status = await GetTxStatus(hash);
      if (status?.found) {
        return { code: Number(status.code ?? 0), rawLog: String(status.rawLog ?? "") };
      }
    } catch {
      // Transient lookup error — keep polling.
    }
  }
  return null;
}

function explorerAction(hash: string): NotifyAction {
  return {
    label: "Open in explorer",
    external: true,
    onClick: () => OpenURL(explorerTxUrl(hash)),
  };
}

/**
 * Resolve a loading toast once the broadcast is confirmed on-chain. Runs detached
 * (not awaited) so the UI proceeds immediately while the toast keeps showing
 * "Confirming…" until the result is known — then success (with the explorer link)
 * or failure (with the on-chain raw_log). `onConfirmed` fires only on success.
 */
async function confirmAndResolve(
  handle: LoadingHandle,
  hash: string | undefined,
  successTitle: string,
  onConfirmed?: () => void
): Promise<void> {
  if (!hash) {
    handle.success({ title: successTitle });
    onConfirmed?.();
    return;
  }
  handle.update({ title: "Confirming transaction…" });

  const result = await confirmTx(hash);
  if (result && result.code !== 0) {
    handle.error({
      title: "Transaction failed",
      description: result.rawLog || "Transaction failed on-chain",
    });
    return;
  }
  // Confirmed with code 0, or not yet in a block within the window → submitted.
  handle.success({ title: successTitle, actions: [explorerAction(hash)] });
  onConfirmed?.();
}

/**
 * Generic transaction hook: the one way the UI runs a chain transaction.
 * Messages are built as proto-JSON and handed to the Go backend, which signs
 * (SIGN_MODE_DIRECT) and broadcasts them; the fee/gas/chain-id and signing auth
 * (keyring / in-memory password) are handled server-side by SignAndBroadcast.
 *
 * Outcomes surface through the global notification system: a loading toast while
 * broadcasting, then success (with an "Open in explorer" action when a hash is
 * present) or a human-readable failure (the chain's raw_log, never a raw error
 * object). Callers await the boolean and optionally pass `onConfirmed` for a
 * post-confirmation data refresh.
 */
export function useTx(address: string): UseTxResult {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sendTx = useCallback(
    async ({ msgs, pending, success, memo = "", onConfirmed }: SendTxOptions): Promise<boolean> => {
      if (!address || msgs.length === 0) return false;

      setIsSubmitting(true);
      const handle = notify.loading({ title: pending });
      try {
        const result = await SignAndBroadcast(address, JSON.stringify(msgs), memo);

        // code 0 means the tx passed CheckTx and entered the mempool. A missing
        // tx_response means the broadcast itself went wrong. The Go side
        // (logBroadcastResult) logs the code/raw_log to the app logs.
        const txResponse = result?.tx_response;
        const hash = txResponse?.txhash as string | undefined;
        if (!txResponse || txResponse.code !== 0) {
          const rawLog = (txResponse?.raw_log as string) ?? "Broadcast failed";
          handle.error({ title: "Transaction failed", description: rawLog });
          return false;
        }

        // Accepted into the mempool. Confirm the on-chain result in the background:
        // the toast stays in its loading state ("Confirming…") and resolves to
        // success (with the explorer link) or failure once the tx lands in a block.
        // Detached so the caller (e.g. a modal) can proceed/close immediately.
        void confirmAndResolve(handle, hash, success, onConfirmed);
        return true;
      } catch (err) {
        handle.error({ title: "Transaction failed", description: String(err) });
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [address]
  );

  return { sendTx, isSubmitting };
}
