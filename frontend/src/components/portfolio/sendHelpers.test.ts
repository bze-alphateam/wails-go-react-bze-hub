import { describe, it, expect } from "vitest";
import {
  validateRecipient,
  maxSendableUAmount,
  validateSendAmount,
} from "./sendHelpers";

const ADDR_A = "bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk";
const ADDR_B = "bze1972aqfzdg29ugjln74edx0xvcg4ehvysjptk77";

describe("validateRecipient", () => {
  it("accepts a valid address that is not the sender", () => {
    const r = validateRecipient(ADDR_B, ADDR_A);
    expect(r.valid).toBe(true);
    expect(r.selfSend).toBe(false);
    expect(r.error).toBeUndefined();
  });

  it("flags (but still accepts) a self-send", () => {
    const r = validateRecipient(ADDR_A, ADDR_A);
    expect(r.valid).toBe(true);
    expect(r.selfSend).toBe(true);
  });

  it("returns invalid with no error for empty input (pristine field)", () => {
    const r = validateRecipient("   ", ADDR_A);
    expect(r.valid).toBe(false);
    expect(r.error).toBeUndefined();
  });

  it("rejects a malformed address with a clear message", () => {
    const r = validateRecipient("bze1nope", ADDR_A);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/valid bze/i);
  });
});

describe("maxSendableUAmount", () => {
  it("subtracts the fee when sending the fee denom", () => {
    // 1000 BZE spendable, 2400 ubze fee → 999997600 ubze sendable.
    expect(maxSendableUAmount("1000000000", true, "2400").toFixed()).toBe("999997600");
  });

  it("returns the full balance when sending a non-fee denom", () => {
    expect(maxSendableUAmount("5000000", false, "2400").toFixed()).toBe("5000000");
  });

  it("floors at zero when the fee exceeds the balance", () => {
    expect(maxSendableUAmount("1000", true, "2400").toFixed()).toBe("0");
  });
});

describe("validateSendAmount", () => {
  const bze = {
    denom: "ubze",
    decimals: 6,
    symbol: "BZE",
    spendableU: "1000000000", // 1000 BZE
    feeUbze: "2400",
    feeSpendableU: "1000000000",
  };

  it("accepts an amount within (spendable − fee)", () => {
    const r = validateSendAmount({ ...bze, amount: "500" });
    expect(r.valid).toBe(true);
    expect(r.uAmount).toBe("500000000");
  });

  it("blocks an amount over the spendable balance", () => {
    const r = validateSendAmount({ ...bze, amount: "2000" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/exceeds your spendable balance/i);
  });

  it("blocks an amount that ignores the fee (fee denom)", () => {
    // Exactly the full balance leaves nothing for the fee.
    const r = validateSendAmount({ ...bze, amount: "1000" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/network fee/i);
  });

  it("requires an amount", () => {
    expect(validateSendAmount({ ...bze, amount: "" }).error).toMatch(/enter an amount/i);
    expect(validateSendAmount({ ...bze, amount: "0" }).error).toMatch(/greater than zero/i);
    expect(validateSendAmount({ ...bze, amount: "-5" }).error).toMatch(/greater than zero/i);
  });

  describe("non-fee denom (factory token, fee paid in ubze)", () => {
    const factory = {
      denom: "factory/bze1xyz/mytoken",
      decimals: 6,
      symbol: "MYTOKEN",
      spendableU: "5000000", // 5 MYTOKEN
      feeUbze: "2400",
    };

    it("accepts the full token balance when enough ubze covers the fee", () => {
      const r = validateSendAmount({ ...factory, amount: "5", feeSpendableU: "1000000" });
      expect(r.valid).toBe(true);
      expect(r.uAmount).toBe("5000000");
    });

    it("blocks when the wallet cannot cover the ubze fee", () => {
      const r = validateSendAmount({ ...factory, amount: "1", feeSpendableU: "0" });
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/not enough bze/i);
    });
  });
});
