import { useCallback } from "react";
import { useTx, type ProtoMsg } from "./useTx";
import type { DelegationSplit } from "../utils/validatorScoring";

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

/**
 * Staking-specific transaction actions. A thin wrapper over the generic
 * {@link useTx} hook: it only builds the proto-JSON messages and the toast copy
 * for each staking operation — signing, broadcast, on-chain confirmation, and
 * the success/error toasts (with the explorer link) all live in `useTx`.
 */
export function useStakingTx(address: string): UseStakingTxResult {
  const { sendTx, isSubmitting } = useTx(address);

  const signAndBroadcast = useCallback(
    (msgs: ProtoMsg[], labels: TxLabels, memo = ""): Promise<boolean> =>
      sendTx({ msgs, pending: labels.pending, success: labels.success, memo }),
    [sendTx]
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
