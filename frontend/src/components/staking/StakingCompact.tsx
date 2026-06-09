import { useMemo, useState } from "react";
import {
  Box,
  HStack,
  VStack,
  Text,
  Button,
  SimpleGrid,
} from "@chakra-ui/react";
import {
  LuCoins,
  LuWallet,
  LuGift,
  LuTrendingUp,
  LuShieldCheck,
  LuTriangleAlert,
  LuWrench,
  LuLockOpen,
} from "react-icons/lu";
import {
  formatAmount,
  ubzeToHuman,
  denomLabel,
  calcRewardsStakingPending,
  sumDecCoins,
} from "../../utils/stakingHelpers";
import {
  scoreValidators,
  selectTopValidators,
  splitDelegation,
} from "../../utils/validatorScoring";
import { computeStakeHealth, type StakeIssue } from "../../utils/stakeHealth";
import { useStakingTx } from "../../hooks/useStakingTx";
import { PendingUnlocks } from "./PendingUnlocks";
import { StakeModal } from "./modals/StakeModal";
import type { StakingOverview } from "../../utils/stakingTypes";

interface StakingCompactProps {
  data: StakingOverview;
  apr: string;
  address: string;
  onReload: () => void;
}

interface PendingItem {
  key: string;
  label: string;
  amountHuman: string;
  denom: string;
  claim: () => Promise<boolean>;
}

