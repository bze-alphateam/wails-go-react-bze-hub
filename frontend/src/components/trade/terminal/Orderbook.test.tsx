import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithChakra } from "../../../test/render";
import { Orderbook } from "./Orderbook";
import type { ResolveAsset } from "./marketHelpers";

// Capture the market-event handlers the component registers so the test can fire
// a chain:orderbook event directly.
let marketHandlers: { onOrderbook?: () => void; onTrade?: () => void } = {};

const { GetOrderbook } = vi.hoisted(() => ({ GetOrderbook: vi.fn() }));

vi.mock("../../../../wailsjs/go/main/App", () => ({
  GetOrderbook: (...args: unknown[]) => GetOrderbook(...args),
}));
vi.mock("../../../hooks/useMarketEvents", () => ({
  useMarketEvents: (_marketId: string, handlers: typeof marketHandlers) => {
    marketHandlers = handlers;
  },
}));

const resolve: ResolveAsset = (denom) => ({
  symbol: denom.slice(1).toUpperCase(),
  decimals: 0,
  verified: true,
});

const book = {
  marketId: "ubze/uusdc",
  buy: [{ price: "9", amount: "100" }],
  sell: [{ price: "11", amount: "50" }],
};

beforeEach(() => {
  marketHandlers = {};
  GetOrderbook.mockReset();
  GetOrderbook.mockResolvedValue(book);
});

function render(onPriceSelect = vi.fn()) {
  renderWithChakra(
    <Orderbook marketId="ubze/uusdc" base="ubze" quote="uusdc" resolve={resolve} onPriceSelect={onPriceSelect} />,
  );
  return onPriceSelect;
}

describe("Orderbook", () => {
  it("renders both sides with prices", async () => {
    render();
    expect(await screen.findByLabelText("Select price 11")).toBeInTheDocument();
    expect(screen.getByLabelText("Select price 9")).toBeInTheDocument();
    expect(screen.getByText("Spread")).toBeInTheDocument();
  });

  it("clicking a level reports its price via onPriceSelect", async () => {
    const onPriceSelect = render();
    const askRow = await screen.findByLabelText("Select price 11");
    fireEvent.click(askRow);
    expect(onPriceSelect).toHaveBeenCalledWith("11");
  });

  it("refreshes on a chain:orderbook event for this market", async () => {
    render();
    await screen.findByLabelText("Select price 11");
    expect(GetOrderbook).toHaveBeenCalledTimes(1);

    // Fire the market's orderbook event → the book reloads.
    await act(async () => {
      marketHandlers.onOrderbook?.();
    });
    await waitFor(() => expect(GetOrderbook).toHaveBeenCalledTimes(2));
  });

  it("shows an empty state when there are no orders", async () => {
    GetOrderbook.mockResolvedValue({ marketId: "ubze/uusdc", buy: [], sell: [] });
    render();
    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
  });
});
