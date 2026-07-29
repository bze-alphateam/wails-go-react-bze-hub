import { useCallback, useEffect, useState } from "react";
import { Box, HStack, Text, VStack, Center, Spinner, Button, IconButton } from "@chakra-ui/react";
import { LuX } from "react-icons/lu";
import { GetMyOrders } from "../../../../wailsjs/go/main/App";
import { tradebin } from "../../../../wailsjs/go/models";
import { useOrderTx } from "../../../hooks/useOrderTx";
import { useMarketEvents } from "../../../hooks/useMarketEvents";
import { useChainEvents } from "../../../hooks/useChainEvents";
import { prettyAmount, uAmountToAmount, uPriceToPrice } from "../../../utils/amount";
import type { ResolveAsset } from "./marketHelpers";

interface MyOrdersProps {
  marketId: string;
  base: string;
  quote: string;
  address: string;
  resolve: ResolveAsset;
}

/**
 * The user's resting orders on this market, with per-order and cancel-all
 * actions (each cancel is broadcast, funds return only after confirmation — no
 * optimistic update). Refreshes on this market's orderbook events and on any tx
 * involving the user's address.
 */
export function MyOrders({ marketId, base, quote, address, resolve }: MyOrdersProps) {
  const [orders, setOrders] = useState<tradebin.Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { cancelOrders, isSubmitting } = useOrderTx(address);

  const baseDecimals = resolve(base)?.decimals ?? 6;
  const quoteDecimals = resolve(quote)?.decimals ?? 6;
  const baseSym = resolve(base)?.symbol ?? base;
  const quoteSym = resolve(quote)?.symbol ?? quote;

  const reload = useCallback(async () => {
    if (!address) {
      setOrders([]);
      setIsLoading(false);
      return;
    }
    try {
      const res = await GetMyOrders(marketId, address);
      setOrders(res ?? []);
    } finally {
      setIsLoading(false);
    }
  }, [marketId, address]);

  useEffect(() => {
    setIsLoading(true);
    void reload();
  }, [reload]);

  useMarketEvents(marketId, { onOrderbook: reload });
  useChainEvents(address, { onMatchingTx: () => void reload() });

  if (!address) {
    return (
      <Center py="8" px="4">
        <Text fontSize="sm" color="fg.muted">
          Connect a wallet to see your orders.
        </Text>
      </Center>
    );
  }

  if (isLoading && orders.length === 0) {
    return (
      <Center h="140px">
        <Spinner size="md" colorPalette="blue" />
      </Center>
    );
  }

  if (orders.length === 0) {
    return (
      <Center py="8" px="4">
        <Text fontSize="sm" color="fg.muted">
          No open orders
        </Text>
      </Center>
    );
  }

  return (
    <VStack gap="0" align="stretch" fontSize="xs" fontVariantNumeric="tabular-nums">
      <HStack justify="space-between" px="2" py="1">
        <Text color="fg.muted">
          {orders.length} open order{orders.length > 1 ? "s" : ""}
        </Text>
        <Button
          size="xs"
          variant="outline"
          colorPalette="red"
          onClick={() => cancelOrders(orders, () => void reload())}
          disabled={isSubmitting}
        >
          Cancel all
        </Button>
      </HStack>
      {orders.map((o) => (
        <HStack key={`${o.orderType}-${o.id}`} justify="space-between" px="2" py="1" borderTopWidth="1px">
          <Text color={o.orderType === "buy" ? "green.fg" : "red.fg"} fontWeight="medium" w="10">
            {o.orderType}
          </Text>
          <Text>{prettyAmount(uPriceToPrice(o.price, quoteDecimals, baseDecimals))}</Text>
          <Text>
            {prettyAmount(uAmountToAmount(o.amount, baseDecimals))} {baseSym}
          </Text>
          <IconButton
            aria-label={`Cancel order ${o.id}`}
            size="2xs"
            variant="ghost"
            colorPalette="red"
            onClick={() => cancelOrders([o], () => void reload())}
            disabled={isSubmitting}
          >
            {LuX({ size: 12 }) as React.ReactNode}
          </IconButton>
        </HStack>
      ))}
      <Box px="2" py="1">
        <Text fontSize="2xs" color="fg.muted">
          Amounts in {baseSym}; prices in {quoteSym}. Cancelled funds return after confirmation.
        </Text>
      </Box>
    </VStack>
  );
}
