import { useMemo } from "react";
import { Box, HStack, VStack, Text, Badge } from "@chakra-ui/react";
import { LuClock } from "react-icons/lu";
import { buildPendingUnlockRows, denomLabel } from "../../utils/stakingHelpers";
import type { StakingOverview } from "../../utils/stakingTypes";

/** Turn a row's `when` token into a readable line. */
function whenLabel(when: string): string {
  if (when === "Ready") return "Available now";
  if (when === "Pending") return "Unlock pending";
  return `Available in ${when}`;
}

interface PendingUnlocksProps {
  data: StakingOverview;
  /** Which kinds to include: both (compact), or one kind (advanced sections). */
  include?: "all" | "native" | "reward";
  /** "card" = self-contained panel (compact); "bare" = heading + rows only (embedded). */
  variant?: "card" | "bare";
  title?: string;
}

/**
 * Lists funds that are on their way out and pending availability — native
 * unbonding delegations and/or reward-program exits — each with its amount and
 * an approximate time until it's available. Renders nothing when there's nothing
 * pending. The rows are computed by `buildPendingUnlockRows` (pure, tested).
 */
export function PendingUnlocks({
  data,
  include = "all",
  variant = "card",
  title = "Pending unlocks",
}: PendingUnlocksProps) {
  const rows = useMemo(() => {
    const all = buildPendingUnlockRows(data);
    return include === "all" ? all : all.filter((r) => r.kind === include);
  }, [data, include]);

  if (rows.length === 0) return null;

  const body = (
    <>
      <HStack justify="space-between" mb="3">
        <Text fontSize={variant === "card" ? "md" : "sm"} fontWeight="bold">
          {title}
        </Text>
        <Badge size="sm" colorPalette="orange">
          {rows.length} pending
        </Badge>
      </HStack>

      <VStack gap="2" align="stretch">
        {rows.map((row) => (
          <HStack
            key={row.key}
            justify="space-between"
            p="3"
            bg="bg.subtle"
            borderRadius="md"
            gap="3"
          >
            <HStack gap="2" minW="0">
              <Box color="fg.muted" flexShrink="0">
                {LuClock({ size: 14 }) as React.ReactNode}
              </Box>
              <VStack gap="0" align="start" minW="0">
                <Text fontSize="sm" fontWeight="medium" lineClamp={1}>
                  {row.title}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {whenLabel(row.when)}
                </Text>
              </VStack>
            </HStack>
            <Text fontSize="sm" fontWeight="medium" flexShrink="0">
              {row.amountHuman} {denomLabel(row.denom)}
            </Text>
          </HStack>
        ))}
      </VStack>
    </>
  );

  if (variant === "bare") {
    return (
      <Box mt="4" pt="4" borderTopWidth="1px" borderColor="border.subtle">
        {body}
      </Box>
    );
  }

  return (
    <Box p="5" bg="bg.panel" borderWidth="1px" borderColor="border.subtle" borderRadius="lg">
      {body}
    </Box>
  );
}
