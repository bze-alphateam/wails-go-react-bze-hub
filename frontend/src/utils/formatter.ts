import BigNumber from "bignumber.js";

// Ported from @bze/bze-ui-kit (packages/ui-kit/src/utils/formatter.ts). Kept
// byte-for-byte compatible with the web apps so USD figures render identically.

/**
 * Render a USD price string with enough decimals to show up to 6 significant
 * digits after the decimal point (so sub-cent token prices stay readable),
 * trimming no trailing zeros beyond that window.
 */
export const formatUsdAmount = (priceNum: BigNumber): string => {
    const price = priceNum.toString();
    const decimalIndex = price.indexOf('.');

    if (decimalIndex === -1) {
        return price;
    }

    const decimalPart = price.substring(decimalIndex + 1);
    let significantDigitCount = 0;
    let decimalsFound = 0;

    for (let i = 0; i < decimalPart.length; i++) {
        const digit = decimalPart[i];
        decimalsFound++;

        if (digit !== '0' || significantDigitCount > 0) {
            significantDigitCount++;
        }

        if (significantDigitCount >= 6) {
            break;
        }
    }

    return priceNum.toFixed(decimalsFound).toString();
}

/**
 * Compact large numbers with K/M/B/T/Q suffixes (e.g. 1_500_000 → "1.5M").
 * Values under 0.001 collapse to "0".
 */
export function shortNumberFormat(amount: BigNumber): string {
    if (amount.isNaN() || amount.isZero()) {
        return '0';
    }

    if (amount.lt(0.001)) {
        return '0';
    }

    const units = [
        { value: new BigNumber('1e15'), suffix: 'Q' },
        { value: new BigNumber('1e12'), suffix: 'T' },
        { value: new BigNumber('1e9'), suffix: 'B' },
        { value: new BigNumber('1e6'), suffix: 'M' },
        { value: new BigNumber('1e3'), suffix: 'K' },
    ];

    for (const unit of units) {
        if (amount.gte(unit.value)) {
            const formatted = amount.div(unit.value);
            const result = formatted.toFixed(3).replace(/\.?0+$/, '');
            return `${result}${unit.suffix}`;
        }
    }

    return amount.toFixed(3).replace(/\.?0+$/, '');
}
