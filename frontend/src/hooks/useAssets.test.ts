import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Hoisted Wails mocks: the two App bindings and an EventsOn that records
// listeners so tests can fire "assets:updated" like the Go backend would.
const { GetAssets, GetAssetLogo, EventsOn, listeners } = vi.hoisted(() => {
  const listeners: Record<string, (data?: unknown) => void> = {};
  return {
    GetAssets: vi.fn(),
    GetAssetLogo: vi.fn(),
    EventsOn: vi.fn((event: string, cb: (data?: unknown) => void) => {
      listeners[event] = cb;
      return () => {
        delete listeners[event];
      };
    }),
    listeners,
  };
});

vi.mock("../../wailsjs/go/main/App", () => ({ GetAssets, GetAssetLogo }));
vi.mock("../../wailsjs/runtime/runtime", () => ({ EventsOn }));

import { useAssets, type AssetBalance } from "./useAssets";

function asset(over: Partial<AssetBalance>): AssetBalance {
  return {
    denom: "ubze",
    symbol: "BZE",
    name: "BeeZee",
    decimals: 6,
    type: "native",
    verified: true,
    stable: false,
    supply: "1000000",
    amount: "2000000",
    price: "0.0005",
    ...over,
  };
}

beforeEach(() => {
  GetAssets.mockReset();
  GetAssetLogo.mockReset();
  GetAssetLogo.mockResolvedValue("data:image/svg+xml;base64,AAAA");
  for (const k of Object.keys(listeners)) delete listeners[k];
});

describe("useAssets", () => {
  it("loads assets and exposes resolve, price and usdValue", async () => {
    GetAssets.mockResolvedValue([asset({})]);
    const { result } = renderHook(() => useAssets("bze1addr", "public"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.assets).toHaveLength(1);

    const bze = result.current.resolve("ubze");
    expect(bze?.symbol).toBe("BZE");

    // price parses the decimal string into a BigNumber.
    expect(result.current.price("ubze")?.toString()).toBe("0.0005");

    // usdValue = price * displayAmount (2 BZE * $0.0005 = $0.001), big-number-safe.
    expect(result.current.usdValue("ubze", "2000000")?.toString()).toBe("0.001");
  });

  it("returns null price for an asset with no price (never $0)", async () => {
    GetAssets.mockResolvedValue([asset({ denom: "uvdl", symbol: "VDL", price: "" })]);
    const { result } = renderHook(() => useAssets("bze1addr", "public"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.price("uvdl")).toBeNull();
    expect(result.current.usdValue("uvdl", "1000000")).toBeNull();
  });

  it("re-loads assets when the backend emits assets:updated", async () => {
    GetAssets.mockResolvedValueOnce([asset({ price: "0.0005" })]);
    const { result } = renderHook(() => useAssets("bze1addr", "public"));
    await waitFor(() => expect(result.current.price("ubze")?.toString()).toBe("0.0005"));

    // A price refresh lands on the Go side and emits the event.
    GetAssets.mockResolvedValueOnce([asset({ price: "0.0006" })]);
    expect(listeners["assets:updated"]).toBeTypeOf("function");
    await act(async () => {
      listeners["assets:updated"]();
    });

    await waitFor(() => expect(result.current.price("ubze")?.toString()).toBe("0.0006"));
  });

  it("loads logos for each asset and exposes them via logo()", async () => {
    GetAssets.mockResolvedValue([asset({})]);
    GetAssetLogo.mockResolvedValue("data:image/png;base64,LOGO");
    const { result } = renderHook(() => useAssets("bze1addr", "public"));

    await waitFor(() => expect(result.current.logo("ubze")).toBe("data:image/png;base64,LOGO"));
    expect(GetAssetLogo).toHaveBeenCalledWith("ubze");
  });

  it("surfaces a load error without throwing", async () => {
    GetAssets.mockRejectedValue(new Error("engine not initialized"));
    const { result } = renderHook(() => useAssets("bze1addr", "public"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toContain("engine not initialized");
    expect(result.current.assets).toHaveLength(0);
  });
});
