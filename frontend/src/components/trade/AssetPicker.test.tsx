import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithChakra } from "../../test/render";
import type { AssetBalance } from "../../hooks/useAssets";
import { AssetPicker } from "./AssetPicker";

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
    amount: "0",
    price: "",
    ...over,
  };
}

const ASSETS = [
  asset({ denom: "ubze", symbol: "BZE", name: "BeeZee", amount: "2000000" }),
  asset({ denom: "uvdl", symbol: "VDL", name: "Vidulum", amount: "0" }),
  asset({ denom: "uxyz", symbol: "XYZ", name: "Example Coin", amount: "0" }),
];

function renderPicker(over: Partial<React.ComponentProps<typeof AssetPicker>> = {}) {
  const onSelect = vi.fn();
  renderWithChakra(
    <AssetPicker
      label="You pay"
      assets={ASSETS}
      selected={ASSETS[0]}
      logo={() => ""}
      onSelect={onSelect}
      {...over}
    />,
  );
  return { onSelect };
}

describe("AssetPicker", () => {
  it("shows the selected token and its balance on the trigger", () => {
    renderPicker();
    const trigger = screen.getByRole("button", { name: /You pay/i });
    expect(within(trigger).getByText("BZE")).toBeInTheDocument();
    expect(within(trigger).getByText(/Balance: 2/)).toBeInTheDocument();
  });

  it("opens the list and filters by symbol or name", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /You pay/i }));

    // All three options are listed initially.
    expect(screen.getAllByRole("option")).toHaveLength(3);

    const search = screen.getByLabelText("Search tokens");
    fireEvent.change(search, { target: { value: "vid" } });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(within(options[0]).getByText("VDL")).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /You pay/i }));
    fireEvent.change(screen.getByLabelText("Search tokens"), {
      target: { value: "zzz-nomatch" },
    });
    expect(screen.getByText("No tokens found")).toBeInTheDocument();
  });

  it("calls onSelect with the chosen token", () => {
    const { onSelect } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /You pay/i }));
    fireEvent.click(screen.getByRole("option", { name: /XYZ/ }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ denom: "uxyz" }),
    );
  });
});
