import { useCallback, useEffect, useRef, useState } from "react";
import { QuoteSwap } from "../../wailsjs/go/main/App";
import type { amm } from "../../wailsjs/go/models";
import { useChainEvents } from "./useChainEvents";

/** A quote together with the inputs and block height it was computed at. */
export interface QuotedSwap {
  quote: amm.SwapQuote;
  /**
   * Chain block height the quote was computed at. Empty until the first
   * `chain:block` event arrives. The execution story's staleness guard compares
   * this against the current height before broadcasting.
   */
  blockHeight: string;
  /** Base-unit input amount this quote is for. */
  amountIn: string;
  denomIn: string;
  denomOut: string;
}

export interface UseSwapQuote {
  /** The latest quote, or null when inputs are incomplete or a request failed. */
  quoted: QuotedSwap | null;
  /** True while a quote request is in flight. */
  isQuoting: boolean;
  /** A non-null message when the QuoteSwap binding itself errored (not a no-route). */
  error: string | null;
}

/** Debounce before firing a quote on input changes, in ms. */
const DEBOUNCE_MS = 350;

function inputsReady(
  denomIn: string,
  denomOut: string,
  amountInBase: string | null,
): amountInBase is string {
  return Boolean(denomIn && denomOut && denomIn !== denomOut && amountInBase);
}

/**
 * Live swap quoting against the Go `QuoteSwap` binding (BHUB-22).
 *
 * - Debounces requests while the user types.
 * - Re-quotes on every new `chain:block` so the quote tracks fresh reserves,
 *   and stamps each quote with the block height it was computed at.
 * - Ignores out-of-order responses via a monotonic request id, so a slow quote
 *   can never overwrite a newer one.
 *
 * A NoRoute result is a normal quote (`quote.noRoute === true`), not an error;
 * `error` is set only when the binding itself throws.
 */
export function useSwapQuote(
  denomIn: string,
  denomOut: string,
  amountInBase: string | null,
  address: string,
): UseSwapQuote {
  const [quoted, setQuoted] = useState<QuotedSwap | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blockHeightRef = useRef<string>("");
  // Monotonic id: only the most recently issued request may commit a result.
  const reqId = useRef(0);

  const runQuote = useCallback(async () => {
    if (!inputsReady(denomIn, denomOut, amountInBase)) {
      reqId.current++; // cancel anything in flight
      setQuoted(null);
      setIsQuoting(false);
      setError(null);
      return;
    }
    const id = ++reqId.current;
    setIsQuoting(true);
    try {
      const quote = await QuoteSwap(denomIn, denomOut, amountInBase);
      if (id !== reqId.current) return; // superseded by a newer request
      setQuoted({
        quote,
        blockHeight: blockHeightRef.current,
        amountIn: amountInBase,
        denomIn,
        denomOut,
      });
      setError(null);
    } catch (err) {
      if (id !== reqId.current) return;
      console.error("[useSwapQuote] quote failed:", err);
      setError(err instanceof Error ? err.message : String(err));
      setQuoted(null);
    } finally {
      if (id === reqId.current) setIsQuoting(false);
    }
  }, [denomIn, denomOut, amountInBase]);

  // Debounced quote whenever the inputs change.
  useEffect(() => {
    if (!inputsReady(denomIn, denomOut, amountInBase)) {
      reqId.current++;
      setQuoted(null);
      setIsQuoting(false);
      setError(null);
      return;
    }
    const timer = setTimeout(runQuote, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [runQuote, denomIn, denomOut, amountInBase]);

  // Track the latest block height and re-quote on each new block (no debounce —
  // blocks are seconds apart). Handlers are read through a ref inside
  // useChainEvents, so passing a fresh closure each render is fine.
  useChainEvents(address, {
    onBlock: (height) => {
      blockHeightRef.current = height;
      if (inputsReady(denomIn, denomOut, amountInBase)) {
        void runQuote();
      }
    },
  });

  return { quoted, isQuoting, error };
}
