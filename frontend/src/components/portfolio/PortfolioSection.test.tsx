import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import BigNumber from "bignumber.js";
import { renderWithChakra } from "../../test/render";
import type { AssetBalance } from "../../hooks/useAssets";

// Mock the shared assets context so the section renders off a controlled asset
// set, and the event hook so we can capture and fire its onMatchingTx handler.
const useAssetsMock = vi.fn();
const chainHandlers: { onMatchingTx?: (h: string) => void } = {};

vi.mock("../../context/AssetsContext", () => ({
  useSharedAssets: (...args: unknown[]) => useAssetsMock(...args),
}));
vi.mock("../../hooks/useChainEvents", () => ({
  useChainEvents: (_address: string, handlers: { onMatchingTx?: (h: string) => void }) => {
    chainHandlers.onMatchingTx = handlers.onMatchingTx;
  },
}));
// Stub the shared staking context — the detail view only reads it for the native
// token, and these tests don't exercise the staked breakdown (AssetDetail owns that).
vi.mock("../../context/StakingContext", () => ({
  useSharedStaking: () => ({ data: null, isLoading: false, error: null, reload: vi.fn() }),
}));

import { PortfolioSection } from "./PortfolioSection";

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

const PRICES: Record<string, string> = { ubze: "0.0005", uvdl: "0.01" };

function usdValue(denom: string, uAmount: string): BigNumber | null {
  const p = PRICES[denom];
  if (!p) return null;
  return new BigNumber(p).multipliedBy(new BigNumber(uAmount).shiftedBy(-6));
}

const reload = vi.fn();

function mockAssets(assets: AssetBalance[], over: Record<string, unknown> = {}) {
  useAssetsMock.mockReturnValue({
    assets,
    isLoading: false,
    error: null,
    reload,
    resolve: (d: string) => assets.find((a) => a.denom === d),
    price: (d: string) => (PRICES[d] ? new BigNumber(PRICES[d]) : null),
    logo: () => "",
    usdValue,
    ...over,
  });
}

const held = [
  asset({ denom: "ubze", symbol: "BZE", name: "BeeZee", type: "native", amount: "1000000" }), // $0.0005
  asset({ denom: "uvdl", symbol: "VDL", name: "Vidulum", type: "factory", verified: false, amount: "5000000" }), // $0.05
  asset({ denom: "uabc", symbol: "ABC", name: "Abc Token", type: "factory", verified: false, amount: "0", price: "" }), // zero balance, no price
];

beforeEach(() => {
  useAssetsMock.mockReset();
  reload.mockReset();
  delete chainHandlers.onMatchingTx;
});

describe("PortfolioSection", () => {
  it("prompts to connect when there is no active address", () => {
    mockAssets([]);
    renderWithChakra(<PortfolioSection address="" />);
    expect(screen.getByText(/connect a wallet/i)).toBeInTheDocument();
  });

  it("shows the total portfolio value as the sum of per-asset USD values", () => {
    mockAssets(held);
    renderWithChakra(<PortfolioSection address="bze1addr" />);
    // 0.05 (VDL) + 0.0005 (BZE) = 0.0505
    expect(screen.getByText("$0.0505")).toBeInTheDocument();
  });

  it("lists holdings only by default, sorted by USD value desc", () => {
    mockAssets(held);
    renderWithChakra(<PortfolioSection address="bze1addr" />);

    // Zero-balance ABC is hidden; BZE and VDL shown.
    expect(screen.queryByText("ABC")).not.toBeInTheDocument();
    const symbols = screen.getAllByText(/^(BZE|VDL)$/).map((n) => n.textContent);
    expect(symbols).toEqual(["VDL", "BZE"]); // VDL ($0.05) before BZE ($0.0005)
  });

  it("renders type and verified badges, and hides USD when there is no price", () => {
    mockAssets([
      asset({ denom: "ubze", symbol: "BZE", type: "native", verified: true, amount: "1000000" }), // 1 BZE → $0.0005
      asset({ denom: "uvdl", symbol: "VDL", name: "Vidulum", type: "factory", verified: false, amount: "5000000" }), // 5 VDL → $0.05
      asset({ denom: "unop", symbol: "NOP", name: "No Price", type: "ibc", verified: false, amount: "3000000", price: "" }), // no price
    ]);
    renderWithChakra(<PortfolioSection address="bze1addr" />);

    expect(screen.getByText("Native")).toBeInTheDocument();
    expect(screen.getByText("IBC")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();

    // Priced rows and the total each render a "$" figure; the unpriced NOP row
    // renders none — so exactly three dollar figures: total + VDL + BZE.
    expect(screen.getByText("$0.0505")).toBeInTheDocument(); // total (0.05 + 0.0005)
    expect(screen.getByText("$0.05")).toBeInTheDocument(); // VDL row
    expect(screen.getByText("$0.0005")).toBeInTheDocument(); // BZE row
    expect(screen.getAllByText(/^\$/)).toHaveLength(3);
  });

  it("filters by the search box", () => {
    mockAssets(held);
    renderWithChakra(<PortfolioSection address="bze1addr" />);

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "vidul" } });
    expect(screen.getByText("VDL")).toBeInTheDocument();
    expect(screen.queryByText("BZE")).not.toBeInTheDocument();
  });

  it("reveals zero-balance known assets via the Show all toggle", () => {
    mockAssets(held);
    renderWithChakra(<PortfolioSection address="bze1addr" />);

    expect(screen.queryByText("ABC")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    expect(screen.getByText("ABC")).toBeInTheDocument();
  });

  it("opens the asset detail when a row is selected", () => {
    mockAssets(held);
    renderWithChakra(<PortfolioSection address="bze1addr" />);

    // The detail's copyable denom isn't shown until a row is clicked.
    expect(screen.queryByText("uvdl")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("VDL"));
    // Detail dialog now shows the denom and a Send action for that asset.
    expect(screen.getByText("uvdl")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("refreshes on a matching chain tx without manual action", () => {
    mockAssets(held);
    renderWithChakra(<PortfolioSection address="bze1addr" />);

    expect(chainHandlers.onMatchingTx).toBeTypeOf("function");
    chainHandlers.onMatchingTx?.("12345");
    expect(reload).toHaveBeenCalled();
  });
});
