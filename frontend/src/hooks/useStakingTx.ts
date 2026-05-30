import { useState, useCallback } from "react";
import {
  GetAccountInfo,
  SignAmino,
  BroadcastTx,
} from "../../wailsjs/go/main/App";
import type { DelegationSplit } from "../utils/validatorScoring";

const CHAIN_ID = "beezee-1";
const FEE_AMOUNT = "10000"; // 0.01 BZE
const FEE_DENOM = "ubze";
const GAS_LIMIT = "300000";

interface AminoMsg {
  type: string;
  value: Record<string, unknown>;
}

interface UseStakingTxResult {
  delegate: (validatorAddr: string, amount: string) => Promise<boolean>;
  undelegate: (validatorAddr: string, amount: string) => Promise<boolean>;
  redelegate: (srcValidator: string, dstValidator: string, amount: string) => Promise<boolean>;
  claimNativeRewards: (validatorAddresses: string[]) => Promise<boolean>;
  autoStake: (splits: DelegationSplit[]) => Promise<boolean>;
  joinRewardStaking: (rewardId: string, amount: string, denom: string) => Promise<boolean>;
  exitRewardStaking: (rewardId: string) => Promise<boolean>;
  claimAll: (nativeValidators: string[], rewardIds: string[]) => Promise<boolean>;
  isSubmitting: boolean;
}

/**
 * Hook for constructing, signing, and broadcasting staking transactions.
 * Uses Amino signing via the Hub's Go wallet (SignAmino).
 */
export function useStakingTx(address: string): UseStakingTxResult {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const signAndBroadcast = useCallback(
    async (msgs: AminoMsg[], memo = ""): Promise<boolean> => {
      if (!address) return false;

      setIsSubmitting(true);
      try {
        // 1. Get account info for signing
        const accountInfo = await GetAccountInfo(address);
        const accountNumber = String(accountInfo.accountNumber ?? "0");
        const sequence = String(accountInfo.sequence ?? "0");

        // 2. Build amino sign doc
        const signDoc = {
          chain_id: CHAIN_ID,
          account_number: accountNumber,
          sequence: sequence,
          fee: {
            amount: [{ denom: FEE_DENOM, amount: FEE_AMOUNT }],
            gas: GAS_LIMIT,
          },
          msgs: msgs,
          memo: memo,
        };

        // 3. Sign via Go wallet
        const signResponse = await SignAmino(
          CHAIN_ID,
          address,
          JSON.stringify(signDoc)
        );

        // 4. Build broadcast payload
        // The sign response contains the signed doc + signature
        const broadcastBody = JSON.stringify({
          tx_bytes: btoa(JSON.stringify(signResponse)),
          mode: "BROADCAST_MODE_SYNC",
        });

        // 5. Broadcast
        const broadcastResult = await BroadcastTx(broadcastBody);

        // Check for errors
        const txResponse = broadcastResult?.tx_response;
        if (txResponse && txResponse.code !== 0) {
          console.error("[useStakingTx] tx failed:", txResponse.raw_log);
          return false;
        }

        return true;
      } catch (err) {
        console.error("[useStakingTx] error:", err);
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [address]
  );

  const delegate = useCallback(
    (validatorAddr: string, amount: string) =>
      signAndBroadcast([
        {
          type: "cosmos-sdk/MsgDelegate",
          value: {
            delegator_address: address,
            validator_address: validatorAddr,
            amount: { denom: "ubze", amount },
          },
        },
      ]),
    [address, signAndBroadcast]
  );

  const undelegate = useCallback(
    (validatorAddr: string, amount: string) =>
      signAndBroadcast([
        {
          type: "cosmos-sdk/MsgUndelegate",
          value: {
            delegator_address: address,
            validator_address: validatorAddr,
            amount: { denom: "ubze", amount },
          },
        },
      ]),
    [address, signAndBroadcast]
  );

  const redelegate = useCallback(
    (srcValidator: string, dstValidator: string, amount: string) =>
      signAndBroadcast([
        {
          type: "cosmos-sdk/MsgBeginRedelegate",
          value: {
            delegator_address: address,
            validator_src_address: srcValidator,
            validator_dst_address: dstValidator,
            amount: { denom: "ubze", amount },
          },
        },
      ]),
    [address, signAndBroadcast]
  );

  const claimNativeRewards = useCallback(
    (validatorAddresses: string[]) =>
      signAndBroadcast(
        validatorAddresses.map((valAddr) => ({
          type: "cosmos-sdk/MsgWithdrawDelegatorReward",
          value: {
            delegator_address: address,
            validator_address: valAddr,
          },
        }))
      ),
    [address, signAndBroadcast]
  );

  const autoStake = useCallback(
    (splits: DelegationSplit[]) =>
      signAndBroadcast(
        splits.map((split) => ({
          type: "cosmos-sdk/MsgDelegate",
          value: {
            delegator_address: address,
            validator_address: split.validatorAddress,
            amount: { denom: "ubze", amount: split.amount },
          },
        }))
      ),
    [address, signAndBroadcast]
  );

  const joinRewardStaking = useCallback(
    (rewardId: string, amount: string, denom: string) =>
      signAndBroadcast([
        {
          type: "rewards/MsgJoinStaking",
          value: {
            creator: address,
            reward_id: rewardId,
            amount: amount + denom,
          },
        },
      ]),
    [address, signAndBroadcast]
  );

  const exitRewardStaking = useCallback(
    (rewardId: string) =>
      signAndBroadcast([
        {
          type: "rewards/MsgExitStaking",
          value: {
            creator: address,
            reward_id: rewardId,
          },
        },
      ]),
    [address, signAndBroadcast]
  );

  const claimAll = useCallback(
    (nativeValidators: string[], rewardIds: string[]) => {
      const msgs: AminoMsg[] = [];

      // Native staking claim messages
      for (const valAddr of nativeValidators) {
        msgs.push({
          type: "cosmos-sdk/MsgWithdrawDelegatorReward",
          value: {
            delegator_address: address,
            validator_address: valAddr,
          },
        });
      }

      // Rewards staking claim messages
      for (const rewardId of rewardIds) {
        msgs.push({
          type: "rewards/MsgClaimStakingRewards",
          value: {
            creator: address,
            reward_id: rewardId,
          },
        });
      }

      if (msgs.length === 0) return Promise.resolve(false);
      return signAndBroadcast(msgs);
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
    exitRewardStaking,
    claimAll,
    isSubmitting,
  };
}
