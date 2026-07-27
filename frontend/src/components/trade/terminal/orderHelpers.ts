import BigNumber from "bignumber.js";
import { tradebin } from "../../../../wailsjs/go/models";
import { type ProtoMsg } from "../../../hooks/useTx";
import { toBigNumber, uAmountToBigNumberAmount } from "../../../utils/amount";
import { FEE_DENOM, maxSendableUAmount } from "../../portfolio/sendHelpers";

/** The tradebin cancel-order proto type URL. */
export const TYPE_CANCEL_ORDER = "/bze.tradebin.MsgCancelOrder";

/** total = price × amount (display units); "" when inputs are incomplete. */
export function totalFromPriceAmount(price: string, amount: string): string {
  const p = toBigNumber(price || 0);
  const a = toBigNumber(amount || 0);
  if (p.isNaN() || a.isNaN() || (!price && !amount)) return "";
  if (!price || !amount) return "";
  return p.multipliedBy(a).toString();
}

/** amount = total ÷ price (display units); "" when price is missing/zero. */
export function amountFromPriceTotal(price: string, total: string): string {
  const p = toBigNumber(price || 0);
  const t = toBigNumber(total || 0);
  if (!price || !total || p.isNaN() || t.isNaN() || p.lte(0)) return "";
  return t.dividedBy(p).toString();
}

export interface ShortcutParams {
  /** Fraction of the balance to use, 0..1. */
  fraction: number;
  isBuy: boolean;
  /** Display price (quote per base). Required for buy. */
  price: string;
  base: string;
  quote: string;
  baseDecimals: number;
  quoteDecimals: number;
  /** Spendable base-unit balances of the base and quote denoms. */
  spendableBaseU: string;
  spendableQuoteU: string;
  /** Estimated fee in ubze (base units); subtracted only at 100% of the fee denom. */
  feeUbze: string;
}

/**
 * shortcutBaseAmount returns the display base amount for a 25/50/75/100% balance
 * shortcut. For a buy it spends a fraction of the quote balance (amount =
 * budget ÷ price); for a sell it uses a fraction of the base balance directly.
 * The fee is subtracted only at 100% and only when the spent denom is the fee
 * denom — matching M1's fee-aware Max. Returns "" when it cannot be computed
 * (e.g. buy with no price). Rounded down to the base's decimals so it is a valid
 * order amount.
 */
export function shortcutBaseAmount(p: ShortcutParams): string {
  const full = p.fraction >= 1;
  if (p.isBuy) {
    const price = toBigNumber(p.price || 0);
    if (price.lte(0) || price.isNaN()) return "";
    const budgetU = full
      ? maxSendableUAmount(p.spendableQuoteU, p.quote === FEE_DENOM, p.feeUbze)
      : toBigNumber(p.spendableQuoteU || 0).multipliedBy(p.fraction);
    const budget = uAmountToBigNumberAmount(budgetU.toFixed(0), p.quoteDecimals);
    return budget.dividedBy(price).decimalPlaces(p.baseDecimals, BigNumber.ROUND_DOWN).toString();
  }
  const baseU = full
    ? maxSendableUAmount(p.spendableBaseU, p.base === FEE_DENOM, p.feeUbze)
    : toBigNumber(p.spendableBaseU || 0).multipliedBy(p.fraction);
  return uAmountToBigNumberAmount(baseU.toFixed(0), p.baseDecimals)
    .decimalPlaces(p.baseDecimals, BigNumber.ROUND_DOWN)
    .toString();
}

/** The outcome of a built order, derived from its message list. */
export interface OrderSummary {
  /** How many resting price levels this order fills before resting. */
  fillLevels: number;
  /** Whether a remainder is placed as a limit order at the user's price. */
  hasLeftover: boolean;
  /** The leftover (resting) amount in u-units, "0" when there is none. */
  leftoverUAmount: string;
  /** Total order amount across all messages (u-units). */
  totalUAmount: string;
}

/**
 * summarizeOrder derives the human outcome of a built order from its message
 * list and the limit u-price. BuildOrderMessages appends the resting leftover
 * last at exactly the limit price, so the last message is the leftover iff its
 * price equals limitUPrice; every earlier message is a fill at a crossing level.
 * A single message at the limit price is a pure limit order (0 fills).
 */
export function summarizeOrder(
  msgs: Array<Record<string, unknown>>,
  limitUPrice: string,
): OrderSummary {
  if (msgs.length === 0) {
    return { fillLevels: 0, hasLeftover: false, leftoverUAmount: "0", totalUAmount: "0" };
  }
  const last = msgs[msgs.length - 1];
  const leftoverIsLast = String(last.price) === limitUPrice;
  const total = msgs.reduce((acc, m) => acc.plus(toBigNumber(String(m.amount || 0))), new BigNumber(0));
  return {
    fillLevels: leftoverIsLast ? msgs.length - 1 : msgs.length,
    hasLeftover: leftoverIsLast,
    leftoverUAmount: leftoverIsLast ? String(last.amount) : "0",
    totalUAmount: total.toString(),
  };
}

/** Builds a MsgCancelOrder proto-JSON for one of the user's resting orders. */
export function buildCancelMsg(address: string, order: tradebin.Order): ProtoMsg {
  return {
    "@type": TYPE_CANCEL_ORDER,
    creator: address,
    market_id: order.marketId,
    order_id: order.id,
    order_type: order.orderType,
  };
}
