import { useCallback, useEffect, useMemo, useState } from "react";
import BigNumber from "bignumber.js";
import { Box, HStack, Text, VStack, Center, Spinner } from "@chakra-ui/react";
import { GetOrderbook } from "../../../../wailsjs/go/main/App";
import { tradebin } from "../../../../wailsjs/go/models";
import { useMarketEvents } from "../../../hooks/useMarketEvents";
import { prettyAmount } from "../../../utils/amount";
import {
  buildDepth,
  cumulativeMaxU,
  spread,
  type DepthLevel,
  type ResolveAsset,
} from "./marketHelpers";

interface OrderbookProps {
  marketId: string;
  base: string;
  quote: string;
  resolve: ResolveAsset;
  /** Called with the display price when a level is clicked (feeds the order form). */
  onPriceSelect: (price: string) => void;
}

/**
 * The market's aggregated orderbook: sell levels (asks) above, a spread row, then
 * buy levels (bids). Each level shows cumulative depth as a background bar and,
 * when clicked, sends its price up via onPriceSelect. Refreshes live on
 * `chain:orderbook` for this market only (no polling).
 */
export function Orderbook({ marketId, base, quote, resolve, onPriceSelect }: OrderbookProps) {
  const [book, setBook] = useState<tradebin.Orderbook | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const baseDecimals = resolve(base)?.decimals ?? 6;
  const quoteDecimals = resolve(quote)?.decimals ?? 6;

  const reload = useCallback(async () => {
    try {
      const ob = await GetOrderbook(marketId);
      setBook(ob);
    } finally {
      setIsLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    setIsLoading(true);
    void reload();
  }, [reload]);

  // Live: refresh this market's book when it changes on-chain.
  useMarketEvents(marketId, { onOrderbook: reload });

  const { asks, bids, spreadRow } = useMemo(() => {
    const buy = book?.buy ?? [];
    const sell = book?.sell ?? [];
    // Shared scale so bid/sell bar widths are comparable.
    const max = BigNumber.max(cumulativeMaxU(buy), cumulativeMaxU(sell));
    const sellDepth = buildDepth(sell, baseDecimals, quoteDecimals, max);
    const buyDepth = buildDepth(buy, baseDecimals, quoteDecimals, max);
    return {
      // Asks shown highest-price on top, lowest just above the spread.
      asks: [...sellDepth].reverse(),
      bids: buyDepth,
      spreadRow: spread(buy, sell, baseDecimals, quoteDecimals),
    };
  }, [book, baseDecimals, quoteDecimals]);

  const baseSym = resolve(base)?.symbol ?? base;
  const quoteSym = resolve(quote)?.symbol ?? quote;

  if (isLoading && !book) {
    return (
      <Center h="200px">
        <Spinner size="md" colorPalette="blue" />
      </Center>
    );
  }

  const isEmpty = asks.length === 0 && bids.length === 0;

  return (
    <VStack gap="0" align="stretch" fontSize="xs" fontVariantNumeric="tabular-nums">
      <HStack justify="space-between" px="2" py="1" color="fg.muted">
        <Text>Price ({quoteSym})</Text>
        <Text>Amount ({baseSym})</Text>
        <Text>Total</Text>
      </HStack>

      {isEmpty ? (
        <Center py="8">
          <Text color="fg.muted">No orders yet</Text>
        </Center>
      ) : (
        <>
          <VStack gap="0" align="stretch">
            {asks.map((lvl, i) => (
              <LevelRow key={`a${i}`} level={lvl} side="sell" onClick={() => onPriceSelect(lvl.price)} />
            ))}
          </VStack>

          <HStack justify="space-between" px="2" py="1.5" borderYWidth="1px" bg="bg.subtle">
            <Text fontWeight="semibold" color="fg.muted">
              Spread
            </Text>
            <Text color="fg.muted">
              {spreadRow ? `${prettyAmount(spreadRow.value)} (${spreadRow.percent}%)` : "—"}
            </Text>
          </HStack>

          <VStack gap="0" align="stretch">
            {bids.map((lvl, i) => (
              <LevelRow key={`b${i}`} level={lvl} side="buy" onClick={() => onPriceSelect(lvl.price)} />
            ))}
          </VStack>
        </>
      )}
    </VStack>
  );
}

function LevelRow({
  level,
  side,
  onClick,
}: {
  level: DepthLevel;
  side: "buy" | "sell";
  onClick: () => void;
}) {
  const priceColor = side === "buy" ? "green.fg" : "red.fg";
  const barColor = side === "buy" ? "green.500/12" : "red.500/12";
  return (
    <Box
      position="relative"
      px="2"
      py="0.5"
      cursor="pointer"
      _hover={{ bg: "bg.emphasized" }}
      onClick={onClick}
      role="button"
      aria-label={`Select price ${level.price}`}
    >
      <Box
        position="absolute"
        top="0"
        right="0"
        bottom="0"
        w={`${Math.min(100, level.depthPct)}%`}
        bg={barColor}
        pointerEvents="none"
      />
      <HStack justify="space-between" position="relative">
        <Text color={priceColor} fontWeight="medium">
          {prettyAmount(level.price)}
        </Text>
        <Text>{prettyAmount(level.amount)}</Text>
        <Text color="fg.muted">{prettyAmount(level.total)}</Text>
      </HStack>
    </Box>
  );
}
