import { useMemo, useState } from "react";
import {
  Box, VStack, HStack, Text, Heading, Input, Button, IconButton,
  Center, Spinner,
} from "@chakra-ui/react";
import { LuRefreshCw, LuQrCode, LuSend } from "react-icons/lu";
import { useSharedAssets } from "../../context/AssetsContext";
import { useSharedStaking } from "../../context/StakingContext";
import { useChainEvents } from "../../hooks/useChainEvents";
import { PortfolioRow } from "./PortfolioRow";
import { ReceiveModal } from "./ReceiveModal";
import { AssetDetail } from "./AssetDetail";
import { SendForm } from "./SendForm";
import { visibleAssets, totalUsdValue, usdLabel } from "./portfolioHelpers";
import { NATIVE_DENOM, stakedUbzeFromOverview } from "./assetDetailHelpers";

interface PortfolioSectionProps {
  address: string;
  /** Deep-link an asset into the Trade section's swap input (M2). */
  onTrade?: (denom: string) => void;
}

/**
 * The Portfolio section: the active wallet's asset holdings with logos, type and
 * verified badges, amounts and USD values, a total-value header, search and a
 * holdings-only / "Show all" toggle. Data comes from the M0 asset engine via
 * `useAssets`; a tx touching the active address refreshes the list within a
 * block (coalesced) via `useChainEvents`.
 */
export function PortfolioSection({ address, onTrade }: PortfolioSectionProps) {
  const { assets, isLoading, error, reload, price, logo, usdValue } = useSharedAssets();
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [selectedDenom, setSelectedDenom] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendDenom, setSendDenom] = useState<string | undefined>(undefined);

  const openSend = (denom?: string) => {
    setSendDenom(denom);
    setSendOpen(true);
  };

  // Live refresh: a tx touching the active address refreshes within a block,
  // instead of waiting for the poll interval.
  useChainEvents(address, { onMatchingTx: () => reload() });

  // The selected asset (kept in sync as the list refreshes) and, only when the
  // native token's detail is open, its staked amount. Staking data comes from
  // the app-level StakingProvider (one shared poll loop with the Earn page).
  const selected = useMemo(
    () => assets.find((a) => a.denom === selectedDenom) ?? null,
    [assets, selectedDenom]
  );
  const needsStaking = selectedDenom === NATIVE_DENOM;
  const { data: staking } = useSharedStaking();
  const stakedUAmount = needsStaking ? stakedUbzeFromOverview(staking) : null;

  const total = useMemo(() => totalUsdValue(assets, usdValue), [assets, usdValue]);
  const rows = useMemo(
    () => visibleAssets(assets, { search, showAll, usdValue }),
    [assets, search, showAll, usdValue]
  );

  if (!address) {
    return (
      <Center h="100%">
        <Text color="fg.muted">Connect a wallet to view your portfolio</Text>
      </Center>
    );
  }

  if (isLoading && assets.length === 0) {
    return (
      <Center h="100%" flexDirection="column" gap="3">
        <Spinner size="lg" color="teal.500" />
        <Text color="fg.muted">Loading portfolio...</Text>
      </Center>
    );
  }

  if (error && assets.length === 0) {
    return (
      <Center h="100%" flexDirection="column" gap="3">
        <Text color="red.500">Failed to load portfolio</Text>
        <Text fontSize="sm" color="fg.muted">{error}</Text>
        <Box mt="2">
          <Button size="sm" onClick={reload}>Retry</Button>
        </Box>
      </Center>
    );
  }

  const emptyMessage = search
    ? "No assets match your search"
    : showAll
      ? "No known assets"
      : "No holdings yet — receive some tokens to get started";

  return (
    <Box h="100%" overflowY="auto" p="4">
      <VStack gap="4" align="stretch" maxW="1000px" mx="auto">
        {/* Total value header */}
        <HStack justify="space-between" align="flex-start">
          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="fg.muted">
              Total Portfolio Value
            </Text>
            <Heading size="3xl" fontWeight="bold">
              {usdLabel(total) ?? "$0.00"}
            </Heading>
          </Box>
          <HStack gap="2">
            <Button
              size="sm"
              colorPalette="teal"
              onClick={() => openSend()}
            >
              <HStack gap="2">
                {LuSend({}) as React.ReactNode}
                <Text>Send</Text>
              </HStack>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReceiveOpen(true)}
            >
              <HStack gap="2">
                {LuQrCode({}) as React.ReactNode}
                <Text>Receive</Text>
              </HStack>
            </Button>
            <IconButton
              aria-label="Refresh portfolio"
              size="sm"
              variant="ghost"
              onClick={reload}
              disabled={isLoading}
            >
              {LuRefreshCw({}) as React.ReactNode}
            </IconButton>
          </HStack>
        </HStack>

        {/* Search + holdings/all toggle */}
        <HStack gap="3">
          <Input
            flex="1"
            size="sm"
            placeholder="Search by symbol, name or denom"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            size="sm"
            variant={showAll ? "solid" : "outline"}
            flexShrink={0}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Holdings only" : "Show all"}
          </Button>
        </HStack>

        {/* Asset list */}
        {rows.length === 0 ? (
          <Center py="10">
            <Text color="fg.muted">{emptyMessage}</Text>
          </Center>
        ) : (
          <VStack align="stretch" gap="1">
            {rows.map((a) => (
              <PortfolioRow
                key={a.denom}
                asset={a}
                logo={logo(a.denom)}
                usd={usdValue(a.denom, a.amount)}
                onSelect={() => setSelectedDenom(a.denom)}
                onSend={openSend}
              />
            ))}
          </VStack>
        )}
      </VStack>

      <ReceiveModal
        isOpen={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        address={address}
      />

      <AssetDetail
        asset={selected}
        isOpen={selected !== null}
        onClose={() => setSelectedDenom(null)}
        logo={selected ? logo(selected.denom) : ""}
        price={selected ? price(selected.denom) : null}
        stakedUAmount={stakedUAmount}
        onSend={(denom) => {
          setSelectedDenom(null);
          openSend(denom);
        }}
        onTrade={
          onTrade
            ? (denom) => {
                setSelectedDenom(null);
                onTrade(denom);
              }
            : undefined
        }
      />

      {sendOpen && (
        <SendForm
          isOpen={sendOpen}
          onClose={() => setSendOpen(false)}
          address={address}
          assets={assets}
          logo={logo}
          presetDenom={sendDenom}
          onSent={reload}
        />
      )}
    </Box>
  );
}
