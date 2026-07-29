import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithChakra } from "../../../test/render";
import { MarketList } from "./MarketList";
import type { ResolveAsset } from "./marketHelpers";

const { useMarkets } = vi.hoisted(() => ({ useMarkets: vi.fn() }));
vi.mock("../../../hooks/useMarkets", () => ({ useMarkets }));

const resolve: ResolveAsset = (denom) => ({
  symbol: denom.slice(1).toUpperCase(),
  decimals: 0,
  verified: denom === "ubze" || denom === "uusdc",
});
const logo = () => "";

const markets = [
  { marketId: "ubze/uusdc", base: "ubze", quote: "uusdc", creator: "", statsAvailable: true, stats: { quoteVolume: "1000", change: "5", lastPrice: "1.5" } },
  { marketId: "uatom/ubze", base: "uatom", quote: "ubze", creator: "", statsAvailable: true, stats: { quoteVolume: "5000", change: "-2", lastPrice: "10" } },
];

beforeEach(() => {
  useMarkets.mockReturnValue({ markets, isLoading: false, error: null, reload: vi.fn() });
});

describe("MarketList", () => {
  it("renders a row per market with the verified badge for verified pairs", () => {
    renderWithChakra(<MarketList resolve={resolve} logo={logo} onSelect={vi.fn()} />);
    expect(screen.getByText("BZE/USDC")).toBeInTheDocument();
    expect(screen.getByText("ATOM/BZE")).toBeInTheDocument();
    // Only the ubze/uusdc pair is fully verified.
    expect(screen.getAllByText("Verified")).toHaveLength(1);
  });

  it("filters by search term", () => {
    renderWithChakra(<MarketList resolve={resolve} logo={logo} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search markets"), { target: { value: "atom" } });
    expect(screen.queryByText("BZE/USDC")).not.toBeInTheDocument();
    expect(screen.getByText("ATOM/BZE")).toBeInTheDocument();
  });

  it("opens a market on click, passing the full market object", () => {
    const onSelect = vi.fn();
    renderWithChakra(<MarketList resolve={resolve} logo={logo} onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText("Open BZE/USDC market"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ marketId: "ubze/uusdc" }));
  });
});
