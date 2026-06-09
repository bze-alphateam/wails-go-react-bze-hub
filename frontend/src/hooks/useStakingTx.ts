import { useState, useCallback } from "react";
import { SignAndBroadcast, GetTxStatus, OpenURL } from "../../wailsjs/go/main/App";
import { explorerTxUrl } from "../utils/stakingHelpers";
import { notify } from "../notifications";
import type { LoadingHandle, NotifyAction } from "../notifications";
import type { DelegationSplit } from "../utils/validatorScoring";

/**
 * A protobuf message in proto-JSON form: an "@type" plus its fields. The Go
 * backend decodes these via the interface registry, builds a SIGN_MODE_DIRECT
 * tx, signs, encodes, and broadcasts it (see App.SignAndBroadcast).
 */
interface ProtoMsg {
  "@type": string;
  [key: string]: unknown;
}

/** Per-action toast copy (what's shown while pending and on success). */
interface TxLabels {
  pending: string;
  success: string;
}

interface UseStakingTxResult {
  delegate: (validatorAddr: string, amount: string) => Promise<boolean>;
  undelegate: (validatorAddr: string, amount: string) => Promise<boolean>;
  redelegate: (srcValidator: string, dstValidator: string, amount: string) => Promise<boolean>;
  claimNativeRewards: (validatorAddresses: string[]) => Promise<boolean>;
  autoStake: (splits: DelegationSplit[]) => Promise<boolean>;
  joinRewardStaking: (rewardId: string, amount: string, denom: string) => Promise<boolean>;
  claimRewardStaking: (rewardId: string) => Promise<boolean>;
  exitRewardStaking: (rewardId: string) => Promise<boolean>;
  claimAll: (nativeValidators: string[], rewardIds: string[]) => Promise<boolean>;
  isSubmitting: boolean;
}

const NATIVE_DENOM = "ubze";

// Proto message type URLs.
const TYPE_DELEGATE = "/cosmos.staking.v1beta1.MsgDelegate";
const TYPE_UNDELEGATE = "/cosmos.staking.v1beta1.MsgUndelegate";
const TYPE_REDELEGATE = "/cosmos.staking.v1beta1.MsgBeginRedelegate";
const TYPE_WITHDRAW_REWARD = "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward";
const TYPE_JOIN_STAKING = "/bze.rewards.MsgJoinStaking";
const TYPE_CLAIM_STAKING = "/bze.rewards.MsgClaimStakingRewards";
const TYPE_EXIT_STAKING = "/bze.rewards.MsgExitStaking";

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
 * or failure (with the on-chain raw_log).
 */
