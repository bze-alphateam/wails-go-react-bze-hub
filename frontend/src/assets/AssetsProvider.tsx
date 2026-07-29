// AssetsProvider — loads the chain's bank denom-metadata once and exposes a small,
// stable API for resolving and formatting any token. Mirrors the role of
// bze-ui-kit's AssetsContext/useAssets, scoped to what the desktop app needs.

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { GetDenomsMetadata } from "../../wailsjs/go/main/App";
import type { AssetMeta } from "./types";
import {
  buildChainAssetMap,
  combineAssets,
  resolveAsset,
  type ChainDenomMetadata,
} from "./registry";
import {
  uAmountToHuman,
  formatUAmount,
  type FormatOptions,
} from "./format";

type Amount = string | number | bigint;

interface AssetsContextValue {
  isLoading: boolean;
  /** Resolve full metadata for a denom — never null (heuristic fallback). */
  getAsset: (denom: string) => AssetMeta;
  /** Decimals for a denom. */
  decimals: (denom: string) => number;
  /** Display symbol for a denom (e.g. "BZE", "VDL"). */
  symbol: (denom: string) => string;
  /** Base units → exact human number string. */
  toHuman: (amount: Amount, denom: string) => string;
  /** Base units → formatted, grouped display string. */
  format: (amount: Amount, denom: string, opts?: FormatOptions) => string;
  /** All known assets (static + curated IBC + chain), for pickers/enumeration. */
  assets: AssetMeta[];
  /** Force a metadata refresh. */
  reload: () => void;
}

const AssetsContext = createContext<AssetsContextValue | null>(null);

const REFRESH_MS = 10 * 60 * 1000;
const MAX_RETRIES = 5;

export function AssetsProvider({ children }: { children: ReactNode }) {
  const [chainMap, setChainMap] = useState<Map<string, AssetMeta>>(() => new Map());
  const [isLoading, setIsLoading] = useState(true);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<number> => {
    try {
      const meta = (await GetDenomsMetadata()) as unknown as ChainDenomMetadata[];
      const map = buildChainAssetMap(meta || []);
      setChainMap(map);
      return map.size;
    } catch (e) {
      console.error("[assets] denom metadata load failed:", e);
      return 0;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async (attempt: number) => {
      const n = await load();
      if (cancelled) return;
      // Empty likely means the node/proxy isn't ready yet — retry with backoff.
      if (n === 0 && attempt < MAX_RETRIES) {
        retryRef.current = setTimeout(
          () => run(attempt + 1),
          Math.min(15000, 3000 * (attempt + 1))
        );
      }
    };
    void run(0);
    const interval = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      clearInterval(interval);
    };
  }, [load]);

  const value = useMemo<AssetsContextValue>(() => {
    const getAsset = (denom: string) => resolveAsset(denom, chainMap);
    return {
      isLoading,
      getAsset,
      decimals: (denom) => getAsset(denom).decimals,
      symbol: (denom) => getAsset(denom).symbol,
      toHuman: (amount, denom) => uAmountToHuman(amount, getAsset(denom).decimals),
      format: (amount, denom, opts) => formatUAmount(amount, getAsset(denom).decimals, opts),
      assets: Array.from(combineAssets(chainMap).values()),
      reload: () => void load(),
    };
  }, [chainMap, isLoading, load]);

  return <AssetsContext.Provider value={value}>{children}</AssetsContext.Provider>;
}

export function useAssets(): AssetsContextValue {
  const ctx = useContext(AssetsContext);
  if (!ctx) throw new Error("useAssets must be used within <AssetsProvider>");
  return ctx;
}
