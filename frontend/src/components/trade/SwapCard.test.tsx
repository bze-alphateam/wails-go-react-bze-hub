import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderWithChakra } from "../../test/render";
import type { AssetBalance } from "../../hooks/useAssets";
import type { amm } from "../../../wailsjs/go/models";

// Mock every data hook so the card renders off a controlled fixture and never
// touches Wails. `useSwapQuote` echoes its inputs into the returned quote so the
// card's "quote matches current inputs" gate is satisfied.
const useAssetsMock = vi.fn();
const useLiquidityPoolsMock = vi.fn();
const swapQuote = vi.fn<[], amm.SwapQuote | null>(() => null);
const swapFn = vi.fn().mockResolvedValue(true);
let blockHandler: ((h: string) => void) | undefined;

vi.mock("../../hooks/useAssets", () => ({
  useAssets: (...args: unknown[]) => useAssetsMock(...args),
}));
vi.mock("../../hooks/useLiquidityPools", () => ({
  useLiquidityPools: (...args: unknown[]) => useLiquidityPoolsMock(...args),
}));
vi.mock("../../hooks/useSwapSlippage", () => ({
  useSwapSlippage: () => ({ slippage: 0.5, setSlippage: vi.fn(), loaded: true }),
}));
vi.mock("../../hooks/useSwapTx", () => ({
  useSwapTx: () => ({ swap: swapFn, isSubmitting: false }),
}));
vi.mock("../../hooks/useChainEvents", () => ({
  useChainEvents: (_addr: string, handlers: { onBlock?: (h: string) => void }) => {
    blockHandler = handlers.onBlock;
  },
}));
vi.mock("../../hooks/useSwapQuote", () => ({
  useSwapQuote: (denomIn: string, denomOut: string, amountInBase: string | null) => {
    const quote = swapQuote();
    return {
      quoted:
        amountInBase && quote
          ? { quote, blockHeight: "100", amountIn: amountInBase, denomIn, denomOut }
          : null,
      isQuoting: false,
      error: null,
    };
  },
}));

import { SwapCard } from "./SwapCard";

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
    amount: "1000000000",
    price: "",
    ...over,
  };
}

const ASSETS = [
  asset({ denom: "ubze", symbol: "BZE", name: "BeeZee" }),
  asset({ denom: "uvdl", symbol: "VDL", name: "Vidulum" }),
];

function mockAssets(assets = ASSETS) {
  useAssetsMock.mockReturnValue({
    assets,
    isLoading: false,
    error: null,
    reload: vi.fn(),
    resolve: (d: string) => assets.find((a) => a.denom === d),
    price: () => null,
    logo: () => "",
    usdValue: () => null,
  });
}

function mockPools(pools: Array<{ base: string; quote: string }>) {
  useLiquidityPoolsMock.mockReturnValue({ pools, isLoading: false, error: null, reload: vi.fn() });
}

const ROUTABLE_QUOTE = {
  noRoute: false,
  routes: ["1"],
  path: ["ubze", "uvdl"],
  expectedOut: "2500000",
  priceImpact: "1.5",
  totalFees: "5000",
  feesPerHop: ["3000"],
} as unknown as amm.SwapQuote;

const NO_ROUTE_QUOTE = { noRoute: true } as unknown as amm.SwapQuote;

function typeAmount(value: string) {
  fireEvent.change(screen.getByLabelText("Amount to swap"), { target: { value } });
}

beforeEach(() => {
  useAssetsMock.mockReset();
  useLiquidityPoolsMock.mockReset();
  swapQuote.mockReset();
  swapQuote.mockReturnValue(null);
  swapFn.mockClear();
  blockHandler = undefined;
  mockAssets();
  mockPools([{ base: "ubze", quote: "uvdl" }]);
});

describe("SwapCard", () => {
  it("renders both pickers and a disabled Review button until an amount is entered", () => {
    renderWithChakra(<SwapCard address="bze1abc" proxyTarget="public" />);
    expect(screen.getByRole("button", { name: /You pay/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /You receive/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review swap" })).toBeDisabled();
  });

  it("prompts to connect a wallet when there is no address", () => {
    renderWithChakra(<SwapCard address="" proxyTarget="public" />);
    expect(screen.getByText(/connect a wallet/i)).toBeInTheDocument();
  });

  it("shows the expected output, price impact, total fee and route for a quote", () => {
    swapQuote.mockReturnValue(ROUTABLE_QUOTE);
    renderWithChakra(<SwapCard address="bze1abc" proxyTarget="public" />);
    typeAmount("1");
    expect(screen.getByText("Expected output")).toBeInTheDocument();
    expect(screen.getByText(/2\.5 VDL/)).toBeInTheDocument();
    expect(screen.getByText("1.50%")).toBeInTheDocument();
    expect(screen.getByText(/Route \(1 hop\)/)).toBeInTheDocument();
  });

  it("renders an insufficient-liquidity message when pools connect but no route fills", () => {
    swapQuote.mockReturnValue(NO_ROUTE_QUOTE);
    mockPools([{ base: "ubze", quote: "uvdl" }]);
    renderWithChakra(<SwapCard address="bze1abc" proxyTarget="public" />);
    typeAmount("1");
    expect(screen.getByText(/not enough liquidity/i)).toBeInTheDocument();
  });

  it("reviews then executes a routable swap", () => {
    swapQuote.mockReturnValue(ROUTABLE_QUOTE);
    renderWithChakra(<SwapCard address="bze1abc" proxyTarget="public" />);
    typeAmount("1");

    fireEvent.click(screen.getByRole("button", { name: "Review swap" }));
    expect(screen.getByText(/Minimum received/)).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: "Confirm swap" });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    expect(swapFn).toHaveBeenCalledWith(
      expect.objectContaining({ denomIn: "ubze", denomOut: "uvdl", slippage: 0.5 }),
    );
  });

  it("blocks execution once a newer block makes the quote stale", () => {
    swapQuote.mockReturnValue(ROUTABLE_QUOTE);
    renderWithChakra(<SwapCard address="bze1abc" proxyTarget="public" />);
    typeAmount("1");
    fireEvent.click(screen.getByRole("button", { name: "Review swap" }));

    // Quote was computed at height 100; a new block (101) arrives → stale.
    act(() => blockHandler?.("101"));

    expect(screen.getByText(/newer block arrived/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm swap" })).toBeDisabled();
    expect(swapFn).not.toHaveBeenCalled();
  });

  it("requires acknowledging a high price impact before executing", () => {
    swapQuote.mockReturnValue({ ...ROUTABLE_QUOTE, priceImpact: "8" } as amm.SwapQuote);
    renderWithChakra(<SwapCard address="bze1abc" proxyTarget="public" />);
    typeAmount("1");
    fireEvent.click(screen.getByRole("button", { name: "Review swap" }));

    const confirm = screen.getByRole("button", { name: "Confirm swap" });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Acknowledge price impact"));
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    expect(swapFn).toHaveBeenCalled();
  });

  it("prompts for an amount before anything is typed", () => {
    swapQuote.mockReturnValue(ROUTABLE_QUOTE);
    renderWithChakra(<SwapCard address="bze1abc" proxyTarget="public" />);
    expect(screen.getByText(/enter an amount/i)).toBeInTheDocument();
  });
});