async function confirmAndResolve(
  handle: LoadingHandle,
  hash: string | undefined,
  successTitle: string
): Promise<void> {
  if (!hash) {
    handle.success({ title: successTitle });
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
}

/**
 * Hook for constructing and broadcasting staking transactions. Messages are built
 * as proto-JSON and handed to the Go backend, which signs (SIGN_MODE_DIRECT) and
 * broadcasts them. The fee/gas/chain-id are applied server-side.
 *
 * Outcomes surface through the global notification system: a loading toast while
 * broadcasting, then success (with an "Open in explorer" action when a hash is
 * present) or failure (with the chain's raw_log). Callers just await the boolean.
 */
export function useStakingTx(address: string): UseStakingTxResult {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const signAndBroadcast = useCallback(
    async (msgs: ProtoMsg[], labels: TxLabels, memo = ""): Promise<boolean> => {
      if (!address || msgs.length === 0) return false;

      setIsSubmitting(true);
      const handle = notify.loading({ title: labels.pending });
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
        void confirmAndResolve(handle, hash, labels.success);
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

  const delegate = useCallback(
    (validatorAddr: string, amount: string) =>
      signAndBroadcast(
        [
          {
            "@type": TYPE_DELEGATE,
            delegator_address: address,
            validator_address: validatorAddr,
            amount: { denom: NATIVE_DENOM, amount },
          },
        ],
        { pending: "Delegating…", success: "Delegation submitted" }
      ),
    [address, signAndBroadcast]
  );

  const undelegate = useCallback(
    (validatorAddr: string, amount: string) =>
      signAndBroadcast(
        [
          {
            "@type": TYPE_UNDELEGATE,
            delegator_address: address,
            validator_address: validatorAddr,
            amount: { denom: NATIVE_DENOM, amount },
          },
        ],
        { pending: "Undelegating…", success: "Undelegation submitted" }
      ),
    [address, signAndBroadcast]
  );

  const redelegate = useCallback(
    (srcValidator: string, dstValidator: string, amount: string) =>
      signAndBroadcast(
        [
          {
            "@type": TYPE_REDELEGATE,
            delegator_address: address,
            validator_src_address: srcValidator,
            validator_dst_address: dstValidator,
            amount: { denom: NATIVE_DENOM, amount },
          },
        ],
        { pending: "Moving stake…", success: "Stake moved" }
      ),
    [address, signAndBroadcast]
  );

  const claimNativeRewards = useCallback(
    (validatorAddresses: string[]) =>
      signAndBroadcast(
        validatorAddresses.map((valAddr) => ({
          "@type": TYPE_WITHDRAW_REWARD,
          delegator_address: address,
          validator_address: valAddr,
        })),
        { pending: "Claiming rewards…", success: "Rewards claimed" }
      ),
    [address, signAndBroadcast]
  );

  const autoStake = useCallback(
    (splits: DelegationSplit[]) =>
      signAndBroadcast(
        splits.map((split) => ({
          "@type": TYPE_DELEGATE,
          delegator_address: address,
          validator_address: split.validatorAddress,
          amount: { denom: NATIVE_DENOM, amount: split.amount },
        })),
        { pending: "Staking…", success: "Stake submitted" }
      ),
    [address, signAndBroadcast]
  );

  const joinRewardStaking = useCallback(
    (rewardId: string, amount: string, denom: string) =>
      signAndBroadcast(
        [
          {
            "@type": TYPE_JOIN_STAKING,
            creator: address,
            reward_id: rewardId,
            amount: amount + denom, // coin string, e.g. "1000000ubze"
          },
        ],
        { pending: "Joining reward program…", success: "Joined reward program" }
      ),
    [address, signAndBroadcast]
  );

  const claimRewardStaking = useCallback(
    (rewardId: string) =>
      signAndBroadcast(
        [
          {
            "@type": TYPE_CLAIM_STAKING,
            creator: address,
            reward_id: rewardId,
          },
        ],
        { pending: "Claiming rewards…", success: "Rewards claimed" }
      ),
    [address, signAndBroadcast]
  );

  const exitRewardStaking = useCallback(
    (rewardId: string) =>
      signAndBroadcast(
        [
          {
            "@type": TYPE_EXIT_STAKING,
            creator: address,
            reward_id: rewardId,
          },
        ],
        { pending: "Starting unlock…", success: "Unlock started" }
      ),
    [address, signAndBroadcast]
  );

  const claimAll = useCallback(
    (nativeValidators: string[], rewardIds: string[]) => {
      const msgs: ProtoMsg[] = [];

      for (const valAddr of nativeValidators) {
        msgs.push({
          "@type": TYPE_WITHDRAW_REWARD,
          delegator_address: address,
          validator_address: valAddr,
        });
      }

      for (const rewardId of rewardIds) {
        msgs.push({
          "@type": TYPE_CLAIM_STAKING,
          creator: address,
          reward_id: rewardId,
        });
      }

      if (msgs.length === 0) return Promise.resolve(false);
      return signAndBroadcast(msgs, {
        pending: "Claiming all rewards…",
        success: "Rewards claimed",
      });
    },
    [address, signAndBroadcast]
  );

  return {
    delegate,
    undelegate,
    redelegate,
    claimNativeRewards,
    autoStake,
    joinRewardStaking,
    claimRewardStaking,
    exitRewardStaking,
    claimAll,
    isSubmitting,
  };
}
