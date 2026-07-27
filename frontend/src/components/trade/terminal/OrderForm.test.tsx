import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithChakra } from "../../../test/render";
import { OrderForm } from "./OrderForm";
import type { ResolveAsset } from "./marketHelpers";

const { buildOrder, placeOrder, ValidateOrderInput, EstimateTxFee, GetSpendableBalances } = vi.hoisted(
  () => ({
    buildOrder: vi.fn(),
    placeOrder: vi.fn(),
    ValidateOrderInput: vi.fn(),
    EstimateTxFee: vi.fn(),
    GetSpendableBalances: vi.fn(),
  }),
);

vi.mock("../../../hooks/useOrderTx", () => ({
  useOrderTx: () => ({ buildOrder, placeOrder, cancelOrders: vi.fn(), isSubmitting: false }),
}));
vi.mock("../../../../wailsjs/go/main/App", () => ({
  ValidateOrderInput,
  EstimateTxFee,
  GetSpendableBalances,
}));

const resolve: ResolveAsset = (denom) => ({
  symbol: denom.slice(1).toUpperCase(),
  decimals: 0,
  verified: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  EstimateTxFee.mockResolvedValue({ amount: "1000" });
  GetSpendableBalances.mockResolvedValue({});
  ValidateOrderInput.mockResolvedValue(undefined);
  buildOrder.mockResolvedValue([{ "@type": "/bze.tradebin.MsgCreateOrder", amount: "5", price: "10" }]);
  placeOrder.mockResolvedValue(true);
});

function render() {
  renderWithChakra(
    <OrderForm
      marketId="ubze/uusdc"
      base="ubze"
      quote="uusdc"
      address="bze1a"
      resolve={resolve}
      selectedPrice={null}
    />,
  );
}

function enterOrder(price: string, amount: string) {
  fireEvent.change(screen.getByLabelText("Order price"), { target: { value: price } });
  fireEvent.change(screen.getByLabelText("Order amount"), { target: { value: amount } });
}

describe("OrderForm", () => {
  it("blocks submit while ValidateOrderInput rejects the input", async () => {
    ValidateOrderInput.mockRejectedValue("amount is below the market minimum for this price");
    render();
    enterOrder("10", "1");

    expect(await screen.findByText(/below the market minimum/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buy BZE" })).toBeDisabled();
  });

  it("prefills price from an orderbook selection", async () => {
    renderWithChakra(
      <OrderForm
        marketId="ubze/uusdc"
        base="ubze"
        quote="uusdc"
        address="bze1a"
        resolve={resolve}
        selectedPrice="12.5"
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Order price")).toHaveValue("12.5"));
  });

  it("reviews and confirms a valid order", async () => {
    render();
    enterOrder("10", "5");

    const submit = screen.getByRole("button", { name: "Buy BZE" });
    await waitFor(() => expect(submit).not.toBeDisabled());

    fireEvent.click(submit);

    // buildOrder is asked for the message list in u-units (amount 5, decimals 0).
    await waitFor(() =>
      expect(buildOrder).toHaveBeenCalledWith("ubze/uusdc", true, "5", expect.any(String)),
    );
    expect(await screen.findByText("Review buy order")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(placeOrder).toHaveBeenCalled());
  });
});
