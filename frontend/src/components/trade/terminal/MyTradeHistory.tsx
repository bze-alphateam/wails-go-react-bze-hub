import { useCallback, useEffect, useState } from "react";
import { HStack, Text, VStack, Center, Spinner } from "@chakra-ui/react";
import { GetAddressMarketHistory } from "../../../../wailsjs/go/main/App";
import { tradebin } from "../../../../wailsjs/go/models";
import { useMarketEvents } from "../../../hooks/useMarketEvents";
import { useChainEvents } from "../../../hooks/useChainEvents";
import { prettyAmount } from "../../../utils/amount";
import type { ResolveAsset } from "./marketHelpers";

interface MyTradeHistoryProps {
  marketId: string;
  base: string;
  quote: string;
  address: string;
  resolve: ResolveAsset;
}

function formatTime(executedAt: string): string {
  const d = new Date(executedAt);
  return isNaN(d.getTime()) ? executedAt : d.toLocaleTimeString();
}

/** The user's own executed trades on this market (aggregator, address-scoped). */
export function MyTradeHistory({ marketId, base, quote, address, resolve }: MyTradeHistoryProps) {
  const [trades, setTrades] = useState<tradebin.Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const baseSym = resolve(base)?.symbol ?? base;
  const quoteSym = resolve(quote)?.symbol ?? quote;

  const reload = useCallback(async () => {
    if (!address) {
      setTrades([]);
      setIsLoading(false);
      return;
    }
    try {
      const res = await GetAddressMarketHistory(marketId, address);
      setTrades(res ?? []);
    } finally {
      setIsLoading(false);
    }
  }, [marketId, address]);

  useEffect(() => {
    setIsLoading(true);
    void reload();
  }, [reload]);

  useMarketEvents(marketId, { onTrade: reload });
  useChainEvents(address, { onMatchingTx: () => void reload() });

  if (!address) {
    return (
      <Center py="8" px="4">
        <Text fontSize="sm" color="fg.muted">
          Connect a wallet to see your history.
        </Text>
      </Center>
    );
  }

  if (isLoading && trades.length === 0) {
    return (
      <Center h="140px">
        <Spinner size="md" colorPalette="blue" />
      </Center>
    );
  }

  if (trades.length === 0) {
    return (
      <Center py="8" px="4">
        <Text fontSize="sm" color="fg.muted">
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
