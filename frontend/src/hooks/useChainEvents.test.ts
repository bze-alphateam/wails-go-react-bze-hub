import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock Wails EventsOn: record listeners so tests can fire chain events.
const { EventsOn, listeners } = vi.hoisted(() => {
  const listeners: Record<string, (payload?: unknown) => void> = {};
  return {
    listeners,
    EventsOn: vi.fn((event: string, cb: (payload?: unknown) => void) => {
      listeners[event] = cb;
      return () => {
        delete listeners[event];
      };
    }),
  };
});
vi.mock("../../wailsjs/runtime/runtime", () => ({ EventsOn }));

import { useChainEvents } from "./useChainEvents";

const ADDR = "bze1me";

beforeEach(() => {
  for (const k of Object.keys(listeners)) delete listeners[k];
});

function fireTx(payload: { height?: string; addresses?: string[] }) {
  act(() => listeners["chain:tx"](payload));
}

describe("useChainEvents", () => {
  it("calls onMatchingTx only when the active address is involved", () => {
    const onMatchingTx = vi.fn();
    renderHook(() => useChainEvents(ADDR, { onMatchingTx }));

    fireTx({ height: "1", addresses: ["bze1other"] });
    expect(onMatchingTx).not.toHaveBeenCalled();

    fireTx({ height: "2", addresses: ["bze1other", ADDR] });
    expect(onMatchingTx).toHaveBeenCalledTimes(1);
    expect(onMatchingTx).toHaveBeenCalledWith("2");
  });

  it("coalesces multiple matching txs in the same block into one call", () => {
    const onMatchingTx = vi.fn();
    renderHook(() => useChainEvents(ADDR, { onMatchingTx }));

    fireTx({ height: "5", addresses: [ADDR] });
    fireTx({ height: "5", addresses: [ADDR] }); // same block → coalesced
    expect(onMatchingTx).toHaveBeenCalledTimes(1);

    fireTx({ height: "6", addresses: [ADDR] }); // next block → fires again
    expect(onMatchingTx).toHaveBeenCalledTimes(2);
  });

  it("fires onBlock for every new block", () => {
    const onBlock = vi.fn();
    renderHook(() => useChainEvents(ADDR, { onBlock }));

    act(() => listeners["chain:block"]({ height: "100" }));
    act(() => listeners["chain:block"]({ height: "101" }));
    expect(onBlock).toHaveBeenCalledTimes(2);
    expect(onBlock).toHaveBeenLastCalledWith("101");
  });

  it("does nothing without an active address", () => {
    const onMatchingTx = vi.fn();
    renderHook(() => useChainEvents("", { onMatchingTx }));

    fireTx({ height: "1", addresses: [""] });
    expect(onMatchingTx).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useChainEvents(ADDR, {}));
    expect(listeners["chain:tx"]).toBeTypeOf("function");
    unmount();
    expect(listeners["chain:tx"]).toBeUndefined();
  });
});
