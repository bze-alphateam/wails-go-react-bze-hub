import { createContext, useContext } from "react";
import { useStakingData, UseStakingDataResult } from "../hooks/useStakingData";

const StakingContext = createContext<UseStakingDataResult | null>(null);

interface StakingProviderProps {
  address: string;
  proxyTarget: string;
  children: React.ReactNode;
}

/**
 * App-level owner of the single `useStakingData` instance, shared by the Earn
 * page and the Portfolio BZE detail so only one poll loop hits the backend
 * (BHUB-33 — same rationale as AssetsProvider).
 */
export function StakingProvider({ address, proxyTarget, children }: StakingProviderProps) {
  const value = useStakingData(address, proxyTarget);
  return <StakingContext.Provider value={value}>{children}</StakingContext.Provider>;
}

/** The shared staking overview from the app-level StakingProvider. */
export function useSharedStaking(): UseStakingDataResult {
  const ctx = useContext(StakingContext);
  if (!ctx) throw new Error("useSharedStaking must be used within StakingProvider");
  return ctx;
}
