import { createContext, useContext } from "react";
import { useAssets, UseAssetsResult } from "../hooks/useAssets";

const AssetsContext = createContext<UseAssetsResult | null>(null);

interface AssetsProviderProps {
  address: string;
  proxyTarget: string;
  children: React.ReactNode;
}

/**
 * App-level owner of the single `useAssets` instance. Sections are kept mounted
 * (hidden panes), so each consuming component instantiating its own `useAssets`
 * multiplied every poll and refresh event into N backend sweeps (BHUB-33) —
 * with this provider exactly one instance polls and all consumers share it.
 */
export function AssetsProvider({ address, proxyTarget, children }: AssetsProviderProps) {
  const value = useAssets(address, proxyTarget);
  return <AssetsContext.Provider value={value}>{children}</AssetsContext.Provider>;
}

/** The shared assets state from the app-level AssetsProvider. */
export function useSharedAssets(): UseAssetsResult {
  const ctx = useContext(AssetsContext);
  if (!ctx) throw new Error("useSharedAssets must be used within AssetsProvider");
  return ctx;
}
