import { useState, useEffect, useCallback, useRef } from "react";
import BigNumber from "bignumber.js";
import { GetAssets, GetAssetLogo } from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { toBigNumber, uAmountToBigNumberAmount } from "../utils/amount";

/** Counterparty (origin-chain) metadata for an IBC asset. */
export interface IBCCounterparty {
  chainName: string;
  chainPrettyName: string;
  channelId: string;
  baseDenom: string;
}

/** Resolved IBC trace metadata attached to ibc/* assets. */
export interface IBCInfo {
  channelId: string;
  counterparty: IBCCounterparty;
}

/**
 * A resolved asset plus on-chain supply, the active account's balance, and USD
 * unit price — the shape of `assets.AssetBalance` from the Go backend. Prices are
 * decimal strings ("" when unknown); amounts/supply are raw base-unit integers.
 */
export interface AssetBalance {
  denom: string;
  symbol: string;
  name: string;
  decimals: number;
  type: string;
  verified: boolean;
  stable: boolean;
  ibc?: IBCInfo;
  supply: string;
  amount: string;
  price: string;
}

export interface UseAssetsResult {
  assets: AssetBalance[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
  /** Look up a loaded asset by denom. */
  resolve: (denom: string) => AssetBalance | undefined;
  /** USD unit price for a denom as a BigNumber, or null when no price is known. */
  price: (denom: string) => BigNumber | null;
  /** Logo data URL for a denom, or "" (the UI falls back to the symbol initial). */
  logo: (denom: string) => string;
  /**
   * USD value of a raw (base-unit) amount of a denom, or null when the denom has
   * no known price. Uses the asset's decimals — big-number-safe, never float.
   */
  usdValue: (denom: string, uAmount: string | number | BigNumber) => BigNumber | null;
}

/**
 * Loads resolved assets (with balances, prices) from the Go asset engine and
 * their cached logos, re-loading whenever the backend emits `assets:updated`
 * (registry refresh, price refresh) and on a poll interval. Mirrors the web
 * ui-kit `useAssets` surface for components: `resolve`, price lookups, logos.
 */
export function useAssets(address: string, proxyTarget: string): UseAssetsResult {
  const [assets, setAssets] = useState<AssetBalance[]>([]);
  const [logos, setLogos] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track denoms whose logo has already been requested, so a poll/refresh doesn't
  // re-request them (the Go side caches too, but this avoids the round-trips).
  const requestedLogos = useRef<Set<string>>(new Set());

  const loadLogos = useCallback(async (list: AssetBalance[]) => {
    const missing = list.filter((a) => !requestedLogos.current.has(a.denom));
    if (missing.length === 0) return;

    missing.forEach((a) => requestedLogos.current.add(a.denom));
    const results = await Promise.all(
      missing.map(async (a) => {
        try {
          return [a.denom, await GetAssetLogo(a.denom)] as const;
        } catch {
          return [a.denom, ""] as const;
        }
      })
    );

    const next: Record<string, string> = {};
    for (const [denom, url] of results) {
      if (url) next[denom] = url;
    }
    if (Object.keys(next).length > 0) {
      setLogos((prev) => ({ ...prev, ...next }));
    }
  }, []);

  const fetchAssets = useCallback(async () => {
    try {
      const result = await GetAssets();
      const list = (result as unknown as AssetBalance[]) || [];
      setAssets(list);
      setError(null);
      void loadLogos(list);
    } catch (err) {
      console.error("[useAssets] fetch failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [loadLogos]);

  // Initial load + reload on address change.
  useEffect(() => {
    setIsLoading(true);
    fetchAssets();
  }, [address, fetchAssets]);

  // Poll on the same cadence as the rest of the dashboard.
  useEffect(() => {
    const intervalMs = proxyTarget === "local" ? 10_000 : 30_000;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchAssets, intervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [proxyTarget, fetchAssets]);

  // Re-load when the engine refreshes registry or prices, or the node switches.
  useEffect(() => {
    const cancelAssets = EventsOn("assets:updated", () => fetchAssets());
    const cancelNode = EventsOn("state:node-changed", () => fetchAssets());
    return () => {
      cancelAssets();
      cancelNode();
    };
  }, [fetchAssets]);

  const resolve = useCallback(
    (denom: string) => assets.find((a) => a.denom === denom),
    [assets]
  );

  const price = useCallback(
    (denom: string): BigNumber | null => {
      const asset = assets.find((a) => a.denom === denom);
      if (!asset || !asset.price) return null;
      const p = toBigNumber(asset.price);
      return p.isNaN() || p.lte(0) ? null : p;
    },
    [assets]
  );

  const logo = useCallback((denom: string) => logos[denom] ?? "", [logos]);

  const usdValue = useCallback(
    (denom: string, uAmount: string | number | BigNumber): BigNumber | null => {
      const asset = assets.find((a) => a.denom === denom);
      if (!asset || !asset.price) return null;
      const p = toBigNumber(asset.price);
      if (p.isNaN() || p.lte(0)) return null;
      return p.multipliedBy(uAmountToBigNumberAmount(uAmount, asset.decimals));
    },
    [assets]
  );

  return { assets, isLoading, error, reload: fetchAssets, resolve, price, logo, usdValue };
}
