import { useCallback, useEffect, useState } from "react";
import { GetMyOpenOrdersCount } from "../../wailsjs/go/main/App";
import { useChainEvents } from "./useChainEvents";

/**
 * Tracks how many resting orders the address has across ALL markets, via the
 * cheap count binding. Refreshes when a tx involving the address lands (an order
 * placed or cancelled changes the count), so the Simple view's summary stays
 * current without polling.
 */
export function useOpenOrdersCount(address: string): number {
  const [count, setCount] = useState(0);

  const reload = useCallback(async () => {
    if (!address) {
      setCount(0);
      return;
    }
    try {
      setCount(await GetMyOpenOrdersCount(address));
    } catch {
      setCount(0);
    }
  }, [address]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useChainEvents(address, { onMatchingTx: () => void reload() });

  return count;
}
