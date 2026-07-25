import { useEffect, useRef } from "react";
import { EventsOn } from "../../wailsjs/runtime/runtime";

/** Payload of the Go `chain:tx` event. */
export interface ChainTxPayload {
  height?: string;
  addresses?: string[];
}

/** Payload of the Go `chain:block` event. */
export interface ChainBlockPayload {
  height?: string;
}

export interface ChainEventHandlers {
  /**
   * Called when a tx involving `address` is delivered, at most once per block
   * height (multiple matching txs in the same block are coalesced into one call)
   * — so features refresh once per block instead of flooding.
   */
  onMatchingTx?: (height: string) => void;
  /** Called on every new block. */
  onBlock?: (height: string) => void;
}

/**
 * Subscribes to the Go chain event stream (`chain:tx` / `chain:block`) and drives
 * the given handlers. `onMatchingTx` fires only for txs that involve `address`,
 * coalesced per block. Handlers are read through a ref, so passing fresh closures
 * each render is fine — the subscription is not torn down on every render.
 */
export function useChainEvents(address: string, handlers: ChainEventHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const lastTxHeight = useRef<string>("");

  useEffect(() => {
    const offTx = EventsOn("chain:tx", (payload: ChainTxPayload) => {
      if (!address) return;
      const addresses = payload?.addresses ?? [];
      if (!addresses.includes(address)) return;

      const height = payload?.height ?? "";
      // Coalesce: one call per block even if several matching txs land.
      if (height && height === lastTxHeight.current) return;
      lastTxHeight.current = height;

      handlersRef.current.onMatchingTx?.(height);
    });

    const offBlock = EventsOn("chain:block", (payload: ChainBlockPayload) => {
      handlersRef.current.onBlock?.(payload?.height ?? "");
    });

    return () => {
      offTx();
      offBlock();
    };
  }, [address]);
}
