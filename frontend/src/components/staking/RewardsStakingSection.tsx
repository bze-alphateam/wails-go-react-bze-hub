import { useState, useMemo } from "react";
import {
  Box,
  HStack,
  VStack,
  Text,
  Button,
  Badge,
  Collapsible,
} from "@chakra-ui/react";
import { LuChevronRight, LuChevronDown, LuPlus } from "react-icons/lu";
import { formatAmount, ubzeToHuman, calcRewardsStakingApr, calcRewardsStakingPending } from "../../utils/stakingHelpers";
import { JoinRewardModal } from "./modals/JoinRewardModal";
import type {
  StakingReward,
  StakingRewardParticipant,
  GroupedRewardStaking,
} from "../../utils/stakingTypes";

interface RewardsStakingSectionProps {
  stakingRewards: StakingReward[];
  participants: StakingRewardParticipant[];
  address: string;
  onReload: () => void;
}

export function RewardsStakingSection({
  stakingRewards,
  participants,
  address,
  onReload,
}: RewardsStakingSectionProps) {
  const [isAdvanced, setIsAdvanced] = useState(false);

  // Group rewards by staking denom
  const grouped = useMemo(() => {
    const map = new Map<string, GroupedRewardStaking>();

    for (const reward of stakingRewards) {
      // Skip completed rewards (payouts >= duration)
      if (reward.payouts >= reward.duration) continue;

      const existing = map.get(reward.staking_denom);
      if (existing) {
        existing.rewards.push(reward);
      } else {
        map.set(reward.staking_denom, {
          stakingDenom: reward.staking_denom,
          rewards: [reward],
          userParticipations: [],
        });
      }
    }

    // Map user participations to groups
    for (const p of participants) {
      const reward = stakingRewards.find((r) => r.reward_id === p.reward_id);
      if (reward) {
        const group = map.get(reward.staking_denom);
        if (group) {
          group.userParticipations.push(p);
        }
      }
    }

    return Array.from(map.values());
  }, [stakingRewards, participants]);

  // Flat list for advanced view
  const activeRewards = useMemo(
    () => stakingRewards.filter((r) => r.payouts < r.duration),
    [stakingRewards]
  );

  const participantMap = useMemo(() => {
    const m = new Map<string, StakingRewardParticipant>();
    for (const p of participants) {
      m.set(p.reward_id, p);
    }
    return m;
  }, [participants]);

  return (
    <Box
      p="5"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      mb="4"
    >
      <HStack justify="space-between" mb="4">
        <HStack gap="2">
          <Text fontSize="md" fontWeight="bold">
            Rewards Staking
          </Text>
          <Badge colorPalette="purple" size="sm">
            {activeRewards.length} active
          </Badge>
        </HStack>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setIsAdvanced(!isAdvanced)}
        >
          {isAdvanced ? "Simple" : "Advanced"}{" "}
          {LuChevronRight({}) as React.ReactNode}
        </Button>
      </HStack>

      {!isAdvanced ? (
        /* Simple View — Grouped by asset */
        <VStack gap="3" align="stretch">
          {grouped.length === 0 && (
            <Text fontSize="sm" color="fg.muted" textAlign="center" py="4">
              No active staking rewards available
            </Text>
          )}
          {grouped.map((group) => (
            <RewardGroup
              key={group.stakingDenom}
              group={group}
              participantMap={participantMap}
              address={address}
              onReload={onReload}
            />
          ))}
        </VStack>
      ) : (
        /* Advanced View — Flat list */
        <VStack gap="3" align="stretch">
          {activeRewards.length === 0 && (
            <Text fontSize="sm" color="fg.muted" textAlign="center" py="4">
              No active staking rewards available
            </Text>
          )}
          {activeRewards.map((reward) => {
            const participation = participantMap.get(reward.reward_id);
            return (
              <RewardRow
                key={reward.reward_id}
                reward={reward}
                participation={participation}
                address={address}
                onReload={onReload}
              />
            );
          })}
        </VStack>
      )}
    </Box>
  );
}

