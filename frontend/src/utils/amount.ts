import BigNumber from "bignumber.js";

// Ported from @bze/bze-ui-kit (packages/ui-kit/src/utils/amount.ts) so the Hub
// formats chain amounts identically to the web apps. All math is BigNumber-based
// — chain amounts routinely exceed Number.MAX_SAFE_INTEGER, so float math would
// silently lose precision.

const MAX_PRICE_DECIMALS = 14;

export function toBigNumber(amount: string | number | BigNumber | bigint): BigNumber {
    if (amount instanceof BigNumber) {
        return amount;
    }

    return new BigNumber(amount as BigNumber.Value);
}

export function uAmountToAmount(amount: string | number | BigNumber | bigint | undefined, noOfDecimals: number): string {
    return uAmountToBigNumberAmount(amount, noOfDecimals).toString();
}

export function uAmountToBigNumberAmount(amount: string | number | BigNumber | bigint | undefined, noOfDecimals: number): BigNumber {
    return toBigNumber(amount || 0)
        .shiftedBy((-1) * noOfDecimals)
        .decimalPlaces(noOfDecimals || 6)
}

export function amountToBigNumberUAmount(amount: string | number | BigNumber | bigint, noOfDecimals: number): BigNumber {
    return toBigNumber(amount)
        .shiftedBy(noOfDecimals)
        .decimalPlaces(noOfDecimals || 6);
}

export function amountToUAmount(amount: string | number | BigNumber | bigint, noOfDecimals: number): string {
    return amountToBigNumberUAmount(amount, noOfDecimals).toString();
}

export function prettyAmount(amount: number | string | BigNumber | bigint): string {
    const num = toBigNumber(amount)
    if (num.isNaN()) {
        return "0";
    }

    if (num.lt(1) && num.gt(0)) {
        return num.toFixed(6);
    }

    return Intl.NumberFormat('en', {notation: 'standard'}).format(num.toNumber());
}

export const priceToUPrice = (price: BigNumber, quoteExponent: number, baseExponent: number): string => {
    return priceToBigNumberUPrice(price, quoteExponent, baseExponent).toFixed(MAX_PRICE_DECIMALS).toString();
}

export const priceToBigNumberUPrice = (price: BigNumber | number | string, quoteExponent: number, baseExponent: number): BigNumber => {
    price = toBigNumber(price);

    return price.multipliedBy(Math.pow(10, (quoteExponent - baseExponent)));
}

export const uPriceToPrice = (price: BigNumber | string, quoteExponent: number, baseExponent: number): string => {
    return uPriceToBigNumberPrice(toBigNumber(price), quoteExponent, baseExponent).toString()
}

export const uPriceToBigNumberPrice = (price: BigNumber|number|bigint|string, quoteExponent: number, baseExponent: number): BigNumber => {
    const converted = toBigNumber(price);

    return converted.multipliedBy(Math.pow(10, (baseExponent - quoteExponent)));
}
