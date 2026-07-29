import { useState } from "react";
import {
  Box,
  Grid,
  GridItem,
  VStack,
  HStack,
  Text,
  Button,
  Badge,
  IconButton,
  Center,
} from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";
import { tradebin } from "../../../../wailsjs/go/models";
import { prettyAmount } from "../../../utils/amount";
import { TokenLogo } from "../../TokenLogo";
import { Orderbook } from "./Orderbook";
import { RecentTrades } from "./RecentTrades";
import type { ResolveAsset } from "./marketHelpers";

type TerminalTab = "trades" | "myOrders" | "myHistory";

interface TerminalProps {
  market: tradebin.MarketWithStats;
  address: string;
  resolve: ResolveAsset;
  logo: (denom: string) => string;
  onBack: () => void;
}

/**
 * The trading terminal for one market: a header with the pair and 24h stats, a
 * grid of named slots (orderbook — this story; chart — BHUB-29; buy/sell forms —
 * BHUB-28) and a tabs area (recent trades — this story; my orders / my history —
 * BHUB-28). The price selected by clicking an orderbook level is held here and
 * fed to the (placeholder) form slot for BHUB-28 to consume.
 */
export function Terminal({ market, address, resolve, logo, onBack }: TerminalProps) {
  // Selected-price state lives at the terminal level so the orderbook (setter)
  // and the order form (reader, BHUB-28) share it.
  const [selectedPrice, setSelectedPrice] = useState<string | null>(null);
  const [tab, setTab] = useState<TerminalTab>("trades");

  const baseSym = resolve(market.base)?.symbol ?? market.base;
  const quoteSym = resolve(market.quote)?.symbol ?? market.quote;
  const stats = market.statsAvailable ? market.stats : null;
  const change = stats ? Number(stats.change) : NaN;

  return (
    <VStack gap="4" align="stretch">
      {/* Header */}
      <HStack gap="3">
        <IconButton aria-label="Back to markets" size="sm" variant="ghost" onClick={onBack}>
          {LuArrowLeft({ size: 18 }) as React.ReactNode}
        </IconButton>
        <HStack gap="1">
          <TokenLogo src={logo(market.base)} symbol={baseSym} size="7" />
          <TokenLogo src={logo(market.quote)} symbol={quoteSym} size="7" />
        </HStack>
        <Text fontSize="lg" fontWeight="bold">
          {baseSym}/{quoteSym}
        </Text>
        {stats ? (
          <HStack gap="3" ml="2">
            <Text fontWeight="medium" fontVariantNumeric="tabular-nums">
              {prettyAmount(stats.lastPrice)} {quoteSym}
            </Text>
            <Badge
              colorPalette={isNaN(change) || change === 0 ? "gray" : change > 0 ? "green" : "red"}
              variant="subtle"
            >
              {isNaN(change) ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`}
            </Badge>
            <Text fontSize="sm" color="fg.muted">
              Vol {prettyAmount(stats.quoteVolume)} {quoteSym}
            </Text>
          </HStack>
        ) : (
          <Text fontSize="sm" color="fg.muted" ml="2">
            24h stats unavailable
          </Text>
        )}
      </HStack>

      <Grid templateColumns={{ base: "1fr", xl: "300px 1fr 300px" }} gap="4" alignItems="start">
        {/* Orderbook slot (this story) */}
        <GridItem borderWidth="1px" borderRadius="lg" overflow="hidden">
          <Orderbook
            marketId={market.marketId}
            base={market.base}
            quote={market.quote}
            resolve={resolve}
            onPriceSelect={setSelectedPrice}
          />
        </GridItem>

        {/* Center column: chart (BHUB-29) over the order forms (BHUB-28). */}
        <GridItem>
          <VStack gap="4" align="stretch">
            <SlotPlaceholder title="Price chart" subtitle="Arrives with BHUB-29." minH="240px" />
            <Box borderWidth="1px" borderRadius="lg" p="4">
              <Text fontWeight="semibold" mb="1">
                Buy / sell
              </Text>
              <Text fontSize="sm" color="fg.muted">
                Order forms arrive with BHUB-28.
              </Text>
              <Text fontSize="sm" color="fg.muted" mt="2" data-testid="selected-price">
                {selectedPrice
                  ? `Selected price: ${selectedPrice} ${quoteSym}`
                  : "Click an orderbook price to prefill."}
              </Text>
            </Box>
          </VStack>
        </GridItem>

        {/* Tabs: recent trades (this story) / my orders / my history (BHUB-28). */}
        <GridItem borderWidth="1px" borderRadius="lg" overflow="hidden">
          <HStack gap="0" borderBottomWidth="1px">
            <TabButton label="Trades" active={tab === "trades"} onClick={() => setTab("trades")} />
            <TabButton label="My Orders" active={tab === "myOrders"} onClick={() => setTab("myOrders")} />
            <TabButton label="My History" active={tab === "myHistory"} onClick={() => setTab("myHistory")} />
          </HStack>
          {tab === "trades" ? (
            <RecentTrades
              marketId={market.marketId}
              base={market.base}
              quote={market.quote}
              resolve={resolve}
            />
          ) : (
            <Center py="8" px="4" textAlign="center">
              <Text fontSize="sm" color="fg.muted">
                {tab === "myOrders" ? "My open orders" : "My trade history"} arrive with BHUB-28.
                {!address && " Connect a wallet to trade."}
              </Text>
            </Center>
          )}
        </GridItem>
      </Grid>
    </VStack>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button
      flex="1"
      size="sm"
      variant="ghost"
      borderRadius="0"
      fontWeight={active ? "semibold" : "normal"}
      color={active ? "blue.fg" : "fg.muted"}
      borderBottomWidth="2px"
      borderColor={active ? "blue.500" : "transparent"}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function SlotPlaceholder({
  title,
  subtitle,
  minH,
}: {
  title: string;
  subtitle: string;
  minH: string;
}) {
  return (
    <Center borderWidth="1px" borderRadius="lg" borderStyle="dashed" minH={minH} p="4">
      <VStack gap="1">
        <Text fontWeight="semibold" color="fg.muted">
          {title}
        </Text>
        <Text fontSize="sm" color="fg.muted">
          {subtitle}
        </Text>
      </VStack>
    </Center>
  );
}
