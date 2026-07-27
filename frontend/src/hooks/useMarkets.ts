import { useCallback, useEffect, useState } from "react";
import { GetMarkets } from "../../wailsjs/go/main/App";
import { tradebin } from "../../wailsjs/go/models";

export interface UseMarketsResult {
  markets: tradebin.MarketWithStats[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Loads the tradebin markets (merged with 24h aggregator stats) from the Go
 * binding. The aggregator-down case is not an error here — markets still come
 * back with `statsAvailable === false`, so the list renders without stats.
 */
export function useMarkets(): UseMarketsResult {
  const [markets, setMarkets] = useState<tradebin.MarketWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await GetMarkets();
      setMarkets(res ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { markets, isLoading, error, reload };
}
