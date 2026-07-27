import { useMemo, useState } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  Input,
  Button,
  Badge,
  Center,
  Spinner,
} from "@chakra-ui/react";
import { LuShield, LuSearch } from "react-icons/lu";
import { tradebin } from "../../../../wailsjs/go/models";
import { useMarkets } from "../../../hooks/useMarkets";
import { prettyAmount } from "../../../utils/amount";
import { TokenLogo } from "../../TokenLogo";
import {
  filterMarkets,
  isVerifiedMarket,
  sortMarkets,
  type MarketSort,
  type ResolveAsset,
} from "./marketHelpers";

interface MarketListProps {
  resolve: ResolveAsset;
  logo: (denom: string) => string;
  onSelect: (market: tradebin.MarketWithStats) => void;
}

/**
 * The Advanced-tab market list: every tradebin market with 24h stats, searchable
 * and sortable by volume or change, with a verified badge. Clicking a row opens
 * that market's terminal. When the aggregator is down, rows render without stats.
 */
export function MarketList({ resolve, logo, onSelect }: MarketListProps) {
  const { markets, isLoading } = useMarkets();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<MarketSort>("volume");

  const rows = useMemo(
    () => sortMarkets(filterMarkets(markets, search, resolve), sort),
    [markets, search, sort, resolve],
  );

  return (
    <VStack gap="3" align="stretch">
      <HStack gap="2">
        <HStack flex="1" borderWidth="1px" borderRadius="lg" px="3" bg="bg.panel">
          <Box color="fg.muted">{LuSearch({ size: 16 }) as React.ReactNode}</Box>
          <Input
            variant="flushed"
            border="none"
            placeholder="Search markets"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search markets"
          />
        </HStack>
        <SortButton label="Volume" active={sort === "volume"} onClick={() => setSort("volume")} />
        <SortButton label="Change" active={sort === "change"} onClick={() => setSort("change")} />
      </HStack>

      {isLoading && markets.length === 0 ? (
        <Center h="200px">
          <Spinner size="lg" colorPalette="blue" />
        </Center>
      ) : rows.length === 0 ? (
        <Center py="12">
          <Text color="fg.muted">No markets found</Text>
        </Center>
      ) : (
        <VStack gap="2" align="stretch">
          {rows.map((m) => (
            <MarketRow
              key={m.marketId}
              market={m}
              resolve={resolve}
              logo={logo}
              onClick={() => onSelect(m)}
            />
          ))}
        </VStack>
      )}
    </VStack>
  );
}

function SortButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "subtle" : "outline"}
      colorPalette={active ? "blue" : "gray"}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function MarketRow({
  market,
  resolve,
  logo,
  onClick,
}: {
  market: tradebin.MarketWithStats;
  resolve: ResolveAsset;
  logo: (denom: string) => string;
  onClick: () => void;
}) {
  const baseSym = resolve(market.base)?.symbol ?? market.base;
  const quoteSym = resolve(market.quote)?.symbol ?? market.quote;
  const verified = isVerifiedMarket(market, resolve);
  const stats = market.statsAvailable ? market.stats : null;

  const change = stats ? Number(stats.change) : NaN;
  const changeColor = isNaN(change) ? "fg.muted" : change > 0 ? "green.fg" : change < 0 ? "red.fg" : "fg.muted";
  const changeText = isNaN(change) ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;

  return (
    <HStack
      justify="space-between"
      borderWidth="1px"
      borderRadius="lg"
      p="3"
      cursor="pointer"
      _hover={{ bg: "bg.subtle", borderColor: "blue.500/40" }}
      onClick={onClick}
      role="button"
      aria-label={`Open ${baseSym}/${quoteSym} market`}
    >
      <HStack gap="3" minW="0">
        <HStack gap="1">
          <TokenLogo src={logo(market.base)} symbol={baseSym} size="7" />
          <TokenLogo src={logo(market.quote)} symbol={quoteSym} size="7" />
        </HStack>
        <VStack gap="0" align="start" minW="0">
          <HStack gap="1.5">
            <Text fontWeight="semibold">
              {baseSym}/{quoteSym}
            </Text>
            {verified && (
              <Badge colorPalette="green" variant="subtle" size="sm">
                <HStack gap="1">
                  {LuShield({ size: 10 }) as React.ReactNode}
                  <Text>Verified</Text>
                </HStack>
              </Badge>
            )}
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            Vol {stats ? `${prettyAmount(stats.quoteVolume)} ${quoteSym}` : "—"}
          </Text>
        </VStack>
      </HStack>

      <VStack gap="0" align="end">
        <Text fontWeight="medium" fontVariantNumeric="tabular-nums">
          {stats ? prettyAmount(stats.lastPrice) : "—"}
        </Text>
        <Text fontSize="xs" color={changeColor} fontVariantNumeric="tabular-nums">
          {changeText}
        </Text>
      </VStack>
    </HStack>
  );
}
