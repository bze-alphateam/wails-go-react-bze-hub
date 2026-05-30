import { useState, useMemo } from "react";
import {
  Box,
  HStack,
  VStack,
  Text,
  Button,
  SimpleGrid,
  Badge,
} from "@chakra-ui/react";
import { LuCoins, LuGift, LuTrendingUp, LuChevronRight } from "react-icons/lu";
import { formatAmount, ubzeToHuman } from "../../utils/stakingHelpers";
import {
  scoreValidators,
  selectTopValidators,
  splitDelegation,
} from "../../utils/validatorScoring";
import { StakeModal } from "./modals/StakeModal";
import { useStakingTx } from "../../hooks/useStakingTx";
import type { Validator, DelegatorReward } from "../../utils/stakingTypes";

interface NativeStakingSimpleProps {
  validators: Validator[];
  totalDelegatedUbze: string;
  totalRewardsUbze: string;
  validatorRewards: DelegatorReward[];
  apr: string;
  unbondingDays: number;
  address: string;
  onReload: () => void;
  onSwitchToAdvanced: () => void;
}

export function NativeStakingSimple({
  validators,
  totalDelegatedUbze,
  totalRewardsUbze,
  validatorRewards,
  apr,
  unbondingDays,
  address,
  onReload,
  onSwitchToAdvanced,
}: NativeStakingSimpleProps) {
  const [showStakeModal, setShowStakeModal] = useState(false);
  const { autoStake, claimNativeRewards, undelegate, isSubmitting } =
    useStakingTx(address);

  const delegatedHuman = formatAmount(ubzeToHuman(totalDelegatedUbze));
  const rewardsHuman = formatAmount(ubzeToHuman(totalRewardsUbze), 4);
  const hasDelegation = BigInt(totalDelegatedUbze || "0") > 0n;
  const hasRewards = BigInt(totalRewardsUbze?.split(".")[0] || "0") > 0n;

  const rewardValidators = useMemo(
    () => validatorRewards.map((r) => r.validator_address),
    [validatorRewards]
  );

  const handleStake = async (ubzeAmount: string) => {
    const scores = scoreValidators(validators);
    const top = selectTopValidators(scores);
    const splits = splitDelegation(ubzeAmount, top);
    const success = await autoStake(splits);
    if (success) {
      setShowStakeModal(false);
      onReload();
    }
    return success;
  };

  const handleClaim = async () => {
    if (rewardValidators.length === 0) return;
    const success = await claimNativeRewards(rewardValidators);
    if (success) onReload();
  };

  const handleUndelegate = async () => {
    // In simple view, undelegate evenly from all validators
    // For now, just switch to advanced view where user picks
    onSwitchToAdvanced();
  };

  return (
    <Box
      p="5"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      mb="4"
    >
      {/* Header */}
      <HStack justify="space-between" mb="4">
        <HStack gap="2">
          <Text fontSize="md" fontWeight="bold">
            Native Staking
          </Text>
          <Badge colorPalette="teal" size="sm">
            BZE
          </Badge>
        </HStack>
        <Button
          size="xs"
          variant="ghost"
          onClick={onSwitchToAdvanced}
        >
          Advanced {LuChevronRight({}) as React.ReactNode}
        </Button>
      </HStack>

      {/* Stats Grid */}
      <SimpleGrid columns={3} gap="4" mb="5">
        <Box p="3" bg="bg.subtle" borderRadius="md">
          <HStack gap="2" mb="1">
            {LuCoins({ size: 14 }) as React.ReactNode}
            <Text fontSize="xs" color="fg.muted">
              Staked
            </Text>
          </HStack>
          <Text fontSize="lg" fontWeight="bold">
            {delegatedHuman}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            BZE
          </Text>
        </Box>

        <Box p="3" bg="bg.subtle" borderRadius="md">
          <HStack gap="2" mb="1">
            {LuGift({ size: 14 }) as React.ReactNode}
            <Text fontSize="xs" color="fg.muted">
              Rewards
            </Text>
          </HStack>
          <Text fontSize="lg" fontWeight="bold" color="teal.500">
            {rewardsHuman}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            BZE
          </Text>
        </Box>

        <Box p="3" bg="bg.subtle" borderRadius="md">
          <HStack gap="2" mb="1">
            {LuTrendingUp({ size: 14 }) as React.ReactNode}
            <Text fontSize="xs" color="fg.muted">
              APR
            </Text>
          </HStack>
          <Text fontSize="lg" fontWeight="bold" color="green.500">
            {apr}%
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {unbondingDays}d unlock
          </Text>
        </Box>
      </SimpleGrid>

      {/* Action Buttons */}
      <HStack gap="3">
        <Button
          flex="1"
          colorPalette="teal"
          onClick={() => setShowStakeModal(true)}
          disabled={isSubmitting}
        >
          Stake
        </Button>
        <Button
          flex="1"
          variant="outline"
          colorPalette="teal"
          onClick={handleClaim}
          disabled={!hasRewards || isSubmitting}
          loading={isSubmitting}
        >
          Claim
        </Button>
        {hasDelegation && (
          <Button
            flex="1"
            variant="outline"
            onClick={handleUndelegate}
            disabled={isSubmitting}
          >
            Undelegate
          </Button>
        )}
      </HStack>

      {/* Stake Modal */}
      <StakeModal
        isOpen={showStakeModal}
        onClose={() => setShowStakeModal(false)}
        onStake={handleStake}
        isSubmitting={isSubmitting}
        validators={validators}
      />
    </Box>
  );
}
