import { useEffect, useRef } from "react";
import { EventsOn } from "../../wailsjs/runtime/runtime";

/** Payload of the Go `chain:orderbook` / `chain:trade` events. */
export interface MarketEventPayload {
  marketId?: string;
}

export interface MarketEventHandlers {
  /** The open market's aggregated book changed (order placed/cancelled/filled). */
  onOrderbook?: () => void;
  /** A trade executed on the open market (feeds recent trades + chart). */
  onTrade?: () => void;
}

/**
 * Subscribes to the Go market event stream and drives the handlers, but ONLY for
 * `marketId` — the open market. This keeps live refresh event-driven (no polling)
 * and scoped to the market in view, per the M3 rule. Handlers are read through a
 * ref so passing fresh closures each render does not tear down the subscription.
 */
export function useMarketEvents(marketId: string, handlers: MarketEventHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!marketId) return;

    const offOrderbook = EventsOn("chain:orderbook", (p: MarketEventPayload) => {
      if (p?.marketId === marketId) ref.current.onOrderbook?.();
    });
    const offTrade = EventsOn("chain:trade", (p: MarketEventPayload) => {
      if (p?.marketId === marketId) ref.current.onTrade?.();
    });

    return () => {
      offOrderbook();
      offTrade();
    };
  }, [marketId]);
}
