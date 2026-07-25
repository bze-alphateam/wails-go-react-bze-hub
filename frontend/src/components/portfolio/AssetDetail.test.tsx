import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import BigNumber from "bignumber.js";
import { renderWithChakra } from "../../test/render";
import type { AssetBalance } from "../../hooks/useAssets";
import { AssetDetail } from "./AssetDetail";

function asset(over: Partial<AssetBalance>): AssetBalance {
  return {
    denom: "ubze",
    symbol: "BZE",
    name: "BeeZee",
    decimals: 6,
    type: "native",
    verified: true,
    stable: false,
    supply: "1000000000000",
    amount: "2000000",
    price: "0.0005",
    ...over,
  };
}

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("AssetDetail", () => {
  it("renders nothing when there is no selected asset", () => {
    renderWithChakra(
      <AssetDetail asset={null} isOpen onClose={() => {}} logo="" price={null} onSend={() => {}} />
    );
    expect(screen.queryByText(/denom/i)).not.toBeInTheDocument();
  });

  it("shows identity, type/verified badges and a copyable denom", async () => {
    renderWithChakra(
      <AssetDetail
        asset={asset({})}
        isOpen
        onClose={() => {}}
        logo=""
        price={new BigNumber("0.0005")}
        onSend={() => {}}
      />
    );

    expect(screen.getByText("BZE")).toBeInTheDocument();
    expect(screen.getByText("BeeZee")).toBeInTheDocument();
    expect(screen.getByText("Native")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("ubze")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /copy denom/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("ubze");
    await waitFor(() =>
      expect(screen.getByText("$0.0005")).toBeInTheDocument()
    );
  });

  it("renders the available/staked/total breakdown for the native token", () => {
    renderWithChakra(
      <AssetDetail
        asset={asset({ amount: "2000000" })}
        isOpen
        onClose={() => {}}
        logo=""
        price={new BigNumber("0.0005")}
        stakedUAmount="3000000"
        onSend={() => {}}
      />
    );

    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("Staked")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("2 BZE")).toBeInTheDocument(); // available
    expect(screen.getByText("3 BZE")).toBeInTheDocument(); // staked
    expect(screen.getByText("5 BZE")).toBeInTheDocument(); // total
  });

  it("shows only Available (no staked/total) when no staked amount is provided", () => {
    renderWithChakra(
      <AssetDetail
        asset={asset({ denom: "uvdl", symbol: "VDL", name: "Vidulum", type: "factory", amount: "5000000" })}
        isOpen
        onClose={() => {}}
        logo=""
        price={null}
        stakedUAmount={null}
        onSend={() => {}}
      />
    );

    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.queryByText("Staked")).not.toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
  });

  it("shows on-chain supply for factory tokens", () => {
    renderWithChakra(
      <AssetDetail
        asset={asset({ denom: "uvdl", symbol: "VDL", name: "Vidulum", type: "factory", decimals: 6, supply: "1000000000000" })}
        isOpen
        onClose={() => {}}
        logo=""
        price={null}
        onSend={() => {}}
      />
    );
    // 1_000_000_000_000 / 10^6 = 1,000,000 VDL
    expect(screen.getByText("Supply")).toBeInTheDocument();
    expect(screen.getByText("1,000,000 VDL")).toBeInTheDocument();
  });

  it("does not show supply for non-factory tokens", () => {
    renderWithChakra(
      <AssetDetail asset={asset({ type: "native" })} isOpen onClose={() => {}} logo="" price={null} onSend={() => {}} />
    );
    expect(screen.queryByText("Supply")).not.toBeInTheDocument();
  });

  it("hides price when unknown (never $0)", () => {
    renderWithChakra(
      <AssetDetail
        asset={asset({ denom: "unop", symbol: "NOP", name: "No Price", type: "ibc", price: "" })}
        isOpen
        onClose={() => {}}
        logo=""
        price={null}
        onSend={() => {}}
      />
    );
    expect(screen.queryByText("Price")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("does not render a Trade action while no onTrade handler is wired (M2)", () => {
    renderWithChakra(
      <AssetDetail asset={asset({})} isOpen onClose={() => {}} logo="" price={null} onSend={() => {}} />
    );
    expect(screen.queryByRole("button", { name: /trade/i })).not.toBeInTheDocument();
  });

  it("renders the Trade action once onTrade is wired, invoking it with the denom", () => {
    const onTrade = vi.fn();
    renderWithChakra(
      <AssetDetail asset={asset({})} isOpen onClose={() => {}} logo="" price={null} onSend={() => {}} onTrade={onTrade} />
    );
    fireEvent.click(screen.getByRole("button", { name: /trade/i }));
    expect(onTrade).toHaveBeenCalledWith("ubze");
  });

  it("invokes the send entry point with the asset denom", () => {
    const onSend = vi.fn();
    renderWithChakra(
      <AssetDetail asset={asset({ denom: "uvdl" })} isOpen onClose={() => {}} logo="" price={null} onSend={onSend} />
    );
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith("uvdl");
  });
});
