import { describe, it, expect } from "vitest";
import {
  uAmountToHuman,
  humanToUAmount,
  formatAmount,
  shortNumberFormat,
  formatUAmount,
} from "./format";

describe("uAmountToHuman", () => {
  it("converts with 6 decimals and trims trailing zeros", () => {
    expect(uAmountToHuman("1000000", 6)).toBe("1");
    expect(uAmountToHuman("1500000", 6)).toBe("1.5");
    expect(uAmountToHuman("164006001296", 6)).toBe("164006.001296");
  });

  it("respects arbitrary decimals", () => {
    expect(uAmountToHuman("123", 0)).toBe("123");
    expect(uAmountToHuman("123456789012", 12)).toBe("0.123456789012");
    expect(uAmountToHuman("100", 2)).toBe("1");
  });

  it("handles zero, bigint, and junk input", () => {
    expect(uAmountToHuman("0", 6)).toBe("0");
    expect(uAmountToHuman(1000000n, 6)).toBe("1");
    expect(uAmountToHuman("not-a-number", 6)).toBe("0");
  });

  it("ignores a fractional part of base units", () => {
    expect(uAmountToHuman("1500000.99", 6)).toBe("1.5");
  });
});

describe("humanToUAmount", () => {
  it("converts and truncates excess fraction digits", () => {
    expect(humanToUAmount("1", 6)).toBe("1000000");
    expect(humanToUAmount("1.5", 6)).toBe("1500000");
    expect(humanToUAmount("1.1234567", 6)).toBe("1123456"); // truncated, not rounded
  });

  it("strips commas and handles empty", () => {
    expect(humanToUAmount("1,000", 6)).toBe("1000000000");
    expect(humanToUAmount("", 6)).toBe("0");
  });

  it("round-trips with uAmountToHuman", () => {
    const base = "164006001296";
    expect(humanToUAmount(uAmountToHuman(base, 6), 6)).toBe(base);
  });
});

describe("formatAmount", () => {
  it("groups thousands and caps fraction digits", () => {
    expect(formatAmount("164006.001296")).toBe("164,006.001296");
    expect(formatAmount("164006.001296", { maxDecimals: 2 })).toBe("164,006");
    expect(formatAmount("1234.5", { maxDecimals: 2 })).toBe("1,234.5");
  });

  it("handles junk", () => {
    expect(formatAmount("nope")).toBe("0");
  });
});

describe("shortNumberFormat", () => {
  it("abbreviates large numbers", () => {
    expect(shortNumberFormat(1_234_567)).toBe("1.23M");
    expect(shortNumberFormat(1_200)).toBe("1.2K");
    expect(shortNumberFormat(2_000_000_000)).toBe("2B");
  });

  it("shows small numbers in full", () => {
    expect(shortNumberFormat(0)).toBe("0");
    expect(shortNumberFormat(42.5)).toBe("42.5");
  });
});

describe("formatUAmount", () => {
  it("combines conversion and formatting", () => {
    expect(formatUAmount("164006001296", 6)).toBe("164,006.001296");
    expect(formatUAmount("164006001296", 6, { maxDecimals: 2 })).toBe("164,006");
  });
});
