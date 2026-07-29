import { useEffect, useState } from "react";
import { Box, VStack, HStack, Text, Button } from "@chakra-ui/react";
import { SectionTabs } from "../SectionTabs";
import { useSectionView } from "../../hooks/useSectionView";
import { useSharedAssets } from "../../context/AssetsContext";
import { tradebin } from "../../../wailsjs/go/models";
import { SwapCard } from "./SwapCard";
import { MarketList } from "./terminal/MarketList";
import { Terminal } from "./terminal/Terminal";
import { OpenOrdersSummary } from "./terminal/OpenOrdersSummary";
import { PoolList } from "./pools/PoolList";
import { PoolManage } from "./pools/PoolManage";

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
          <AdvancedTrade address={address} proxyTarget={proxyTarget} />
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

type AdvancedTab = "markets" | "pools";

/**
 * The Advanced trade experience: a Markets | Pools sub-navigation. Markets is a
 * market list that opens into a per-market terminal (BHUB-27); Pools is the
 * liquidity-pool list that opens into a per-pool manage view (BHUB-30). The
 * selected market/pool is held here so each list and its detail are one
 * navigation; assets are loaded once and shared across all of them.
 */
function AdvancedTrade({ address, proxyTarget }: { address: string; proxyTarget: string }) {
  const { resolve, logo } = useSharedAssets();
  const [tab, setTab] = useState<AdvancedTab>("markets");
  const [selectedMarket, setSelectedMarket] = useState<tradebin.MarketWithStats | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);

  if (tab === "markets" && selectedMarket) {
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

  if (tab === "pools" && selectedPoolId) {
    return (
      <PoolManage
        poolId={selectedPoolId}
        proxyTarget={proxyTarget}
        address={address}
        onBack={() => setSelectedPoolId(null)}
      />
    );
  }

  return (
    <VStack gap="4" align="stretch">
      <HStack gap="0" bg="bg.subtle" borderRadius="md" p="1" alignSelf="flex-start" role="tablist">
        <SubNavButton label="Markets" active={tab === "markets"} onClick={() => setTab("markets")} />
        <SubNavButton label="Pools" active={tab === "pools"} onClick={() => setTab("pools")} />
      </HStack>
      {tab === "markets" ? (
        <MarketList resolve={resolve} logo={logo} onSelect={setSelectedMarket} />
      ) : (
        <PoolList proxyTarget={proxyTarget} onSelect={(p) => setSelectedPoolId(p.id)} />
      )}
    </VStack>
  );
}

function SubNavButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button
      role="tab"
      aria-selected={active}
      size="sm"
      variant={active ? "solid" : "ghost"}
      colorPalette="blue"
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
