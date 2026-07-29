// Decimal-aware amount formatting — pure, BigInt-exact for the base↔human step.
// Generalizes the old hardcoded-6-decimals helpers (ubzeToHuman/humanToUbze) so any
// token (factory/ibc with its own exponent) converts correctly.

/**
 * Convert an integer base-unit amount to a human display string, exactly.
 *   uAmountToHuman("164006001296", 6) → "164006.001296"
 *   uAmountToHuman("1000000", 6)      → "1"
 * Trailing zeros in the fraction are trimmed. Any fractional part of the input
 * (base units are integers) is ignored.
 */
export function uAmountToHuman(
  amount: string | number | bigint,
  decimals: number
): string {
  let base: bigint;
  try {
    base =
      typeof amount === "bigint"
        ? amount
        : BigInt(String(amount ?? "0").trim().split(".")[0] || "0");
  } catch {
    return "0";
  }
  if (decimals <= 0) return base.toString();

  const neg = base < 0n;
  const abs = neg ? -base : base;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  const out = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return neg ? `-${out}` : out;
}

/**
 * Inverse of uAmountToHuman: a human-entered display amount → integer base units.
 *   humanToUAmount("1.5", 6) → "1500000"
 * Excess fraction digits beyond `decimals` are truncated (not rounded).
 */
export function humanToUAmount(
  human: string | number,
  decimals: number
): string {
  const s = String(human ?? "").trim();
  if (!s) return "0";
  const neg = s.startsWith("-");
  const clean = (neg ? s.slice(1) : s).replace(/,/g, "");
  const [wholeRaw = "0", fracRaw = ""] = clean.split(".");
  try {
    const whole = BigInt(wholeRaw || "0");
    const fracStr = decimals > 0 ? fracRaw.padEnd(decimals, "0").slice(0, decimals) : "";
    const frac = fracStr ? BigInt(fracStr) : 0n;
    const base = whole * 10n ** BigInt(decimals) + frac;
    return (neg ? -base : base).toString();
  } catch {
    return "0";
  }
}

export interface FormatOptions {
  /** Max fraction digits to display (default 6). */
  maxDecimals?: number;
  /** Min fraction digits to display (default 0). */
  minDecimals?: number;
}

/**
 * Format a human (already-scaled) numeric value with thousands separators and a
 * sensible number of fraction digits.
 *   formatAmount("164006.001296")               → "164,006.001296"
 *   formatAmount("164006.001296", {maxDecimals:2}) → "164,006"
 */
export function formatAmount(
  value: string | number,
  opts: FormatOptions = {}
): string {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!isFinite(num)) return "0";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: opts.minDecimals ?? 0,
    maximumFractionDigits: opts.maxDecimals ?? 6,
  });
}

/**
 * Abbreviate a large human value: 1234567 → "1.23M", 1200 → "1.2K".
 * Values below 1000 are shown in full (with up to `fractionDigits` decimals).
 */
export function shortNumberFormat(
  value: string | number,
  fractionDigits = 2
): string {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!isFinite(num) || num === 0) return "0";
  const neg = num < 0;
  const abs = Math.abs(num);
  const units: { v: number; s: string }[] = [
    { v: 1e15, s: "Q" },
    { v: 1e12, s: "T" },
    { v: 1e9, s: "B" },
    { v: 1e6, s: "M" },
    { v: 1e3, s: "K" },
  ];
  for (const u of units) {
    if (abs >= u.v) {
      const f = (abs / u.v).toFixed(fractionDigits).replace(/\.?0+$/, "");
      return `${neg ? "-" : ""}${f}${u.s}`;
    }
  }
  const f = abs.toLocaleString("en-US", {
    maximumFractionDigits: Math.max(fractionDigits, 2),
  });
  return `${neg ? "-" : ""}${f}`;
}

/**
 * Convenience: base units → formatted human string in one call.
 *   formatUAmount("164006001296", 6) → "164,006.001296"
 */
export function formatUAmount(
  amount: string | number | bigint,
  decimals: number,
  opts: FormatOptions = {}
): string {
  return formatAmount(uAmountToHuman(amount, decimals), opts);
}
