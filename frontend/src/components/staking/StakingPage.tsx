import { useMemo } from "react";
import { Box, Text, Center, Spinner, VStack, HStack, Button } from "@chakra-ui/react";
import { SectionTabs } from "../SectionTabs";
import { useSectionView } from "../../hooks/useSectionView";
import { useStakingData } from "../../hooks/useStakingData";
import { useStakingTx } from "../../hooks/useStakingTx";
import {
  calcNativeStakingApr,
  unbondingTimeToDays,
  sumDecCoins,
} from "../../utils/stakingHelpers";
import { StakingStatsBar } from "./StakingStatsBar";
import { StakingCompact } from "./StakingCompact";
import { NativeStakingAdvanced } from "./NativeStakingAdvanced";
import { RewardsStakingSection } from "./RewardsStakingSection";
import type { Validator } from "../../utils/stakingTypes";

interface StakingPageProps {
  address: string;
  proxyTarget: string;
}

export function StakingPage({ address, proxyTarget }: StakingPageProps) {
  const { data, isLoading, error, reload } = useStakingData(address, proxyTarget);
  const { claimAll, isSubmitting } = useStakingTx(address);

  // Earn's Simple/Advanced views, persisted per device via the app-wide
  // per-section pattern. "simple" = the compact overview; "advanced" = the
  // full validator table + rewards.
  const { view, setView } = useSectionView("earn");

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
    for (const del of data.delegations) total += BigInt(del.balance.amount || "0");
    return total.toString();
  }, [data]);

  const totalNativeRewardsUbze = useMemo(() => {
    if (!data?.rewards?.total) return "0";
    return sumDecCoins(data.rewards.total, "ubze");
  }, [data]);

  const validatorRewards = useMemo(() => data?.rewards?.rewards || [], [data]);
  const rewardValidators = useMemo(
    () => validatorRewards.map((r) => r.validator_address),
    [validatorRewards]
  );

  // Validators bonded list merged with the (possibly jailed) validators the user
  // delegated to — so the advanced table shows a jailed delegation, not a gap.
  const mergedValidators = useMemo<Validator[]>(() => {
    const m = new Map<string, Validator>();
    for (const v of data?.validators || []) m.set(v.operator_address, v);
    for (const v of data?.delegatedValidators || []) {
      if (!m.has(v.operator_address)) m.set(v.operator_address, v);
    }
    return Array.from(m.values());
  }, [data]);

  const totalStakedUbze = useMemo(() => {
    let total = BigInt(totalDelegatedUbze);
    if (data?.rewardParticipants) {
      for (const p of data.rewardParticipants) {
        const reward = data.stakingRewards?.find((r) => r.reward_id === p.reward_id);
        if (reward?.staking_denom === "ubze") total += BigInt(p.amount || "0");
      }
    }
    return total.toString();
  }, [totalDelegatedUbze, data]);

  const rewardsSummary = useMemo(() => {
    const hasNativeRewards = BigInt(totalNativeRewardsUbze.split(".")[0] || "0") > 0n;
    return {
      primaryReward: hasNativeRewards
        ? { amount: totalNativeRewardsUbze, denom: "ubze" }
        : null,
      otherCount: 0,
      hasRewards: hasNativeRewards,
    };
  }, [totalNativeRewardsUbze]);

  const handleClaimAll = async () => {
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
          <Button size="sm" onClick={reload}>Retry</Button>
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
      <VStack gap="4" align="stretch" maxW="1000px" mx="auto">
        {/* Header + view toggle */}
        <HStack justify="space-between">
          <Text fontSize="lg" fontWeight="bold">
            Staking
          </Text>
          <SectionTabs section="earn" value={view} onChange={setView} />
        </HStack>

        {view === "simple" ? (
          <StakingCompact
            data={data || {}}
            apr={apr}
            address={address}
            onReload={reload}
          />
        ) : (
          <>
            <StakingStatsBar
              totalStakedUbze={totalStakedUbze}
              primaryReward={rewardsSummary.primaryReward}
              otherRewardsCount={rewardsSummary.otherCount}
              onClaimAll={handleClaimAll}
              isClaimingAll={isSubmitting}
              hasRewards={rewardsSummary.hasRewards}
            />

            <NativeStakingAdvanced
              validators={mergedValidators}
              delegations={data?.delegations || []}
              unbonding={data?.unbonding || []}
              validatorRewards={validatorRewards}
              totalRewardsUbze={totalNativeRewardsUbze}
              totalDelegatedUbze={totalDelegatedUbze}
              apr={apr}
              unbondingDays={unbondingDays}
              address={address}
              onReload={reload}
              onSwitchToSimple={() => setView("simple")}
            />

            <RewardsStakingSection
              stakingRewards={data?.stakingRewards || []}
              participants={data?.rewardParticipants || []}
              pendingUnlocks={data?.pendingUnlocks || []}
              currentHourEpoch={data?.currentHourEpoch}
              address={address}
              onReload={reload}
            />
          </>
        )}
      </VStack>
    </Box>
  );
}
