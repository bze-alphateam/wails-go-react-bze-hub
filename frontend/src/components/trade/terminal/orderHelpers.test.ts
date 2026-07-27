import { describe, it, expect } from "vitest";
import { tradebin } from "../../../../wailsjs/go/models";
import {
  totalFromPriceAmount,
  amountFromPriceTotal,
  shortcutBaseAmount,
  summarizeOrder,
  buildCancelMsg,
  TYPE_CANCEL_ORDER,
  type ShortcutParams,
} from "./orderHelpers";

describe("price/amount/total math", () => {
  it("total = price × amount", () => {
    expect(totalFromPriceAmount("10", "5")).toBe("50");
    expect(totalFromPriceAmount("1.5", "2")).toBe("3");
  });
  it("amount = total ÷ price", () => {
    expect(amountFromPriceTotal("10", "50")).toBe("5");
  });
  it("returns empty when inputs are missing or price is zero", () => {
    expect(totalFromPriceAmount("", "5")).toBe("");
    expect(amountFromPriceTotal("0", "50")).toBe("");
    expect(amountFromPriceTotal("10", "")).toBe("");
  });
});

const baseParams: ShortcutParams = {
  fraction: 0.5,
  isBuy: false,
  price: "10",
  base: "uatom",
  quote: "uusdc",
  baseDecimals: 0,
  quoteDecimals: 0,
  spendableBaseU: "1000",
  spendableQuoteU: "1000",
  feeUbze: "100",
};

describe("shortcutBaseAmount", () => {
  it("sell uses a fraction of the base balance", () => {
    expect(shortcutBaseAmount({ ...baseParams, fraction: 0.5 })).toBe("500");
  });
  it("sell Max is fee-aware only for the fee denom", () => {
    // base is the fee denom → fee subtracted
    expect(shortcutBaseAmount({ ...baseParams, base: "ubze", fraction: 1 })).toBe("900");
    // base is not the fee denom → no fee subtracted
    expect(shortcutBaseAmount({ ...baseParams, base: "uatom", fraction: 1 })).toBe("1000");
  });
  it("buy converts a fraction of the quote balance by price", () => {
    expect(shortcutBaseAmount({ ...baseParams, isBuy: true, fraction: 0.5, price: "10" })).toBe("50");
  });
  it("buy Max is fee-aware for the fee quote denom", () => {
    expect(
      shortcutBaseAmount({ ...baseParams, isBuy: true, quote: "ubze", fraction: 1, price: "10" }),
    ).toBe("90");
  });
  it("buy returns empty without a price", () => {
    expect(shortcutBaseAmount({ ...baseParams, isBuy: true, price: "", fraction: 0.5 })).toBe("");
  });
});

describe("summarizeOrder", () => {
  const msg = (amount: string, price: string) => ({ amount, price, "@type": "x" });

  it("no crossing → pure limit order (0 fills)", () => {
    const s = summarizeOrder([msg("1000", "9")], "9");
    expect(s).toEqual({ fillLevels: 0, hasLeftover: true, leftoverUAmount: "1000", totalUAmount: "1000" });
  });
  it("partial fill with leftover", () => {
    const s = summarizeOrder([msg("100", "10"), msg("200", "11"), msg("200", "11.5")], "11.5");
    expect(s).toEqual({ fillLevels: 2, hasLeftover: true, leftoverUAmount: "200", totalUAmount: "500" });
  });
  it("full fill, no leftover", () => {
    const s = summarizeOrder([msg("100", "10"), msg("200", "11")], "11.5");
    expect(s).toEqual({ fillLevels: 2, hasLeftover: false, leftoverUAmount: "0", totalUAmount: "300" });
  });
  it("empty message list", () => {
    expect(summarizeOrder([], "11.5")).toEqual({
      fillLevels: 0,
      hasLeftover: false,
      leftoverUAmount: "0",
      totalUAmount: "0",
    });
  });
});

describe("buildCancelMsg", () => {
  it("produces the tradebin MsgCancelOrder shape", () => {
    const order = {
      id: "5",
      marketId: "ubze/uusdc",
      orderType: "buy",
      amount: "100",
      price: "9.5",
      createdAt: 0,
      owner: "bze1a",
    } as tradebin.Order;
    expect(buildCancelMsg("bze1a", order)).toEqual({
      "@type": TYPE_CANCEL_ORDER,
      creator: "bze1a",
      market_id: "ubze/uusdc",
      order_id: "5",
      order_type: "buy",
    });
  });
});