function RewardGroup({
  group,
  participantMap,
  address,
  onReload,
}: {
  group: GroupedRewardStaking;
  participantMap: Map<string, StakingRewardParticipant>;
  address: string;
  onReload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Denom display name (strip factory prefix for readability)
  const denomName = group.stakingDenom.startsWith("factory/")
    ? group.stakingDenom.split("/").pop() || group.stakingDenom
    : group.stakingDenom === "ubze"
    ? "BZE"
    : group.stakingDenom;

  const activeCount = group.rewards.length;
  const userActiveCount = group.userParticipations.length;

  return (
    <Box borderWidth="1px" borderColor="border.subtle" borderRadius="md" overflow="hidden">
      <HStack
        p="3"
        cursor="pointer"
        onClick={() => setExpanded(!expanded)}
        _hover={{ bg: "bg.subtle" }}
        justify="space-between"
      >
        <HStack gap="2">
          {expanded ? (LuChevronDown({ size: 14 }) as React.ReactNode) : (LuChevronRight({ size: 14 }) as React.ReactNode)}
          <Text fontSize="sm" fontWeight="medium">
            Stake {denomName}
          </Text>
          <Badge size="sm" colorPalette="gray">
            {activeCount} opportunit{activeCount === 1 ? "y" : "ies"}
          </Badge>
          {userActiveCount > 0 && (
            <Badge size="sm" colorPalette="teal">
              {userActiveCount} active
            </Badge>
          )}
        </HStack>
      </HStack>

      <Collapsible.Root open={expanded}>
        <Collapsible.Content>
          <VStack gap="2" p="3" pt="0" align="stretch">
            {group.rewards.map((reward) => (
              <RewardRow
                key={reward.reward_id}
                reward={reward}
                participation={participantMap.get(reward.reward_id)}
                address={address}
                onReload={onReload}
              />
            ))}
          </VStack>
        </Collapsible.Content>
      </Collapsible.Root>
    </Box>
  );
}

function RewardRow({
  reward,
  participation,
  address,
  onReload,
}: {
  reward: StakingReward;
  participation?: StakingRewardParticipant;
  address: string;
  onReload: () => void;
}) {
  const [showJoinModal, setShowJoinModal] = useState(false);
  const prizeDenom = reward.prize_denom === "ubze" ? "BZE" : reward.prize_denom;
  const stakingDenom = reward.staking_denom === "ubze" ? "BZE" : reward.staking_denom;
  const apr = calcRewardsStakingApr(
    reward.prize_amount,
    reward.duration,
    reward.staked_amount
  );
  const progress = reward.duration > 0 ? Math.round((reward.payouts / reward.duration) * 100) : 0;

  const pendingReward = participation
    ? calcRewardsStakingPending(
        participation.amount,
        reward.distributed_stake,
        participation.joined_at
      )
    : "0";

  return (
    <Box p="3" bg="bg.subtle" borderRadius="md">
      <HStack justify="space-between" wrap="wrap" gap="2">
        <VStack gap="0" align="start">
          <Text fontSize="sm" fontWeight="medium">
            Stake {stakingDenom} → earn {prizeDenom}
          </Text>
          <HStack gap="3">
            <Text fontSize="xs" color="fg.muted">
              APR: <Text as="span" color="green.500">{apr}%</Text>
            </Text>
            <Text fontSize="xs" color="fg.muted">
              Progress: {progress}%
            </Text>
            <Text fontSize="xs" color="fg.muted">
              Total staked: {formatAmount(ubzeToHuman(reward.staked_amount))}
            </Text>
          </HStack>
        </VStack>

        <HStack gap="2">
          {participation ? (
            <VStack gap="0" align="end">
              <Text fontSize="xs" color="fg.muted">
                Your stake: {formatAmount(ubzeToHuman(participation.amount))}
              </Text>
              {BigInt(pendingReward) > 0n && (
                <Text fontSize="xs" color="teal.500">
                  Pending: {formatAmount(ubzeToHuman(pendingReward))} {prizeDenom}
                </Text>
              )}
            </VStack>
          ) : (
            <Button size="xs" colorPalette="teal" variant="outline" onClick={() => setShowJoinModal(true)}>
              {LuPlus({ size: 12 }) as React.ReactNode} Join
            </Button>
          )}
        </HStack>
      </HStack>

      <JoinRewardModal
        isOpen={showJoinModal}
        onClose={() => setShowJoinModal(false)}
        reward={reward}
        address={address}
        onSuccess={onReload}
      />
    </Box>
  );
}
