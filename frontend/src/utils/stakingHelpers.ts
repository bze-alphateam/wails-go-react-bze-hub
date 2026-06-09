// Staking calculation helpers — ported from bze-ui-kit/src/utils/staking.ts

import type {
  UnbondingDelegation,
  PendingUnlockParticipant,
  PendingUnlockRow,
} from "./stakingTypes";

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
 * Whether a reward program is still active (paying out).
 *
 * `duration`/`payouts` are protobuf `uint32` with `omitempty`, so a brand-new
 * program that has not paid out yet serializes `payouts` as *absent* → `undefined`
 * on the JS side. Coercing through `Number(x ?? 0)` makes the comparison robust to
 * that (and to string-encoded values from REST), instead of `undefined < n` (false)
 * silently dropping a fresh program.
 */
export function isRewardActive(reward: {
  payouts?: number | string;
  duration?: number | string;
}): boolean {
  const payouts = Number(reward.payouts ?? 0);
  const duration = Number(reward.duration ?? 0);
  return duration > 0 && payouts < duration;
}

/** Block-explorer base for BZE mainnet (chaintools). */
const EXPLORER_BASE = "https://explorer.chaintools.tech/beezee";

/** Explorer URL for a transaction hash. */
export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

/**
 * Human-readable label for a denom: ubze → BZE, factory tokens → their subdenom.
 */
export function denomLabel(denom: string): string {
  if (denom === "ubze") return "BZE";
  if (denom.startsWith("factory/")) return denom.split("/").pop() || denom;
  // IBC denoms are long hashes — show a short, recognizable suffix.
  if (denom.startsWith("ibc/")) return `IBC/${denom.slice(4, 10)}`;
  return denom;
}

/**
 * Truncate an address for display: bze1abc...xyz
 */
export function truncateAddress(addr: string, prefixLen = 8, suffixLen = 4): string {
  if (addr.length <= prefixLen + suffixLen + 3) return addr;
  return `${addr.slice(0, prefixLen)}...${addr.slice(-suffixLen)}`;
}

// --- pending unlocks -------------------------------------------------------

/**
 * Format the time remaining until an absolute completion timestamp (ISO-8601,
 * as returned by the chain for native unbonding entries). Returns "Ready" once
 * past, otherwise a compact "12d 4h" / "4h 9m" / "9m".
 */
export function formatTimeUntil(completionTimeIso: string, nowMs: number = Date.now()): string {
  const target = Date.parse(completionTimeIso);
  if (isNaN(target)) return "—";
  return formatDurationMs(target - nowMs);
}

/**
 * Format the time remaining for a reward-program pending unlock. These complete
 * on the "hour" epoch, so the gap in epochs is ≈ the gap in hours. Returns
 * "Ready" if due, otherwise "~3h" / "~2d 5h".
 */
export function formatHoursUntil(unlockEpoch: number, currentEpoch: number): string {
  const hours = unlockEpoch - currentEpoch;
  if (!isFinite(hours) || hours <= 0) return "Ready";
  return "~" + formatDurationMs(hours * 3600_000);
}

/** Compact human duration from milliseconds: "Ready" if ≤0, else "12d 4h"/"4h"/"9m"/"<1m". */
function formatDurationMs(ms: number): string {
  if (ms <= 0) return "Ready";
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return "<1m";
}

/**
 * Parse a reward pending-unlock index. The chain key is
 * `{epoch}/{reward_id}/{address}` — epoch is the "hour" epoch it unlocks at.
 */
export function parsePendingUnlockIndex(index: string): { epoch: number; rewardId: string } {
  const parts = (index || "").split("/");
  const epoch = parseInt(parts[0] ?? "", 10);
  return {
    epoch: isNaN(epoch) ? 0 : epoch,
    rewardId: parts[1] ?? "",
  };
}

/**
 * Build a unified list of pending unlocks (funds on their way out) from native
 * unbonding delegations and reward-program pending unlocks. Pure — `nowMs` is
 * injectable for testing.
 */
export function buildPendingUnlockRows(
  data: {
    unbonding?: UnbondingDelegation[];
    pendingUnlocks?: PendingUnlockParticipant[];
    currentHourEpoch?: number;
  },
  nowMs: number = Date.now()
): PendingUnlockRow[] {
  const rows: PendingUnlockRow[] = [];

  // Native unbonding: one row per entry (each has its own completion time).
  for (const ub of data.unbonding ?? []) {
    for (let i = 0; i < (ub.entries?.length ?? 0); i++) {
      const entry = ub.entries[i];
      rows.push({
        key: `n-${ub.validator_address}-${entry.creation_height}-${i}`,
        kind: "native",
        title: "Undelegating",
        amountHuman: formatAmount(ubzeToHuman(entry.balance)),
        denom: "ubze",
        when: formatTimeUntil(entry.completion_time, nowMs),
      });
    }
  }

  // Reward-program pending unlocks.
  const currentEpoch = data.currentHourEpoch ?? 0;
  for (const pu of data.pendingUnlocks ?? []) {
    const { epoch, rewardId } = parsePendingUnlockIndex(pu.index);
    rows.push({
      key: `r-${pu.index}`,
      kind: "reward",
      title: `Exiting ${denomLabel(pu.denom)} program${rewardId ? ` #${rewardId}` : ""}`,
      amountHuman: formatAmount(ubzeToHuman(pu.amount)),
      denom: pu.denom,
      when: currentEpoch > 0 ? formatHoursUntil(epoch, currentEpoch) : "Pending",
    });
  }

  return rows;
}
