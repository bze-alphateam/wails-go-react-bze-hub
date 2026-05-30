import { HStack, VStack, Text, Button, Box, Badge } from "@chakra-ui/react";
import { LuCoins, LuGift, LuArrowRight } from "react-icons/lu";
import { formatAmount, ubzeToHuman } from "../../utils/stakingHelpers";

interface StakingStatsBarProps {
  totalStakedUbze: string;
  primaryReward: { amount: string; denom: string } | null;
  otherRewardsCount: number;
  onClaimAll: () => void;
  isClaimingAll: boolean;
  hasRewards: boolean;
}

export function StakingStatsBar({
  totalStakedUbze,
  primaryReward,
  otherRewardsCount,
  onClaimAll,
  isClaimingAll,
  hasRewards,
}: StakingStatsBarProps) {
  const totalStakedHuman = formatAmount(ubzeToHuman(totalStakedUbze));
  const primaryRewardHuman = primaryReward
    ? formatAmount(ubzeToHuman(primaryReward.amount))
    : "0";

  return (
    <Box
      p="4"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      mb="4"
    >
      <HStack justify="space-between" align="center" wrap="wrap" gap="4">
        {/* Total Staked */}
        <HStack gap="3">
          <Box p="2" bg="teal.500/10" borderRadius="md">
            {LuCoins({ size: 20, color: "var(--chakra-colors-teal-500)" }) as React.ReactNode}
          </Box>
          <VStack gap="0" align="start">
            <Text fontSize="xs" color="fg.muted">
              Total Staked
            </Text>
            <Text fontSize="lg" fontWeight="bold">
              {totalStakedHuman} BZE
            </Text>
          </VStack>
        </HStack>

        {/* Cumulated Rewards */}
        <HStack gap="3">
          <Box p="2" bg="orange.500/10" borderRadius="md">
            {LuGift({ size: 20, color: "var(--chakra-colors-orange-500)" }) as React.ReactNode}
          </Box>
          <VStack gap="0" align="start">
            <Text fontSize="xs" color="fg.muted">
              Pending Rewards
            </Text>
            <HStack gap="1">
              <Text fontSize="lg" fontWeight="bold">
                {primaryRewardHuman} {primaryReward?.denom === "ubze" ? "BZE" : primaryReward?.denom || "BZE"}
              </Text>
              {otherRewardsCount > 0 && (
                <Badge colorPalette="teal" size="sm">
                  +{otherRewardsCount} other{otherRewardsCount > 1 ? "s" : ""}
                </Badge>
              )}
            </HStack>
          </VStack>
        </HStack>

        {/* Claim All */}
        <Button
          colorPalette="teal"
          size="sm"
          onClick={onClaimAll}
          loading={isClaimingAll}
          disabled={!hasRewards || isClaimingAll}
        >
          Claim All {LuArrowRight({}) as React.ReactNode}
        </Button>
      </HStack>
    </Box>
  );
}
