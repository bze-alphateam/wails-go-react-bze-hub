import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithChakra } from "../../test/render";
import type { AssetBalance } from "../../hooks/useAssets";

// Mock the tx hook so we can assert the confirm → send call path without touching
// the real signing/broadcast pipeline, and the Wails bindings the form calls.
const sendMock = vi.fn();
const { GetSpendableBalances, EstimateTxFee } = vi.hoisted(() => ({
  GetSpendableBalances: vi.fn(),
  EstimateTxFee: vi.fn(),
}));

vi.mock("../../hooks/useSendTx", () => ({
  useSendTx: () => ({ send: sendMock, isSubmitting: false }),
}));
vi.mock("../../../wailsjs/go/main/App", () => ({ GetSpendableBalances, EstimateTxFee }));

import { SendForm } from "./SendForm";

const FROM = "bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk";
const TO = "bze1972aqfzdg29ugjln74edx0xvcg4ehvysjptk77";

function asset(over: Partial<AssetBalance>): AssetBalance {
  return {
    denom: "ubze", symbol: "BZE", name: "BeeZee", decimals: 6, type: "native",
    verified: true, stable: false, supply: "0", amount: "0", price: "", ...over,
  };
}

const ASSETS = [
  asset({ denom: "ubze", symbol: "BZE", type: "native", amount: "1000000000" }),
  asset({ denom: "uvdl", symbol: "VDL", name: "Vidulum", type: "factory", amount: "5000000" }),
];

const onClose = vi.fn();
const onSent = vi.fn();

function renderForm(presetDenom?: string) {
  return renderWithChakra(
    <SendForm
      isOpen
      onClose={onClose}
      address={FROM}
      assets={ASSETS}
      logo={() => ""}
      presetDenom={presetDenom}
      onSent={onSent}
    />
  );
}

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue(true);
  onClose.mockReset();
  onSent.mockReset();
  GetSpendableBalances.mockReset().mockResolvedValue({ ubze: "1000000000", uvdl: "5000000" });
  EstimateTxFee.mockReset().mockResolvedValue({ gas: 120000, amount: "2400", denom: "ubze" });
});

describe("SendForm", () => {
  it("previews the estimated fee from the tx path", async () => {
    renderForm("ubze");
    // 2400 ubze → 0.0024 BZE, formatted from the EstimateTxFee result.
    expect(await screen.findByTestId("send-fee")).toHaveTextContent("0.0024 BZE");
    expect(EstimateTxFee).toHaveBeenCalled();
  });

  it("builds the MsgSend and sends on confirm, then closes", async () => {
    renderForm("ubze");
    await screen.findByTestId("send-fee");

    fireEvent.change(screen.getByTestId("send-recipient"), { target: { value: TO } });
    fireEvent.change(screen.getByTestId("send-amount"), { target: { value: "100" } });

    // Step 1 → review.
    fireEvent.click(screen.getByRole("button", { name: /review/i }));
    expect(await screen.findByText(/confirm transfer/i)).toBeInTheDocument();

    // Step 2 → confirm & send.
    fireEvent.click(screen.getByRole("button", { name: /confirm & send/i }));

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    const arg = sendMock.mock.calls[0][0];
    expect(arg).toMatchObject({
      to: TO,
      denom: "ubze",
      uAmount: "100000000", // 100 BZE in base units
      memo: "",
    });
    expect(arg.onConfirmed).toBe(onSent);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("blocks review for an invalid recipient with a clear message", async () => {
    renderForm("ubze");
    await screen.findByTestId("send-fee");

    fireEvent.change(screen.getByTestId("send-recipient"), { target: { value: "bze1nope" } });
    fireEvent.change(screen.getByTestId("send-amount"), { target: { value: "100" } });

    expect(screen.getByText(/valid bze… address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review/i })).toBeDisabled();
  });

  it("blocks an over-balance amount", async () => {
    renderForm("ubze");
    await screen.findByTestId("send-fee");

    fireEvent.change(screen.getByTestId("send-recipient"), { target: { value: TO } });
    fireEvent.change(screen.getByTestId("send-amount"), { target: { value: "5000" } }); // > 1000 BZE

    expect(screen.getByText(/exceeds your spendable balance/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review/i })).toBeDisabled();
  });

  it("Max fills a fee-aware amount when sending BZE", async () => {
    renderForm("ubze");
    await screen.findByTestId("send-fee");

    fireEvent.click(screen.getByRole("button", { name: /^max$/i }));
    // 1,000,000,000 − 2,400 ubze = 999,997,600 ubze = 999.9976 BZE
    expect(screen.getByTestId("send-amount")).toHaveValue("999.9976");
  });

  it("warns on a self-send but allows bypass", async () => {
    renderForm("ubze");
    await screen.findByTestId("send-fee");

    fireEvent.change(screen.getByTestId("send-recipient"), { target: { value: FROM } });
    fireEvent.change(screen.getByTestId("send-amount"), { target: { value: "100" } });

    // Self-send warning shown; Review gated until acknowledged.
    expect(screen.getByText(/your own address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review/i })).toBeDisabled();

    fireEvent.click(screen.getByText(/send anyway/i));
    expect(screen.getByRole("button", { name: /review/i })).toBeEnabled();
  });
});
