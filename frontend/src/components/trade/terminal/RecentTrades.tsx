import { useCallback, useEffect, useState } from "react";
import { Box, HStack, Text, VStack, Center, Spinner } from "@chakra-ui/react";
import { GetMarketHistory } from "../../../../wailsjs/go/main/App";
import { tradebin } from "../../../../wailsjs/go/models";
import { useMarketEvents } from "../../../hooks/useMarketEvents";
import { prettyAmount } from "../../../utils/amount";
import type { ResolveAsset } from "./marketHelpers";

interface RecentTradesProps {
  marketId: string;
  base: string;
  quote: string;
  resolve: ResolveAsset;
}

/** Formats an aggregator executed_at timestamp to a local time, best-effort. */
function formatTime(executedAt: string): string {
  const d = new Date(executedAt);
  if (isNaN(d.getTime())) return executedAt;
  return d.toLocaleTimeString();
}

/**
 * Recent executed trades for the market, from the aggregator history feed. Buy
 * trades are green, sells red. Refreshes live on `chain:trade` for this market.
 */
export function RecentTrades({ marketId, base, quote, resolve }: RecentTradesProps) {
  const [trades, setTrades] = useState<tradebin.Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await GetMarketHistory(marketId);
      setTrades(res ?? []);
    } finally {
      setIsLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    setIsLoading(true);
    void reload();
  }, [reload]);

  useMarketEvents(marketId, { onTrade: reload });

  const baseSym = resolve(base)?.symbol ?? base;
  const quoteSym = resolve(quote)?.symbol ?? quote;

  if (isLoading && trades.length === 0) {
    return (
      <Center h="160px">
        <Spinner size="md" colorPalette="blue" />
      </Center>
    );
  }

  if (trades.length === 0) {
    return (
      <Center py="8">
        <Text color="fg.muted" fontSize="sm">
          No trades yet
        </Text>
      </Center>
    );
  }

  return (
    <VStack gap="0" align="stretch" fontSize="xs" fontVariantNumeric="tabular-nums">
      <HStack justify="space-between" px="2" py="1" color="fg.muted">
        <Text>Price ({quoteSym})</Text>
        <Text>Amount ({baseSym})</Text>
        <Text>Time</Text>
      </HStack>
      {trades.map((t, i) => (
        <HStack key={`${t.orderId}-${i}`} justify="space-between" px="2" py="0.5">
          <Text color={t.orderType === "buy" ? "green.fg" : "red.fg"} fontWeight="medium">
            {prettyAmount(t.price)}
          </Text>
          <Text>{prettyAmount(t.baseVolume)}</Text>
          <Text color="fg.muted">{formatTime(t.executedAt)}</Text>
        </HStack>
      ))}
    </VStack>
  );
}
