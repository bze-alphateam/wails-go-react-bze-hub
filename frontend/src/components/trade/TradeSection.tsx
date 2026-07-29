import { useEffect, useState } from "react";
import { Box, VStack, HStack, Text } from "@chakra-ui/react";
import { SectionTabs } from "../SectionTabs";
import { useSectionView } from "../../hooks/useSectionView";
import { useSharedAssets } from "../../context/AssetsContext";
import { tradebin } from "../../../wailsjs/go/models";
import { SwapCard } from "./SwapCard";
import { MarketList } from "./terminal/MarketList";
import { Terminal } from "./terminal/Terminal";
import { OpenOrdersSummary } from "./terminal/OpenOrdersSummary";

interface TradeSectionProps {
  address: string;
  proxyTarget: string;
  /** Denom to preselect as the swap input (Portfolio → Trade deep link). */
  preselectDenom?: string | null;
  /** Called once the preselect denom has been applied, so it can be cleared. */
  onPreselectConsumed?: () => void;
}

/**
 * The Trade section. Simple view is the swap card; Advanced view is the market
 * list + trading terminal (BHUB-27). The Simple/Advanced choice persists per
 * section via `useSectionView`. The Advanced view widens the container since the
 * terminal is a multi-column layout. A Portfolio "Trade" deep link forces the
 * Simple view and preselects the token.
 */
export function TradeSection({
  address,
  proxyTarget,
  preselectDenom,
  onPreselectConsumed,
}: TradeSectionProps) {
  const { view, setView } = useSectionView("trade");
  const isAdvanced = view === "advanced";

  // A deep link always lands on the Simple swap view.
  useEffect(() => {
    if (preselectDenom) setView("simple");
  }, [preselectDenom, setView]);

  return (
    <Box h="100%" overflowY="auto" p="4">
      <VStack gap="4" align="stretch" maxW={isAdvanced ? "1200px" : "720px"} mx="auto">
        <HStack justify="space-between">
          <Text fontSize="lg" fontWeight="bold">
            Trade
          </Text>
          <SectionTabs section="trade" value={view} onChange={setView} />
        </HStack>

        {isAdvanced ? (
          <AdvancedTrade address={address} />
        ) : (
          <VStack gap="4" align="stretch">
            <OpenOrdersSummary address={address} onGoAdvanced={() => setView("advanced")} />
            <SwapCard
              address={address}
              proxyTarget={proxyTarget}
              preselectDenom={preselectDenom}
              onPreselectConsumed={onPreselectConsumed}
            />
          </VStack>
        )}
      </VStack>
    </Box>
  );
}

/**
 * The Advanced trade experience: a market list that opens into a per-market
 * terminal. The selected market is held here (Trade-section state) so the list
 * and terminal are one navigation. Assets are loaded once and shared with both.
 */
function AdvancedTrade({ address }: { address: string }) {
  const { resolve, logo } = useSharedAssets();
  const [selectedMarket, setSelectedMarket] = useState<tradebin.MarketWithStats | null>(null);

  if (selectedMarket) {
    return (
      <Terminal
        market={selectedMarket}
        address={address}
        resolve={resolve}
        logo={logo}
        onBack={() => setSelectedMarket(null)}
      />
    );
  }

  return <MarketList resolve={resolve} logo={logo} onSelect={setSelectedMarket} />;
}
