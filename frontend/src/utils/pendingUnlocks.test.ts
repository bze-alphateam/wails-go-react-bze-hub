import { describe, it, expect } from "vitest";
import {
  formatTimeUntil,
  formatHoursUntil,
  parsePendingUnlockIndex,
  buildPendingUnlockRows,
} from "./stakingHelpers";

const NOW = Date.parse("2026-06-05T12:00:00Z");

describe("formatTimeUntil", () => {
  it("returns Ready when the completion time has passed", () => {
    expect(formatTimeUntil("2026-06-04T12:00:00Z", NOW)).toBe("Ready");
  });
  it("formats multi-day remaining as Xd Yh", () => {
    // +12 days 4 hours
    expect(formatTimeUntil("2026-06-17T16:00:00Z", NOW)).toBe("12d 4h");
  });
  it("drops hours when zero on a day boundary", () => {
    expect(formatTimeUntil("2026-06-08T12:00:00Z", NOW)).toBe("3d");
  });
  it("formats sub-day remaining as Xh Ym", () => {
    expect(formatTimeUntil("2026-06-05T16:30:00Z", NOW)).toBe("4h 30m");
  });
  it("formats minutes only", () => {
    expect(formatTimeUntil("2026-06-05T12:09:00Z", NOW)).toBe("9m");
  });
  it("returns — for an unparseable timestamp", () => {
    expect(formatTimeUntil("not-a-date", NOW)).toBe("—");
  });
});

describe("formatHoursUntil (reward unlocks on the hour epoch)", () => {
  it("returns Ready when due or past", () => {
    expect(formatHoursUntil(100, 100)).toBe("Ready");
    expect(formatHoursUntil(90, 100)).toBe("Ready");
  });
  it("formats a few hours ahead", () => {
    expect(formatHoursUntil(103, 100)).toBe("~3h");
  });
  it("rolls into days past 24h", () => {
    expect(formatHoursUntil(100 + 29, 100)).toBe("~1d 5h");
  });
});

describe("parsePendingUnlockIndex", () => {
  it("splits {epoch}/{reward_id}/{address}", () => {
    expect(parsePendingUnlockIndex("1234/reward_1/bze1abc")).toEqual({
      epoch: 1234,
      rewardId: "reward_1",
    });
  });
  it("is defensive against malformed input", () => {
    expect(parsePendingUnlockIndex("")).toEqual({ epoch: 0, rewardId: "" });
    expect(parsePendingUnlockIndex("xx")).toEqual({ epoch: 0, rewardId: "" });
  });
});

describe("buildPendingUnlockRows", () => {
  it("returns [] when nothing is unlocking", () => {
    expect(buildPendingUnlockRows({}, NOW)).toEqual([]);
  });

  it("emits one native row per unbonding entry with amount + time", () => {
    const rows = buildPendingUnlockRows(
      {
        unbonding: [
          {
            delegator_address: "bze1me",
            validator_address: "bzevaloper1x",
            entries: [
              {
                creation_height: "100",
                completion_time: "2026-06-17T16:00:00Z",
                initial_balance: "5000000",
                balance: "5000000",
              },
            ],
          },
        ],
      },
      NOW
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "native",
      title: "Undelegating",
      amountHuman: "5",
      denom: "ubze",
      when: "12d 4h",
    });
  });

  it("emits reward rows with ≈hours remaining from the current hour epoch", () => {
    const rows = buildPendingUnlockRows(
      {
        pendingUnlocks: [
          { index: "1003/reward_7/bze1me", address: "bze1me", amount: "2000000", denom: "ubze" },
        ],
        currentHourEpoch: 1000,
      },
      NOW
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "reward",
      title: "Exiting BZE program #reward_7",
      amountHuman: "2",
      denom: "ubze",
      when: "~3h",
    });
  });

  it("falls back to 'Pending' for reward unlocks when the epoch is unknown", () => {
    const rows = buildPendingUnlockRows(
      {
        pendingUnlocks: [
          { index: "1003/reward_7/bze1me", address: "bze1me", amount: "2000000", denom: "ubze" },
        ],
        // no currentHourEpoch
      },
      NOW
    );
    expect(rows[0].when).toBe("Pending");
  });

  it("combines native + reward rows", () => {
    const rows = buildPendingUnlockRows(
      {
        unbonding: [
          {
            delegator_address: "bze1me",
            validator_address: "bzevaloper1x",
            entries: [
              { creation_height: "1", completion_time: "2026-06-05T12:09:00Z", initial_balance: "1", balance: "1000000" },
            ],
          },
        ],
        pendingUnlocks: [
          { index: "1003/reward_7/bze1me", address: "bze1me", amount: "2000000", denom: "ubze" },
        ],
        currentHourEpoch: 1000,
      },
      NOW
    );
    expect(rows.map((r) => r.kind)).toEqual(["native", "reward"]);
  });
});
