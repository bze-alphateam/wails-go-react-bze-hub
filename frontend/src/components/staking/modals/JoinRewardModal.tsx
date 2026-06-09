import { useState } from "react";
import {
  Box,
  Button,
  HStack,
  Input,
  Text,
  VStack,
  Portal,
  Dialog,
} from "@chakra-ui/react";
import { humanToUbze, formatAmount, ubzeToHuman } from "../../../utils/stakingHelpers";
import { useStakingTx } from "../../../hooks/useStakingTx";
import type { StakingReward } from "../../../utils/stakingTypes";

interface JoinRewardModalProps {
  isOpen: boolean;
  onClose: () => void;
  reward: StakingReward;
  address: string;
  onSuccess: () => void;
}

export function JoinRewardModal({
  isOpen,
  onClose,
  reward,
  address,
  onSuccess,
}: JoinRewardModalProps) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const { joinRewardStaking, isSubmitting } = useStakingTx(address);

  const stakingDenom = reward.staking_denom;
  const prizeDenom = reward.prize_denom === "ubze" ? "BZE" : reward.prize_denom;
  const stakingDenomDisplay = stakingDenom === "ubze" ? "BZE" : stakingDenom;
  const minStake = reward.min_stake;
  const lockPeriod = reward.lock;

  const handleClose = () => {
    if (isSubmitting) return;
    setAmount("");
    setError("");
    onClose();
  };

  const handleJoin = async () => {
    const num = parseFloat(amount);
    if (!amount || isNaN(num) || num <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    const stakeAmount = humanToUbze(amount);
    if (BigInt(stakeAmount) < BigInt(minStake || "0")) {
      setError(`Minimum stake is ${formatAmount(ubzeToHuman(minStake))} ${stakingDenomDisplay}`);
      return;
    }

    setError("");
    // Outcome surfaces as a global toast; close the modal once submitted.
    const success = await joinRewardStaking(reward.reward_id, stakeAmount, stakingDenom);
    if (success) {
      onSuccess();
      handleClose();
    }
  };

  const progress = reward.duration > 0
    ? Math.round((reward.payouts / reward.duration) * 100)
    : 0;

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(e: { open: boolean }) => !isSubmitting && !e.open && handleClose()}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="450px" borderRadius="xl">
            <Dialog.Header>
              <Dialog.Title fontWeight="bold">
                Join Staking Reward #{reward.reward_id}
              </Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <VStack gap="4" align="stretch">
                {/* Reward Info */}
                <Box p="3" bg="bg.subtle" borderRadius="md">
                  <VStack gap="1" align="stretch">
                    <HStack justify="space-between">
                      <Text fontSize="xs" color="fg.muted">Stake</Text>
                      <Text fontSize="xs" fontWeight="medium">{stakingDenomDisplay}</Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text fontSize="xs" color="fg.muted">Earn</Text>
                      <Text fontSize="xs" fontWeight="medium">{prizeDenom}</Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text fontSize="xs" color="fg.muted">Progress</Text>
                      <Text fontSize="xs">{reward.payouts}/{reward.duration} ({progress}%)</Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text fontSize="xs" color="fg.muted">Total Staked</Text>
                      <Text fontSize="xs">{formatAmount(ubzeToHuman(reward.staked_amount))}</Text>
                    </HStack>
                    {lockPeriod > 0 && (
                      <HStack justify="space-between">
                        <Text fontSize="xs" color="fg.muted">Lock Period</Text>
                        <Text fontSize="xs">{lockPeriod} epoch{lockPeriod > 1 ? "s" : ""}</Text>
                      </HStack>
                    )}
                    {BigInt(minStake || "0") > BigInt(0) && (
                      <HStack justify="space-between">
                        <Text fontSize="xs" color="fg.muted">Min Stake</Text>
                        <Text fontSize="xs">{formatAmount(ubzeToHuman(minStake))} {stakingDenomDisplay}</Text>
                      </HStack>
                    )}
                  </VStack>
                </Box>

                {/* Amount Input */}
                <Box>
                  <Text fontSize="sm" fontWeight="medium" mb="2">
                    Amount ({stakingDenomDisplay})
                  </Text>
                  <Input
                    size="lg"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setAmount(e.target.value);
                      setError("");
                    }}
                    disabled={isSubmitting}
                  />
                  {error && (
                    <Text fontSize="xs" color="red.500" mt="1">{error}</Text>
                  )}
                </Box>
              </VStack>
            </Dialog.Body>

            <Dialog.Footer>
              <HStack gap="3" width="full">
                <Button flex="1" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button
                  flex="1"
                  colorPalette="teal"
                  onClick={handleJoin}
                  loading={isSubmitting}
                  disabled={!amount || isSubmitting}
                >
                  Join Staking
                </Button>
              </HStack>
            </Dialog.Footer>

            <Dialog.CloseTrigger disabled={isSubmitting} />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
