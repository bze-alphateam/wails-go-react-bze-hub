import { useState, useEffect, useCallback, useRef } from "react";
import { GetStakingOverview } from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { useChainEvents } from "./useChainEvents";
import type { StakingOverview } from "../utils/stakingTypes";

interface UseStakingDataResult {
  data: StakingOverview | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Hook that fetches all staking data via the Go backend's GetStakingOverview.
 * Polls at 10s (local node) or 30s (public endpoint), matching BalancePanel pattern.
 */
export function useStakingData(
  address: string,
  proxyTarget: string
): UseStakingDataResult {
  const [data, setData] = useState<StakingOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await GetStakingOverview(address);
      setData(result as unknown as StakingOverview);
      setError(null);
    } catch (err) {
      console.error("[useStakingData] fetch failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  // Initial load + reload on address change
  useEffect(() => {
    if (!address) {
      setData(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchData();
  }, [address, fetchData]);

  // Polling interval based on proxy target
  useEffect(() => {
    if (!address) return;

    const intervalMs = proxyTarget === "local" ? 10_000 : 30_000;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(fetchData, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [address, proxyTarget, fetchData]);

  // Listen for node status changes (adjusts when proxy switches local <-> public)
  useEffect(() => {
    const cancel = EventsOn("state:node-changed", () => {
      // Proxy target change will trigger re-render via parent passing new proxyTarget
      // but we also do an immediate fetch on node status change
      fetchData();
    });
    return cancel;
  }, [fetchData]);

  // Live refresh: a tx involving the active address (delegate, claim, etc.)
  // refreshes staking data within a block, coalesced so we fetch once per block.
  useChainEvents(address, { onMatchingTx: () => fetchData() });

  return { data, isLoading, error, reload: fetchData };
}
