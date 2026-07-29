import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithChakra } from "../../../test/render";
import { PoolManage } from "./PoolManage";

const POOL = {
  id: "ubze/uvdl",
  base: "ubze",
  quote: "uvdl",
  lpDenom: "amm/1",
  creator: "",
  fee: "0.003",
  feeProviders: "1",
  reserveBase: "1000000000", // 1000 BZE (6dp)
  reserveQuote: "2000000000", // 2000 VDL → price 2 VDL per BZE
  stable: false,
};

// A resolver over a tiny asset set; the LP balance starts at 0 (no position).
const ASSETS: Record<string, { symbol: string; decimals: number; amount: string; supply: string }> = {
  ubze: { symbol: "BZE", decimals: 6, amount: "1000000000", supply: "0" },
  uvdl: { symbol: "VDL", decimals: 6, amount: "2000000000", supply: "0" },
  "amm/1": { symbol: "BZE/VDL", decimals: 12, amount: "0", supply: "1000000000000" },
};

const reloadPools = vi.fn();
vi.mock("../../../hooks/useLiquidityPools", () => ({
  useLiquidityPools: () => ({ pools: [POOL], isLoading: false, error: null, reload: reloadPools }),
}));

const { addLiquidity, removeLiquidity } = vi.hoisted(() => ({
  addLiquidity: vi.fn(),
  removeLiquidity: vi.fn(),
}));
vi.mock("../../../hooks/usePoolTx", () => ({
  usePoolTx: () => ({ addLiquidity, removeLiquidity, isSubmitting: false }),
}));

vi.mock("../../../context/AssetsContext", () => ({
  useSharedAssets: () => ({
    resolve: (denom: string) => (ASSETS[denom] ? { denom, ...ASSETS[denom] } : undefined),
    logo: () => "",
    price: () => null,
    usdValue: () => null,
    reload: vi.fn(),
  }),
}));

beforeEach(() => {
  addLiquidity.mockReset();
  addLiquidity.mockResolvedValue(true);
  removeLiquidity.mockReset();
  reloadPools.mockReset();
});

function render() {
  renderWithChakra(
    <PoolManage poolId="ubze/uvdl" proxyTarget="public" address="bze1abc" onBack={vi.fn()} />,
  );
}

describe("PoolManage — add liquidity", () => {
  it("shows a first-position empty state", () => {
    render();
    expect(screen.getByText(/no liquidity in this pool yet/i)).toBeInTheDocument();
  });

  it("auto-computes the opposite amount from the pool ratio", () => {
    render();
    fireEvent.change(screen.getByLabelText("BZE amount"), { target: { value: "10" } });
    // reserveQuote/reserveBase = 2 → 10 BZE ⇒ 20 VDL
    expect((screen.getByLabelText("VDL amount") as HTMLInputElement).value).toBe("20");
    expect(screen.getByText("Expected LP shares")).toBeInTheDocument();
  });

  it("submits raw u-amounts and the expected shares", async () => {
    render();
    fireEvent.change(screen.getByLabelText("BZE amount"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Add liquidity" }));

    expect(addLiquidity).toHaveBeenCalledTimes(1);
    const args = addLiquidity.mock.calls[0][0];
    expect(args.poolId).toBe("ubze/uvdl");
    expect(args.baseAmount).toBe("10000000"); // 10 × 10^6
    expect(args.quoteAmount).toBe("20000000"); // 20 × 10^6
    expect(args.slippage).toBe(0.5);
    // min(10000000/1e9, 20000000/2e9) = 0.01 × 1e12 total shares = 1e10
    expect(args.expectedShares.toString()).toBe("10000000000");
  });
});

describe("PoolManage — remove liquidity", () => {
  it("tells the user there is nothing to remove without a position", () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText(/no LP shares in this pool to remove/i)).toBeInTheDocument();
  });
});