export function StakingCompact({ data, apr, address, onReload }: StakingCompactProps) {
  const [showStakeModal, setShowStakeModal] = useState(false);
  const {
    autoStake,
    claimNativeRewards,
    claimRewardStaking,
    claimAll,
    redelegate,
    exitRewardStaking,
    isSubmitting,
  } = useStakingTx(address);

  const validators = data.validators || [];
  const delegations = data.delegations || [];
  const participants = data.rewardParticipants || [];
  const stakingRewards = data.stakingRewards || [];

  // --- totals -------------------------------------------------------------

  const totalDelegatedUbze = useMemo(() => {
    let t = 0n;
    for (const d of delegations) t += BigInt(d.balance?.amount || "0");
    return t;
  }, [delegations]);

  const ubzeRewardStaked = useMemo(() => {
    let t = 0n;
    for (const p of participants) {
      const r = stakingRewards.find((x) => x.reward_id === p.reward_id);
      if (r?.staking_denom === "ubze") t += BigInt(p.amount || "0");
    }
    return t;
  }, [participants, stakingRewards]);

  const totalStakedHuman = formatAmount(
    ubzeToHuman((totalDelegatedUbze + ubzeRewardStaked).toString())
  );
  const availableHuman = formatAmount(
    ubzeToHuman(data.availableBalance?.amount || "0")
  );
  const nativeRewardsUbze = useMemo(
    () => (data.rewards?.total ? sumDecCoins(data.rewards.total, "ubze") : "0"),
    [data.rewards]
  );

  // --- stake health -------------------------------------------------------

  const health = useMemo(
    () =>
      computeStakeHealth({
        delegations,
        delegatedValidators: data.delegatedValidators || [],
        bondedValidators: validators,
        rewardParticipants: participants,
        stakingRewards,
      }),
    [delegations, data.delegatedValidators, validators, participants, stakingRewards]
  );

  // --- claimable items ----------------------------------------------------

  const rewardValidators = useMemo(
    () => (data.rewards?.rewards || []).map((r) => r.validator_address),
    [data.rewards]
  );

  const pendingItems = useMemo<PendingItem[]>(() => {
    const items: PendingItem[] = [];

    // Native staking rewards (aggregated across all validators into one source).
    if (BigInt(nativeRewardsUbze.split(".")[0] || "0") > 0n) {
      items.push({
        key: "native",
        label: "Staking rewards",
        amountHuman: formatAmount(ubzeToHuman(nativeRewardsUbze), 4),
        denom: "ubze",
        claim: () => claimNativeRewards(rewardValidators),
      });
    }

    // Each reward-program participation with something to claim.
    for (const p of participants) {
      const r = stakingRewards.find((x) => x.reward_id === p.reward_id);
      if (!r) continue;
      const pending = calcRewardsStakingPending(
        p.amount,
        r.distributed_stake,
        p.joined_at
      );
      if (BigInt(pending) <= 0n) continue;
      items.push({
        key: `r-${p.reward_id}`,
        label: `Earn ${denomLabel(r.prize_denom)}`,
        amountHuman: formatAmount(ubzeToHuman(pending), 4),
        denom: r.prize_denom,
        claim: () => claimRewardStaking(p.reward_id),
      });
    }

    return items;
  }, [
    nativeRewardsUbze,
    rewardValidators,
    participants,
    stakingRewards,
    claimNativeRewards,
    claimRewardStaking,
  ]);

  // --- actions ------------------------------------------------------------

  const handleStake = async (ubzeAmount: string) => {
    const top = selectTopValidators(scoreValidators(validators));
    const success = await autoStake(splitDelegation(ubzeAmount, top));
    if (success) {
      setShowStakeModal(false);
      onReload();
    }
    return success;
  };

  const handleClaimAll = async () => {
    const rewardIds = participants
      .map((p) => {
        const r = stakingRewards.find((x) => x.reward_id === p.reward_id);
        if (!r) return null;
        const pending = calcRewardsStakingPending(
          p.amount,
          r.distributed_stake,
          p.joined_at
        );
        return BigInt(pending) > 0n ? p.reward_id : null;
      })
      .filter((x): x is string => x !== null);
    const success = await claimAll(rewardValidators, rewardIds);
    if (success) onReload();
  };

  const runAndReload = async (fn: () => Promise<boolean>) => {
    const ok = await fn();
    if (ok) onReload();
  };

  const hasStake = totalDelegatedUbze + ubzeRewardStaked > 0n;

  return (
    <VStack gap="4" align="stretch">
      {/* Summary cards */}
      <SimpleGrid columns={{ base: 2, md: 4 }} gap="3">
        <SummaryCard
          icon={LuCoins({ size: 16 }) as React.ReactNode}
          label="Staked"
          value={totalStakedHuman}
          unit="BZE"
        />
        <SummaryCard
          icon={LuWallet({ size: 16 }) as React.ReactNode}
          label="Available"
          value={availableHuman}
          unit="BZE"
        />
        <SummaryCard
          icon={LuGift({ size: 16 }) as React.ReactNode}
          label="Pending rewards"
          value={formatAmount(ubzeToHuman(nativeRewardsUbze), 4)}
          unit={pendingItems.length > 1 ? `BZE +${pendingItems.length - 1}` : "BZE"}
          valueColor="teal.500"
        />
        <SummaryCard
          icon={LuTrendingUp({ size: 16 }) as React.ReactNode}
          label="Staking APR"
          value={`${apr}%`}
          unit="estimated"
          valueColor="green.500"
        />
      </SimpleGrid>

      {/* Stake health */}
      <HealthPanel
        health={health}
        isSubmitting={isSubmitting}
        onFix={(issue) =>
          runAndReload(() =>
            redelegate(issue.srcValidator!, issue.dstValidator!, issue.amount)
          )
        }
        onUnlock={(issue) =>
          runAndReload(() => exitRewardStaking(issue.rewardId!))
        }
      />

      {/* Rewards / claim */}
      <Box
        p="5"
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius="lg"
      >
        <HStack justify="space-between" mb="3">
          <Text fontSize="md" fontWeight="bold">
            Rewards
          </Text>
          <Button
            size="xs"
            colorPalette="teal"
            onClick={handleClaimAll}
            disabled={pendingItems.length === 0 || isSubmitting}
            loading={isSubmitting}
          >
            Claim all
          </Button>
        </HStack>

        {pendingItems.length === 0 ? (
          <Text fontSize="sm" color="fg.muted" py="2">
            No rewards to claim right now.
          </Text>
        ) : (
          <VStack gap="2" align="stretch">
            {pendingItems.map((item) => (
              <HStack
                key={item.key}
                justify="space-between"
                p="3"
                bg="bg.subtle"
                borderRadius="md"
              >
                <VStack gap="0" align="start">
                  <Text fontSize="sm" fontWeight="medium">
                    {item.label}
                  </Text>
                  <Text fontSize="sm" color="teal.500">
                    {item.amountHuman} {denomLabel(item.denom)}
                  </Text>
                </VStack>
                <Button
                  size="xs"
                  variant="outline"
                  colorPalette="teal"
                  onClick={() => runAndReload(item.claim)}
                  disabled={isSubmitting}
                >
                  Claim
                </Button>
              </HStack>
            ))}
          </VStack>
        )}
      </Box>

      {/* Pending unlocks (native unbonding + reward exits) */}
      <PendingUnlocks data={data} include="all" />

      {/* Stake action */}
      <HStack>
        <Button
          flex="1"
          colorPalette="teal"
          onClick={() => setShowStakeModal(true)}
          disabled={isSubmitting}
        >
          {hasStake ? "Stake more" : "Start staking"}
        </Button>
      </HStack>

      <StakeModal
        isOpen={showStakeModal}
        onClose={() => setShowStakeModal(false)}
        onStake={handleStake}
        isSubmitting={isSubmitting}
        validators={validators}
      />
    </VStack>
  );
}

