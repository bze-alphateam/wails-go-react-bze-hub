import { Box, VStack, HStack, Text, Center, Badge } from "@chakra-ui/react";
import { LuArrowLeftRight } from "react-icons/lu";
import { SectionTabs } from "../SectionTabs";
import { useSectionView } from "../../hooks/useSectionView";
import { SwapCard } from "./SwapCard";

interface TradeSectionProps {
  address: string;
  proxyTarget: string;
}

/**
 * The Trade section. Simple view is the swap card (this story); Advanced view is
 * a placeholder until markets & the orderbook land (BHUB-12 / M3). The
 * Simple/Advanced choice persists per section via `useSectionView`.
 */
export function TradeSection({ address, proxyTarget }: TradeSectionProps) {
  const { view, setView } = useSectionView("trade");

  return (
    <Box h="100%" overflowY="auto" p="4">
      <VStack gap="4" align="stretch" maxW="720px" mx="auto">
        <HStack justify="space-between">
          <Text fontSize="lg" fontWeight="bold">
            Trade
          </Text>
          <SectionTabs section="trade" value={view} onChange={setView} />
        </HStack>

        {view === "simple" ? (
          <SwapCard address={address} proxyTarget={proxyTarget} />
        ) : (
          <AdvancedPlaceholder />
        )}
      </VStack>
    </Box>
  );
}

/** Advanced trading (markets + orderbook) is not built yet — see BHUB-12. */
function AdvancedPlaceholder() {
  return (
    <Center py="16" px="8" colorPalette="blue">
      <VStack gap="4" maxW="420px" textAlign="center">
        <Box fontSize="4xl" color="colorPalette.fg" lineHeight="1">
          {LuArrowLeftRight({}) as React.ReactNode}
        </Box>
        <Text fontSize="xl" fontWeight="bold">
          Advanced trading
        </Text>
        <Badge colorPalette="blue" variant="subtle" size="lg" px="3" py="1" borderRadius="full">
          Coming in M3
        </Badge>
        <Text fontSize="sm" color="fg.muted">
          Markets &amp; the orderbook arrive with the Advanced trade view (BHUB-12).
          Use the Simple view to swap tokens now.
        </Text>
      </VStack>
    </Center>
  );
}
