import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Hoisted mocks: the Wails bindings and the global notification handle.
const { loading, handle, SignAndBroadcast, GetTxStatus, OpenURL } = vi.hoisted(() => {
  const handle = { update: vi.fn(), success: vi.fn(), error: vi.fn() };
  return {
    handle,
    loading: vi.fn(() => handle),
    SignAndBroadcast: vi.fn(),
    GetTxStatus: vi.fn(),
    OpenURL: vi.fn(),
  };
});

vi.mock("../notifications", () => ({ notify: { loading } }));
vi.mock("../../wailsjs/go/main/App", () => ({ SignAndBroadcast, GetTxStatus, OpenURL }));

import { useTx } from "./useTx";

const ADDR = "bze1address";
const MSG = { "@type": "/cosmos.bank.v1beta1.MsgSend", from_address: ADDR };

beforeEach(() => {
  vi.useFakeTimers();
  loading.mockClear();
  handle.update.mockClear();
  handle.success.mockClear();
  handle.error.mockClear();
  SignAndBroadcast.mockReset();
  GetTxStatus.mockReset();
  OpenURL.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTx", () => {
  it("broadcasts, confirms on-chain, and calls onConfirmed on success", async () => {
    SignAndBroadcast.mockResolvedValue({ tx_response: { code: 0, txhash: "HASH" } });
    GetTxStatus.mockResolvedValue({ found: true, code: 0, rawLog: "" });
    const onConfirmed = vi.fn();

    const { result } = renderHook(() => useTx(ADDR));
    let ret: boolean | undefined;
    await act(async () => {
      ret = await result.current.sendTx({
        msgs: [MSG],
        pending: "Sending…",
        success: "Sent",
        memo: "hi",
        onConfirmed,
      });
    });

    // Accepted into the mempool.
    expect(ret).toBe(true);
    expect(loading).toHaveBeenCalledWith({ title: "Sending…" });
    expect(SignAndBroadcast).toHaveBeenCalledWith(ADDR, JSON.stringify([MSG]), "hi");
    expect(handle.update).toHaveBeenCalledWith({ title: "Confirming transaction…" });

    // Drain the background confirmation polling.
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const successArg = handle.success.mock.calls.at(-1)?.[0];
    expect(successArg?.title).toBe("Sent");
    expect(successArg?.actions).toHaveLength(1); // explorer link
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(handle.error).not.toHaveBeenCalled();
  });

  it("surfaces an on-chain failure and does not call onConfirmed", async () => {
    SignAndBroadcast.mockResolvedValue({ tx_response: { code: 0, txhash: "HASH" } });
    GetTxStatus.mockResolvedValue({ found: true, code: 5, rawLog: "insufficient funds" });
    const onConfirmed = vi.fn();

    const { result } = renderHook(() => useTx(ADDR));
    let ret: boolean | undefined;
    await act(async () => {
      ret = await result.current.sendTx({
        msgs: [MSG],
        pending: "Sending…",
        success: "Sent",
        onConfirmed,
      });
    });
    // Mempool accepted → true, even though it fails on-chain later.
    expect(ret).toBe(true);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(handle.error).toHaveBeenCalledWith({
      title: "Transaction failed",
      description: "insufficient funds",
    });
    expect(handle.success).not.toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("returns false and shows the raw_log when the broadcast is rejected", async () => {
    SignAndBroadcast.mockResolvedValue({ tx_response: { code: 11, raw_log: "out of gas" } });

    const { result } = renderHook(() => useTx(ADDR));
    let ret: boolean | undefined;
    await act(async () => {
      ret = await result.current.sendTx({ msgs: [MSG], pending: "Sending…", success: "Sent" });
    });

    expect(ret).toBe(false);
    expect(handle.error).toHaveBeenCalledWith({
      title: "Transaction failed",
      description: "out of gas",
    });
    expect(GetTxStatus).not.toHaveBeenCalled();
  });

  // The wallet-locked / password-needed path: SignAndBroadcast rejects (the Go
  // side owns the keyring/unlock), and the hook surfaces a human-readable error.
  it("returns false and shows an error when signing/broadcast throws", async () => {
    SignAndBroadcast.mockRejectedValue(new Error("wallet is locked"));

    const { result } = renderHook(() => useTx(ADDR));
    let ret: boolean | undefined;
    await act(async () => {
      ret = await result.current.sendTx({ msgs: [MSG], pending: "Sending…", success: "Sent" });
    });

    expect(ret).toBe(false);
    const errArg = handle.error.mock.calls.at(-1)?.[0];
    expect(errArg?.title).toBe("Transaction failed");
    expect(errArg?.description).toContain("wallet is locked");
  });

  it("is a no-op without an address or without messages", async () => {
    const { result: noAddr } = renderHook(() => useTx(""));
    const { result: withAddr } = renderHook(() => useTx(ADDR));

    let a: boolean | undefined;
    let b: boolean | undefined;
    await act(async () => {
      a = await noAddr.current.sendTx({ msgs: [MSG], pending: "P", success: "S" });
      b = await withAddr.current.sendTx({ msgs: [], pending: "P", success: "S" });
    });

    expect(a).toBe(false);
    expect(b).toBe(false);
    expect(loading).not.toHaveBeenCalled();
    expect(SignAndBroadcast).not.toHaveBeenCalled();
  });
});