// --- subcomponents --------------------------------------------------------

function SummaryCard({
  icon,
  label,
  value,
  unit,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  valueColor?: string;
}) {
  return (
    <Box p="4" bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="lg">
      <HStack gap="2" mb="1" color="fg.muted">
        {icon}
        <Text fontSize="xs">{label}</Text>
      </HStack>
      <Text fontSize="xl" fontWeight="bold" color={valueColor} lineClamp={1}>
        {value}
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {unit}
      </Text>
    </Box>
  );
}

function HealthPanel({
  health,
  isSubmitting,
  onFix,
  onUnlock,
}: {
  health: ReturnType<typeof computeStakeHealth>;
  isSubmitting: boolean;
  onFix: (issue: StakeIssue) => void;
  onUnlock: (issue: StakeIssue) => void;
}) {
  if (health.status === "healthy") {
    return (
      <HStack
        p="3"
        bg="green.50"
        _dark={{ bg: "green.950/30" }}
        borderWidth="1px"
        borderColor="green.200"
        borderRadius="lg"
        gap="2"
      >
        <Box color="green.600" _dark={{ color: "green.400" }}>
          {LuShieldCheck({ size: 18 }) as React.ReactNode}
        </Box>
        <Text fontSize="sm" color="green.700" _dark={{ color: "green.300" }}>
          Your stake is healthy — everything is earning.
        </Text>
      </HStack>
    );
  }

  return (
    <Box
      p="4"
      bg="orange.50"
      _dark={{ bg: "orange.950/30" }}
      borderWidth="1px"
      borderColor="orange.200"
      borderRadius="lg"
    >
      <HStack gap="2" mb="3">
        <Box color="orange.600" _dark={{ color: "orange.400" }}>
          {LuTriangleAlert({ size: 18 }) as React.ReactNode}
        </Box>
        <Text fontSize="sm" fontWeight="bold" color="orange.800" _dark={{ color: "orange.200" }}>
          {health.issues.length} stake{health.issues.length === 1 ? "" : "s"} need
          {health.issues.length === 1 ? "s" : ""} attention
        </Text>
      </HStack>

      <VStack gap="2" align="stretch">
        {health.issues.map((issue, i) => (
          <HStack
            key={i}
            justify="space-between"
            gap="3"
            p="3"
            bg="bg.panel"
            borderRadius="md"
            wrap="wrap"
          >
            <Text fontSize="sm" flex="1" minW="200px">
              {issue.message}
            </Text>
            {issue.type === "validator_inactive" && issue.fixable && (
              <Button
                size="xs"
                colorPalette="teal"
                onClick={() => onFix(issue)}
                disabled={isSubmitting}
              >
                {LuWrench({ size: 12 }) as React.ReactNode} Fix
              </Button>
            )}
            {issue.type === "validator_inactive" && !issue.fixable && (
              <Text fontSize="xs" color="fg.muted">
                No healthy validator available
              </Text>
            )}
            {issue.type === "finished_reward" && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => onUnlock(issue)}
                disabled={isSubmitting}
              >
                {LuLockOpen({ size: 12 }) as React.ReactNode} Start unlock
                {issue.lockDays ? ` (${issue.lockDays}d)` : ""}
              </Button>
            )}
          </HStack>
        ))}
      </VStack>
    </Box>
  );
}
