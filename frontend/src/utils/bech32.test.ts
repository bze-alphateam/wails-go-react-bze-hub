import { describe, it, expect } from "vitest";
import { decodeBech32, isValidBech32 } from "./bech32";

// Real BeeZee (bze1…) account addresses, reused from the Go bank tests.
const ADDR_A = "bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk";
const ADDR_B = "bze1972aqfzdg29ugjln74edx0xvcg4ehvysjptk77";

describe("decodeBech32", () => {
  it("decodes a valid bze address to its prefix and 32 data words", () => {
    const d = decodeBech32(ADDR_A);
    expect(d).not.toBeNull();
    expect(d?.prefix).toBe("bze");
    expect(d?.words).toHaveLength(32); // 20-byte account = 32 five-bit words
  });

  it("rejects a corrupted checksum", () => {
    // Flip the last character — checksum no longer matches.
    const corrupted = ADDR_A.slice(0, -1) + (ADDR_A.endsWith("k") ? "l" : "k");
    expect(decodeBech32(corrupted)).toBeNull();
  });

  it("rejects mixed case, empty, and non-bech32 input", () => {
    expect(decodeBech32("Bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk")).toBeNull();
    expect(decodeBech32("")).toBeNull();
    expect(decodeBech32("not-an-address")).toBeNull();
    expect(decodeBech32("bze1")).toBeNull(); // no data/checksum
  });
});

describe("isValidBech32", () => {
  it("accepts valid bze addresses with the expected prefix", () => {
    expect(isValidBech32(ADDR_A, "bze")).toBe(true);
    expect(isValidBech32(ADDR_B, "bze")).toBe(true);
  });

  it("rejects a valid address under the wrong expected prefix", () => {
    expect(isValidBech32(ADDR_A, "cosmos")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isValidBech32("bze1invalid", "bze")).toBe(false);
    expect(isValidBech32("", "bze")).toBe(false);
  });
});
