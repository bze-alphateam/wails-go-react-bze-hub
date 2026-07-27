import { useCallback, useEffect, useState } from "react";
import { GetSettings, UpdateSetting } from "../../wailsjs/go/main/App";
import { DEFAULT_SLIPPAGE } from "../components/trade/swapHelpers";

/** Settings key under which the swap slippage tolerance is persisted. */
export const SLIPPAGE_KEY = "swap.slippage";

function coerceSlippage(stored: unknown): number {
  const n =
    typeof stored === "number"
      ? stored
      : typeof stored === "string"
        ? parseFloat(stored)
        : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 50 ? n : DEFAULT_SLIPPAGE;
}

export interface UseSwapSlippage {
  /** Current slippage tolerance, in percent. */
  slippage: number;
  /** Set and persist the slippage tolerance. */
  setSlippage: (v: number) => void;
  /** True once the stored preference has been read. */
  loaded: boolean;
}

/**
 * Swap slippage tolerance (percent), persisted in app settings exactly the way
 * the per-section Simple/Advanced choice is (see `useSectionView`): read once on
 * mount, written back on every explicit change. Defaults to 0.5% (web parity).
 */
export function useSwapSlippage(): UseSwapSlippage {
  const [slippage, setSlippageState] = useState<number>(DEFAULT_SLIPPAGE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    GetSettings()
      .then((settings: Record<string, unknown>) => {
        if (cancelled) return;
        setSlippageState(coerceSlippage(settings?.[SLIPPAGE_KEY]));
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSlippageState(DEFAULT_SLIPPAGE);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSlippage = useCallback((v: number) => {
    setSlippageState(v);
    // Persist the user's explicit choice; failures are non-fatal (the UI still
    // reflects the change for this session).
    UpdateSetting(SLIPPAGE_KEY, v).catch((e) => {
      console.error("persist slippage:", e);
    });
  }, []);

  return { slippage, setSlippage, loaded };
}
