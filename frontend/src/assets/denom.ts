// Pure denom-string helpers — no React, no I/O, fully unit-testable.

import type { DenomType } from "./types";

export const NATIVE_DENOM = "ubze";

export function isNativeDenom(denom: string): boolean {
  return denom === NATIVE_DENOM;
}

export function isFactoryDenom(denom: string): boolean {
  return denom.startsWith("factory/");
}

export function isIbcDenom(denom: string): boolean {
  return denom.startsWith("ibc/");
}

export function isLpDenom(denom: string): boolean {
  // BZE LP shares use the `ulp_{base}_{quote}` convention.
  return denom.startsWith("ulp_");
}

export function getDenomType(denom: string): DenomType {
  if (isNativeDenom(denom)) return "native";
  if (isFactoryDenom(denom)) return "factory";
  if (isIbcDenom(denom)) return "ibc";
  if (isLpDenom(denom)) return "lp";
  return "unknown";
}

/**
 * The trailing sub-denom of a factory token: the part after the last "/".
 * factory/bze1…/uvdl → "uvdl". Returns the input unchanged for non-factory denoms.
 */
export function factorySubdenom(denom: string): string {
  if (!isFactoryDenom(denom)) return denom;
  return denom.split("/").pop() || denom;
}

/**
 * A short, recognizable label for an arbitrary denom when no metadata is known.
 * Used only as a last-resort fallback (the registry resolver prefers real symbols).
 *   ubze            → "BZE"
 *   factory/…/uvdl  → "uvdl"        (sub-denom)
 *   ibc/ABCDEF…     → "IBC/ABCDEF"  (short hash prefix)
 *   anything else   → truncated from the center
 */
export function shortDenomLabel(denom: string): string {
  if (isNativeDenom(denom)) return "BZE";
  if (isFactoryDenom(denom)) return factorySubdenom(denom);
  if (isIbcDenom(denom)) return `IBC/${denom.slice(4, 10)}`;
  return truncateDenom(denom);
}

/** Center-truncate a long denom string: keep head and tail, elide the middle. */
export function truncateDenom(denom: string, head = 8, tail = 6): string {
  if (denom.length <= head + tail + 1) return denom;
  return `${denom.slice(0, head)}…${denom.slice(-tail)}`;
}
