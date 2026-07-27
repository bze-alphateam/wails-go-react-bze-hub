import { useCallback, useEffect, useRef, useState } from "react";
import { GetLiquidityPools } from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import type { amm } from "../../wailsjs/go/models";

export interface UseLiquidityPools {
  pools: amm.Pool[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Loads every tradebin liquidity pool from the Go AMM backend (BHUB-22) and
 * keeps it fresh on the same cadence as the rest of the app — a poll interval
 * plus the backend's `assets:updated` / `state:node-changed` events. The set is
 * small and pools change rarely, so this is cheap; the swap card uses it only to
 * distinguish "no route" from "insufficient liquidity" when a quote comes back
 * with no route. Quotes themselves re-fetch pools inside `QuoteSwap`.
 */
export function useLiquidityPools(proxyTarget: string): UseLiquidityPools {
  const [pools, setPools] = useState<amm.Pool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPools = useCallback(async () => {
    try {
      const result = await GetLiquidityPools();
      setPools((result as unknown as amm.Pool[]) || []);
      setError(null);
    } catch (err) {
      console.error("[useLiquidityPools] fetch failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetchPools();
  }, [fetchPools]);

  // Poll on the same cadence the dashboard uses.
  useEffect(() => {
    const intervalMs = proxyTarget === "local" ? 10_000 : 30_000;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchPools, intervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [proxyTarget, fetchPools]);

  // Re-load when the engine refreshes or the node switches.
  useEffect(() => {
    const cancelAssets = EventsOn("assets:updated", () => fetchPools());
    const cancelNode = EventsOn("state:node-changed", () => fetchPools());
    return () => {
      cancelAssets();
      cancelNode();
    };
  }, [fetchPools]);

  return { pools, isLoading, error, reload: fetchPools };
}
