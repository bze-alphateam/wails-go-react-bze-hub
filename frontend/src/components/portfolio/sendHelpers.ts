import BigNumber from "bignumber.js";
import { isValidBech32 } from "../../utils/bech32";
import { amountToBigNumberUAmount, toBigNumber, uAmountToAmount } from "../../utils/amount";

/**
 * Pure validation logic for the Send form, kept free of React so it can be unit
 * tested directly. All amount math is BigNumber-based and operates on raw
 * base-unit integer strings (the shape the chain and `GetSpendableBalances` use);
 * never floats, since chain amounts routinely exceed Number.MAX_SAFE_INTEGER.
 */

/** bech32 human-readable prefix for BeeZee account addresses. */
export const ADDRESS_PREFIX = "bze";

/** The denom fees are always paid in (ubze), and its exponent. */
export const FEE_DENOM = "ubze";
export const FEE_DECIMALS = 6;

export interface RecipientCheck {
  valid: boolean;
  error?: string;
  /** True when the recipient is the sender's own address — a bypassable warning. */
  selfSend: boolean;
}

/**
 * Validate a recipient address: it must be a well-formed `bze1…` bech32 address.
 * Sending to your own address is allowed but flagged (`selfSend`) so the form can
 * show a bypassable warning — it is almost never intended.
 */
export function validateRecipient(recipient: string, selfAddress: string): RecipientCheck {
  const addr = recipient.trim();
  if (!addr) {
    return { valid: false, selfSend: false };
  }
  if (!isValidBech32(addr, ADDRESS_PREFIX)) {
    return { valid: false, error: `Enter a valid ${ADDRESS_PREFIX}… address`, selfSend: false };
  }
  return { valid: true, selfSend: addr === selfAddress.trim() };
}

/**
 * The largest base-unit amount of a denom that can be sent. When the denom is the
 * fee denom (ubze), the estimated fee is subtracted so the Max button never sets
 * an amount that leaves nothing for the fee; for any other denom the fee is paid
 * separately in ubze, so the full spendable balance is available. Floored at zero.
 */
export function maxSendableUAmount(
  spendableU: string,
  isFeeDenom: boolean,
  feeUbze: string
): BigNumber {
  const spendable = toBigNumber(spendableU || 0);
  const fee = isFeeDenom ? toBigNumber(feeUbze || 0) : new BigNumber(0);
  const max = spendable.minus(fee);
  return max.gt(0) ? max : new BigNumber(0);
}

export interface AmountCheckParams {
  /** Human-entered amount (e.g. "12.5"). */
  amount: string;
  /** The denom being sent. */
  denom: string;
  /** Exponent of the sent denom. */
  decimals: number;
  /** Spendable base-unit balance of the sent denom. */
  spendableU: string;
  /** Estimated fee in ubze (base units); "" / "0" when not yet known. */
  feeUbze: string;
  /** Spendable base-unit balance of the fee denom (ubze) — for the cross-denom guard. */
  feeSpendableU: string;
  /** Display symbol of the sent denom, used in messages (e.g. "BZE"). */
  symbol: string;
}

export interface AmountCheck {
  valid: boolean;
  /** The validated amount in base units (integer string); "0" when invalid. */
  uAmount: string;
  error?: string;
}

/**
 * Validate a send amount against the spendable balance and the network fee.
 * Blocks, with a plain-language message: empty/zero/negative amounts, amounts
 * over the spendable balance, amounts that would leave nothing for the fee (when
 * sending the fee denom), and — when sending a non-fee denom — not holding enough
 * ubze to pay the fee at all.
 */
export function validateSendAmount(params: AmountCheckParams): AmountCheck {
  const { amount, denom, decimals, spendableU, feeUbze, feeSpendableU, symbol } = params;

  const trimmed = amount.trim();
  if (!trimmed) {
    return { valid: false, uAmount: "0", error: "Enter an amount" };
  }

  const human = toBigNumber(trimmed);
  if (human.isNaN() || human.lte(0)) {
    return { valid: false, uAmount: "0", error: "Enter a valid amount greater than zero" };
  }

  const uAmount = amountToBigNumberUAmount(human, decimals).integerValue(BigNumber.ROUND_FLOOR);
  if (uAmount.lte(0)) {
    return { valid: false, uAmount: "0", error: "Amount is too small" };
  }

  const spendable = toBigNumber(spendableU || 0);
  if (uAmount.gt(spendable)) {
    return { valid: false, uAmount: uAmount.toFixed(), error: "Amount exceeds your spendable balance" };
  }

  const fee = toBigNumber(feeUbze || 0);
  const isFeeDenom = denom === FEE_DENOM;

  if (isFeeDenom) {
    const max = spendable.minus(fee);
    if (uAmount.gt(max)) {
      const maxHuman = uAmountToAmount(max.gt(0) ? max : new BigNumber(0), decimals);
      return {
        valid: false,
        uAmount: uAmount.toFixed(),
        error: `Leave room for the network fee — max ${maxHuman} ${symbol}`,
      };
    }
  } else if (fee.gt(0) && toBigNumber(feeSpendableU || 0).lt(fee)) {
    return {
      valid: false,
      uAmount: uAmount.toFixed(),
      error: "Not enough BZE to cover the network fee",
    };
  }

  return { valid: true, uAmount: uAmount.toFixed() };
}
