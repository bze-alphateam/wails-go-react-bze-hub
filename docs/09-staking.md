# 09 — Staking

The Staking page is the first fully native dApp surface in BZE Hub. It covers
**two independent staking systems** on the BZE chain and presents them through a
single page with two views.

## The two staking systems

| System | Module | What it is | "No revenue" when… |
|--------|--------|------------|--------------------|
| **Native staking** | Cosmos `x/staking` + `x/distribution` | Delegate BZE to validators, earn inflation/fee rewards | the validator is **jailed** or otherwise out of the bonded set |
| **Reward-program staking** | BZE `x/rewards` | Lock a denom into a time-bounded prize pool, earn the prize denom | the program has **finished** (`payouts >= duration`) |

The two are unrelated on-chain: you can join a reward program without delegating
to any validator, and vice-versa. The compact view deliberately unifies them so
the user sees one coherent picture ("what am I staking, what is it earning, is any
of it broken?") without needing to know the distinction.

## Two views (one page-level toggle)

A single **Compact | Advanced** segmented toggle lives in the page header
(`StakingPage.tsx`). The choice is persisted to `localStorage` under
`bze-staking-view` (default: `compact`), mirroring the color-mode pattern.

### Compact view (`StakingCompact.tsx`)

Hides validators entirely. Shows:

- **Summary cards** — Staked (native delegations + `ubze` reward-program stakes),
  Available (liquid `ubze`), Pending rewards (native, with a `+N` hint when reward
  programs also have claimable rewards), and estimated APR.
- **Stake-health banner** — green "healthy" line, or an amber panel listing each
  issue with an action (see below).
- **Rewards list** — one row per claimable *source* (native staking rewards
  aggregated into a single row; one row per reward program), each with its own
  **Claim** button, plus a **Claim all** button. This is the "claim all or one by
  one" behavior from the spec.
- **Earn more** — the joinable reward programs (`x/rewards`). One row per active
  program ("Stake X → earn Y", APR, pool size) with a **Join** button, or a
  "Joined" marker for programs the user already participates in. Not-yet-joined
  programs sort first, then by APR. This restores parity with dex.getbze.com (and
  the pre-rework default view): the compact screen surfaces *opportunities*, not
  just claimable balances. The section is hidden entirely when there are no active
  programs. (Reward-program detail/exit still lives in Advanced.)
- **Stake** — one button that auto-splits across recommended validators (no
  validator picking).

> **Active-program test.** Both views decide "is this program still paying out?"
> through the shared `isRewardActive(reward)` helper (`stakingHelpers.ts`), not an
> inline `payouts < duration`. `duration`/`payouts` are protobuf `uint32` with
> `omitempty`, so a brand-new program that hasn't paid out yet serializes `payouts`
> as *absent* → `undefined`; a raw `undefined < duration` is `false` and silently
> dropped the program. The helper coerces through `Number(x ?? 0)` (also tolerating
> REST's string-encoded values) and is unit-tested in `isRewardActive.test.ts`.

### Advanced view

The full validator-level detail, reusing the existing components:
`StakingStatsBar` + `NativeStakingAdvanced` (per-validator table: delegate /
redelegate / undelegate / per-validator rewards) + `RewardsStakingSection`
(per-program join/claim/exit). The bonded validator list is **merged** with the
validators the user delegated to, so a jailed delegation still shows a row instead
of vanishing.

## Validator-pick rules (compact auto-staking + auto-fix)

The compact view never asks the user to choose a validator. The rules live in
`frontend/src/utils/validatorScoring.ts` (the single source of truth) and are a
small, explainable **weighted model** rather than a single heuristic:

1. **Filter** — eligible = `BOND_STATUS_BONDED` && not jailed && commission ≤
   `maxCommission` (default `0.5`). The commission cap removes extractive
   validators; if it would empty the set it's dropped (fallback to all active),
   so a pick is always possible.
2. **Score** — a weighted blend of two factors, each normalized to `[0,1]`
   **relative to the eligible set** so the weights are directly comparable
   (defaults `commission: 0.6`, `votingPower: 0.4`):
   - **commission** — min-max across the set (cheapest → 1, dearest → 0). Guarded:
     when all commissions are within ~1% it's treated as neutral (all 1) so it
     doesn't nitpick near-identical rates. This is the only factor that affects
     the user's actual returns.
   - **votingPower** — rank-based (smallest validator → 1, largest → 0). A
     decentralization/resilience signal; it does **not** affect APR.
   Final `score = (weighted blend) × multiplier`, where `multiplier` defaults to
   `1.0` with optional per-validator overrides (`customMultipliers`, reserved for a
   future remote scoring config). Ties break toward the smaller validator.
3. **Select** — take the top `N` (default `3`) for a new stake; take the top `1`
   when auto-fixing a broken delegation.
4. **Split** — divide the amount equally across the selected validators;
   remainder goes to the first.

The model is pure and unit-tested (`validatorScoring.test.ts`): eligibility +
commission cap/fallback, decentralization on equal commission, commission
pondering (a meaningfully cheaper mid-size validator beats a tiny expensive one),
the near-equal-commission neutral guard, and custom multipliers. Quality signals
that need extra chain queries (uptime, slashing history, self-bond) are
intentionally out of scope for now; the `weights` object makes adding a factor a
localized change.

## Stake-health rules (`frontend/src/utils/stakeHealth.ts`)

`computeStakeHealth(...)` returns `{ status, issues }` (pure, unit-tested in
`stakeHealth.test.ts`). An "unhealthy" stake is one that no longer earns:

| Issue type | Detected when | Fixable? | Action in UI |
|------------|---------------|----------|--------------|
| `validator_inactive` | the delegated validator is `jailed`, `BOND_STATUS_UNBONDING`, or `BOND_STATUS_UNBONDED` | **Yes** | **Fix** → one-click `MsgBeginRedelegate` of the full delegated amount to the best healthy validator (chosen by the scoring rules above) |
| `finished_reward` | the joined reward program has `payouts >= duration` (or the program record is gone) | **No** | **Start unlock** → `MsgExitStaking` (begins the program's lock period), or leave it in place hoping for a top-up |

Detecting a jailed delegation requires the **full** validator object, which the
bonded-only validator list omits (jailed validators leave the bonded set). The
backend therefore also fetches the delegator's own validators — see below.

The message warns the user specifically about what is wrong (which validator, why)
rather than a generic "unhealthy" flag.

## Pending unlocks

Funds that are on their way out (no longer earning, not yet liquid) are surfaced by
a shared `PendingUnlocks` component (`PendingUnlocks.tsx`). It unifies the two
sources:

| Source | From | Amount | When it's available |
|--------|------|--------|---------------------|
| **Native unbonding** | `unbonding[].entries[]` | `entry.balance` | `entry.completion_time` (absolute) → "Available in 12d 4h" |
| **Reward-program exit** | `pendingUnlocks[]` | `amount`/`denom` | unlock **hour-epoch** parsed from the index, minus `currentHourEpoch` → "Available in ~3h" |

The reward pending-unlock record only carries `index/address/amount/denom`; the
chain key is `{epoch}/{reward_id}/{address}` where `epoch` is the **"hour" epoch**
it unlocks at (the `x/rewards` unlock hook runs on the hour epoch). So
`unlockEpoch − currentHourEpoch ≈ hours remaining`. If `currentHourEpoch` is
unavailable the row shows "Unlock pending" rather than a wrong time.

Row construction is pure and unit-tested (`buildPendingUnlockRows` in
`stakingHelpers.ts` / `pendingUnlocks.test.ts`, with an injectable `now`). The
component renders nothing when there's nothing pending. Placement: **compact** view
shows a unified card (`include="all"`); **advanced** view shows native unbonding
inside the validator section (`include="native"`, titled "Unbonding") and reward
exits inside the rewards section (`include="reward"`).

## Data flow

`useStakingData` polls `App.GetStakingOverview(address)` (10s local / 30s public)
which fans out parallel gRPC/REST queries in `staking.go` and returns one map.
Keys consumed by the staking UI:

| Key | Source (Go) | Used for |
|-----|-------------|----------|
| `validators` | `GetValidators("BOND_STATUS_BONDED")` | stake/fix candidate pool |
| `delegatedValidators` | `GetDelegatorValidators(address)` | **health** — full objects incl. jailed |
| `availableBalance` | bank `by_denom` REST (`ubze`) | compact "Available" card |
| `delegations` | `GetDelegations` | staked totals, per-delegation health |
| `unbonding` | `GetUnbondingDelegations` | **pending unlocks** (native undelegations in progress) |
| `rewards` | distribution `DelegationTotalRewards` | native pending rewards / claim |
| `pool`, `stakingParams`, `annualProvisions`, `distributionParams` | staking/mint/distribution | APR, unbonding days |
| `stakingRewards`, `rewardParticipants`, `pendingUnlocks` | `x/rewards` queries | reward-program staking + **pending unlocks** (program exits) |
| `currentHourEpoch` | `GetCurrentEpoch("hour")` (`x/epochs`) | ≈hours remaining on a reward pending unlock |

**Transaction pipeline.** `useStakingTx` builds messages as **proto-JSON** (each
an object with an `@type`, e.g. `/cosmos.staking.v1beta1.MsgDelegate`,
`/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward`,
`/bze.rewards.MsgJoinStaking`) and hands the array to the Go backend's
`App.SignAndBroadcast(signer, msgsJSON, memo)`. Go decodes them via the interface
registry, builds a tx with **`SIGN_MODE_DIRECT`** (`chain/tx.go` →
`BuildSignedTxBytes`, using the SDK `TxConfig` + `clienttx.SignWithPrivKey`),
signs with the signer's key (fetched from the keyring via `wallet.PrivKey` and
zeroed after use), protobuf-encodes the `TxRaw`, and broadcasts it. Gas is
**estimated per-tx by simulation** (`chain/tx.go` → `SimulateGas`), then padded by
`gasAdjustment` (1.5×); the fee is `gas × gasPriceUbze` (0.02 ubze/gas, above the
chain's 0.01 minimum). Gas/fee/chain-id are all backend-derived — never hardcoded
in the UI.
Frontend helpers: `autoStake` (multi-`MsgDelegate`), `redelegate` (the auto-fix),
`claimNativeRewards`, `claimRewardStaking`, `exitRewardStaking`, `claimAll`.

> The interface registry in `chain/client.go` must register every message type we
> build — crypto (pubkeys), staking, distribution, and bze `rewards`. A missing
> registration shows up as a decode error in `SignAndBroadcast`.
>
> _Historical bug:_ the original flow base64-encoded a JSON blob as `tx_bytes`,
> which the chain rejected with `expected 2 wire type, got 3: tx parse error` (it
> expects a protobuf `TxRaw`). Building the tx in Go fixed it.

**Tx result & visibility.** Broadcasts use `BROADCAST_MODE_SYNC`. The Go side
(`logBroadcastResult` in `staking.go`) logs every outcome — `tx accepted into
mempool (txhash …)` or `tx REJECTED — code=… raw_log=…` — so failures are never
silent in the app logs. In the UI, `useStakingTx` reports every broadcast through
the **global notification system** (see [10-notifications.md](10-notifications.md)):
a loading toast while broadcasting (`notify.loading`, "Submitting…").

**Two-phase result.** `BROADCAST_MODE_SYNC` returning code 0 only means the tx
passed `CheckTx` and entered the mempool — not that it executed. So once broadcast
is accepted, the toast switches to "Confirming…" and the hook polls
`App.GetTxStatus(hash)` (→ REST `GET /cosmos/tx/v1beta1/txs/{hash}`) for the
on-chain result: first after ~2.5s (≈ one block), then every 2s up to ~12.5s. Only
then does it resolve to a **success** toast with an **Open in explorer** action
(→ `https://explorer.chaintools.tech/beezee/tx/{hash}` via `OpenURL`), or — if the
tx is found with a non-zero code — a **failure** toast carrying the on-chain
`raw_log`. If the tx never appears within the window we fall back to "submitted"
(the hash exists, so it is in the mempool). This confirmation runs **detached** from
the `await`ed call, so the advanced-view modals close on success and the compact
view reloads immediately while the toast keeps confirming in the background; there
is no inline result component.

## Theming

All new UI uses Chakra **semantic tokens** (`bg.panel`, `bg.subtle`,
`border.subtle`, `fg.muted`) plus `_dark={{…}}` overrides for the colored health
banners, so dark/light mode works with no extra wiring.
