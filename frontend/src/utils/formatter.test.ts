import { describe, it, expect } from 'vitest'
import BigNumber from 'bignumber.js'
import { formatUsdAmount, shortNumberFormat } from './formatter'

describe('formatUsdAmount', () => {
    it('returns integers unchanged', () => {
        expect(formatUsdAmount(new BigNumber('5'))).toBe('5')
    })

    it('keeps a normal 2-decimal price', () => {
        expect(formatUsdAmount(new BigNumber('1.39'))).toBe('1.39')
    })

    it('shows enough decimals for sub-cent token prices (6 significant digits)', () => {
        // 0.00046927 → leading zeros don't count until the first significant digit
        expect(formatUsdAmount(new BigNumber('0.00046927'))).toBe('0.00046927')
    })

    it('caps at 6 significant decimal digits', () => {
        // 3 leading zeros + 6 significant digits (469271) → 9 decimals kept,
        // trailing "234" dropped.
        expect(formatUsdAmount(new BigNumber('0.000469271234'))).toBe('0.000469271')
    })

    it('handles a whole-number-less-than-one with immediate significant digit', () => {
        expect(formatUsdAmount(new BigNumber('0.5'))).toBe('0.5')
    })
})

describe('shortNumberFormat', () => {
    it('returns "0" for zero, NaN, and sub-0.001 values', () => {
        expect(shortNumberFormat(new BigNumber(0))).toBe('0')
        expect(shortNumberFormat(new BigNumber(NaN))).toBe('0')
        expect(shortNumberFormat(new BigNumber('0.0005'))).toBe('0')
    })

    it('formats thousands / millions / billions with a suffix', () => {
        expect(shortNumberFormat(new BigNumber('1500'))).toBe('1.5K')
        expect(shortNumberFormat(new BigNumber('1500000'))).toBe('1.5M')
        expect(shortNumberFormat(new BigNumber('2000000000'))).toBe('2B')
        expect(shortNumberFormat(new BigNumber('1e12'))).toBe('1T')
        expect(shortNumberFormat(new BigNumber('3e15'))).toBe('3Q')
    })

    it('trims trailing zeros and keeps small numbers as-is', () => {
        expect(shortNumberFormat(new BigNumber('12.5'))).toBe('12.5')
        expect(shortNumberFormat(new BigNumber('999'))).toBe('999')
    })
})
