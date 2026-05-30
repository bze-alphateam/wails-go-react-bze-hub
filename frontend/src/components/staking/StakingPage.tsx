import { useMemo } from "react";
import { Box, Text, Center, Spinner, VStack } from "@chakra-ui/react";
import { useStakingData } from "../../hooks/useStakingData";
import { useStakingTx } from "../../hooks/useStakingTx";
import {
  calcNativeStakingApr,
  unbondingTimeToDays,
  sumDecCoins,
} from "../../utils/stakingHelpers";
import { StakingStatsBar } from "./StakingStatsBar";
import { NativeStakingSection } from "./NativeStakingSection";
import { RewardsStakingSection } from "./RewardsStakingSection";

interface StakingPageProps {
  address: string;
  proxyTarget: string;
}

export function StakingPage({ address, proxyTarget }: StakingPageProps) {
  const { data, isLoading, error, reload } = useStakingData(address, proxyTarget);
  const { claimAll, isSubmitting } = useStakingTx(address);

  // Derived values
  const apr = useMemo(() => {
    if (!data?.annualProvisions || !data?.distributionParams || !data?.pool) return "0";
    return calcNativeStakingApr(
      data.annualProvisions.annual_provisions,
      data.distributionParams.params.community_tax,
      data.pool.pool.bonded_tokens
    );
  }, [data]);

  const unbondingDays = useMemo(() => {
    if (!data?.stakingParams) return 0;
    return unbondingTimeToDays(data.stakingParams.params.unbonding_time);
  }, [data]);

  const totalDelegatedUbze = useMemo(() => {
    if (!data?.delegations) return "0";
    let total = 0n;
    for (const del of data.delegations) {
      total += BigInt(del.balance.amount || "0");
    }
    return total.toString();
  }, [data]);

  const totalNativeRewardsUbze = useMemo(() => {
    if (!data?.rewards?.total) return "0";
    return sumDecCoins(data.rewards.total, "ubze");
  }, [data]);

  const validatorRewards = useMemo(() => {
    return data?.rewards?.rewards || [];
  }, [data]);

  const rewardValidators = useMemo(() => {
    return validatorRewards.map((r) => r.validator_address);
  }, [validatorRewards]);

  // For stats bar: sum native + rewards staking total staked
  const totalStakedUbze = useMemo(() => {
    let total = BigInt(totalDelegatedUbze);
    // Add rewards staking amounts
    if (data?.rewardParticipants) {
      for (const p of data.rewardParticipants) {
        // Only count ubze denominated stakes
        const reward = data.stakingRewards?.find((r) => r.reward_id === p.reward_id);
        if (reward?.staking_denom === "ubze") {
          total += BigInt(p.amount || "0");
        }
      }
    }
    return total.toString();
  }, [totalDelegatedUbze, data]);

  // For stats bar: primary reward + count of other denoms
  const rewardsSummary = useMemo(() => {
    const hasNativeRewards = BigInt(totalNativeRewardsUbze.split(".")[0] || "0") > 0n;
    // Count unique non-ubze reward denoms from rewards staking
    const otherDenoms = new Set<string>();
    // TODO: calculate actual pending rewards from rewards staking
    return {
      primaryReward: hasNativeRewards
        ? { amount: totalNativeRewardsUbze, denom: "ubze" }
        : null,
      otherCount: otherDenoms.size,
      hasRewards: hasNativeRewards,
    };
  }, [totalNativeRewardsUbze]);

  const handleClaimAll = async () => {
    // Collect reward IDs where user has active participation
    const rewardIds = data?.rewardParticipants?.map((p) => p.reward_id) || [];
    const success = await claimAll(rewardValidators, rewardIds);
    if (success) reload();
  };

  // Loading state
  if (isLoading && !data) {
    return (
      <Center h="100%" flexDirection="column" gap="3">
        <Spinner size="lg" color="teal.500" />
        <Text color="fg.muted">Loading staking data...</Text>
      </Center>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <Center h="100%" flexDirection="column" gap="3">
        <Text color="red.500">Failed to load staking data</Text>
        <Text fontSize="sm" color="fg.muted">
          {error}
        </Text>
        <Box mt="2">
          <button onClick={reload}>Retry</button>
        </Box>
      </Center>
    );
  }

  // No wallet
  if (!address) {
    return (
      <Center h="100%" flexDirection="column" gap="3">
        <Text color="fg.muted">Connect a wallet to view staking</Text>
      </Center>
    );
  }

  return (
    <Box h="100%" overflowY="auto" p="4">
      <VStack gap="0" align="stretch" maxW="1000px" mx="auto">
        {/* Stats Bar */}
        <StakingStatsBar
          totalStakedUbze={totalStakedUbze}
          primaryReward={rewardsSummary.primaryReward}
          otherRewardsCount={rewardsSummary.otherCount}
          onClaimAll={handleClaimAll}
          isClaimingAll={isSubmitting}
          hasRewards={rewardsSummary.hasRewards}
        />

        {/* Native Staking Section */}
        <NativeStakingSection
          validators={data?.validators || []}
          delegations={data?.delegations || []}
          unbonding={data?.unbonding || []}
          validatorRewards={validatorRewards}
          totalRewardsUbze={totalNativeRewardsUbze}
          totalDelegatedUbze={totalDelegatedUbze}
          apr={apr}
          unbondingDays={unbondingDays}
          address={address}
          onReload={reload}
        />

        {/* Rewards Staking Section */}
        <RewardsStakingSection
          stakingRewards={data?.stakingRewards || []}
          participants={data?.rewardParticipants || []}
          address={address}
          onReload={reload}
        />
      </VStack>
    </Box>
  );
}
