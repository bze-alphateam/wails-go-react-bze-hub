// Staking calculation helpers — ported from bze-ui-kit/src/utils/staking.ts

const UBZE_DECIMALS = 6;
const SECONDS_PER_DAY = 86400;

/**
 * Convert ubze amount string to human-readable BZE amount.
 */
export function ubzeToHuman(ubze: string): string {
  const n = BigInt(ubze || "0");
  const whole = n / BigInt(10 ** UBZE_DECIMALS);
  const frac = n % BigInt(10 ** UBZE_DECIMALS);
  const fracStr = frac.toString().padStart(UBZE_DECIMALS, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

/**
 * Convert human-readable BZE amount to ubze string.
 */
export function humanToUbze(human: string): string {
  const parts = human.split(".");
  const whole = BigInt(parts[0] || "0");
  const fracStr = (parts[1] || "").padEnd(UBZE_DECIMALS, "0").slice(0, UBZE_DECIMALS);
  const frac = BigInt(fracStr);
  return (whole * BigInt(10 ** UBZE_DECIMALS) + frac).toString();
}

/**
 * Format a large number with commas and optional decimal places.
 */
export function formatAmount(amount: string, decimals = 2): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return "0";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Calculate native staking APR.
 * APR = (annualProvisions * (1 - communityTax)) / bondedTokens * 100
 */
export function calcNativeStakingApr(
  annualProvisions: string,
  communityTax: string,
  bondedTokens: string
): string {
  const provisions = parseFloat(annualProvisions);
  const tax = parseFloat(communityTax);
  const bonded = parseFloat(bondedTokens);

  if (bonded <= 0 || isNaN(provisions) || isNaN(tax)) return "0";

  const apr = (provisions * (1 - tax)) / bonded * 100;
  return apr.toFixed(2);
}

/**
 * Parse unbonding time from staking params (e.g. "1814400s") to days.
 */
export function unbondingTimeToDays(unbondingTime: string): number {
  const seconds = parseInt(unbondingTime.replace("s", ""), 10);
  if (isNaN(seconds)) return 0;
  return Math.round(seconds / SECONDS_PER_DAY);
}

/**
 * Calculate daily distribution from annual provisions.
 */
export function dailyDistribution(annualProvisions: string): string {
  const provisions = parseFloat(annualProvisions);
  if (isNaN(provisions)) return "0";
  return (provisions / 365).toFixed(0);
}

/**
 * Sum all DecCoin amounts for a specific denom.
 */
export function sumDecCoins(coins: { denom: string; amount: string }[], denom: string): string {
  let total = 0;
  for (const coin of coins) {
    if (coin.denom === denom) {
      total += parseFloat(coin.amount);
    }
  }
  return total.toFixed(0);
}

/**
 * Calculate pending rewards for a rewards staking participant.
 * pending = amount * (distributed_stake - joined_at)
 */
export function calcRewardsStakingPending(
  userAmount: string,
  distributedStake: string,
  joinedAt: string
): string {
  const amount = parseFloat(userAmount);
  const ds = parseFloat(distributedStake);
  const ja = parseFloat(joinedAt);

  if (isNaN(amount) || isNaN(ds) || isNaN(ja) || amount <= 0) return "0";

  const pending = amount * (ds - ja);
  return Math.max(0, Math.floor(pending)).toString();
}

/**
 * Calculate APR for a rewards staking program.
 * APR = (prizeAmount / duration / stakedAmount) * 365 * 100
 */
export function calcRewardsStakingApr(
  prizeAmount: string,
  duration: number,
  stakedAmount: string
): string {
  const prize = parseFloat(prizeAmount);
  const staked = parseFloat(stakedAmount);

  if (staked <= 0 || duration <= 0 || isNaN(prize)) return "0";

  // prize is distributed over `duration` epochs (days)
  const dailyReward = prize / duration;
  const apr = (dailyReward / staked) * 365 * 100;
  return apr.toFixed(2);
}

/**
 * Truncate an address for display: bze1abc...xyz
 */
export function truncateAddress(addr: string, prefixLen = 8, suffixLen = 4): string {
  if (addr.length <= prefixLen + suffixLen + 3) return addr;
  return `${addr.slice(0, prefixLen)}...${addr.slice(-suffixLen)}`;
}
