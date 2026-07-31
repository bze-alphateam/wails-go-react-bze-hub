package main

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	sdkmath "cosmossdk.io/math"
	"github.com/bze-alphateam/bze-hub/internal/amm"
	"github.com/bze-alphateam/bze-hub/internal/assets"
	"github.com/bze-alphateam/bze-hub/internal/logging"
	rewardstypes "github.com/bze-alphateam/bze/x/rewards/types"
	stakingtypes "github.com/cosmos/cosmos-sdk/x/staking/types"
)

// rewardsEpochID is the epoch timer the x/rewards module schedules pending
// unlocks on (see internal/chain/epochs.go). Only the identifier is fixed by
// the chain module; the epoch's duration is always read from chain data.
const rewardsEpochID = "hour"

// RewardProgram is one x/rewards staking-reward program, exposed with the raw
// inputs the frontend APR formula consumes (APR = prizeAmount/stakedAmount
// ×365×100, web utils/staking.ts parity — computed frontend-side, never here).
// Amounts are base-unit strings as the chain returns them.
type RewardProgram struct {
	RewardID     string `json:"rewardId"`
	PrizeAmount  string `json:"prizeAmount"`  // distributed per day, base units of PrizeDenom
	PrizeDenom   string `json:"prizeDenom"`   // what participants earn
	StakingDenom string `json:"stakingDenom"` // what participants lock
	Duration     uint32 `json:"duration"`     // program length in days
	Payouts      uint32 `json:"payouts"`      // daily payouts already made
	MinStake     string `json:"minStake"`     // minimum stake to join, base units (string: uint64 can exceed JS safe integers)
	Lock         uint32 `json:"lock"`         // exit lock in days, applied on leaving
	StakedAmount string `json:"stakedAmount"` // total currently staked in the program
	// DistributedStake is the cumulative reward-per-staked-token counter; a
	// participant's pending rewards are Amount × (DistributedStake − JoinedAt).
	DistributedStake string `json:"distributedStake"`
	// IsLP flags programs whose staking denom is an AMM LP share token, so the
	// UI can split "LP locking" from plain token programs.
	IsLP bool `json:"isLp"`
	// SourcePoolID is the id of the liquidity pool the LP staking denom belongs
	// to ("" for non-LP programs), for deep-linking to Trade → Pools.
	SourcePoolID string `json:"sourcePoolId"`
}

// RewardPosition is an address's participation in one reward program.
type RewardPosition struct {
	RewardID     string `json:"rewardId"`
	StakingDenom string `json:"stakingDenom"`
	PrizeDenom   string `json:"prizeDenom"`
	Amount       string `json:"amount"`   // staked amount, base units
	JoinedAt     string `json:"joinedAt"` // program's DistributedStake at join/last claim
	// PendingRewards is Amount × (DistributedStake − JoinedAt) rounded half-up
	// to an integer — the exact web formula (calculateRewardsStakingPendingRewards).
	PendingRewards string `json:"pendingRewards"` // base units of PrizeDenom
	Lock           uint32 `json:"lock"`           // exit lock in days (from the program)
	IsLP           bool   `json:"isLp"`
	SourcePoolID   string `json:"sourcePoolId"`
}

// Pending-unlock entry kinds.
const (
	UnlockTypeNative = "native" // staking module unbonding delegation
	UnlockTypeReward = "reward" // x/rewards program exit lock
)

// PendingUnlock is one in-flight unlock — a native unbonding entry or a reward
// program exit lock — in a single shape so the UI renders them in one strip.
type PendingUnlock struct {
	Type   string `json:"type"` // UnlockTypeNative or UnlockTypeReward
	Denom  string `json:"denom"`
	Amount string `json:"amount"` // base units
	// CompletionTime is RFC3339. Native entries carry the chain's exact
	// completion time; reward entries are derived from the unlock epoch and the
	// epoch timer ("" only when the epoch info was unavailable).
	CompletionTime string `json:"completionTime"`
	// Native-only: the validator the stake is unbonding from.
	ValidatorAddress string `json:"validatorAddress,omitempty"`
	// Reward-only: source program and the epoch at which the unlock completes.
	RewardID     string `json:"rewardId,omitempty"`
	UnlockEpoch  int64  `json:"unlockEpoch,omitempty"`
	IsLP         bool   `json:"isLp,omitempty"`
	SourcePoolID string `json:"sourcePoolId,omitempty"`
}

// GetRewardPrograms returns every x/rewards staking-reward program with LP
// classification and APR inputs. Bound to the frontend via Wails.
func (a *App) GetRewardPrograms() ([]RewardProgram, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}
	rewards, err := a.chainClient.GetAllStakingRewards()
	if err != nil {
		logging.Error("rewards", "GetAllStakingRewards failed: %v", err)
		return nil, fmt.Errorf("fetch reward programs: %w", err)
	}
	pools, err := amm.FetchLiquidityPools(a.chainClient)
	if err != nil {
		logging.Error("rewards", "pool fetch for LP classification failed: %v", err)
		return nil, err
	}
	return shapeRewardPrograms(rewards, pools), nil
}

// GetRewardPositions returns the address's joined reward programs with staked
// amounts and pending rewards. An empty address falls back to the active
// account. Bound to the frontend via Wails.
func (a *App) GetRewardPositions(address string) ([]RewardPosition, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}
	if address == "" {
		address = a.appState.GetActiveAddress()
	}
	if address == "" {
		return nil, fmt.Errorf("no address given and no active account")
	}
	programs, err := a.GetRewardPrograms()
	if err != nil {
		return nil, err
	}
	participants, err := a.chainClient.GetStakingRewardParticipants(address)
	if err != nil {
		logging.Error("rewards", "GetStakingRewardParticipants failed for %s: %v", address, err)
		return nil, fmt.Errorf("fetch reward positions: %w", err)
	}
	return shapeRewardPositions(participants, programs), nil
}

// GetPendingUnlocks returns the address's native unbondings and reward-program
// exit locks as one list with completion timestamps, soonest first. An empty
// address falls back to the active account. Bound to the frontend via Wails.
func (a *App) GetPendingUnlocks(address string) ([]PendingUnlock, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}
	if address == "" {
		address = a.appState.GetActiveAddress()
	}
	if address == "" {
		return nil, fmt.Errorf("no address given and no active account")
	}

	unbonding, err := a.chainClient.GetUnbondingDelegations(address)
	if err != nil {
		logging.Error("rewards", "GetUnbondingDelegations failed for %s: %v", address, err)
		return nil, fmt.Errorf("fetch unbonding delegations: %w", err)
	}
	params, err := a.chainClient.GetStakingParams()
	if err != nil {
		logging.Error("rewards", "GetStakingParams failed: %v", err)
		return nil, fmt.Errorf("fetch staking params: %w", err)
	}
	pending, err := a.chainClient.GetPendingUnlockParticipants()
	if err != nil {
		logging.Error("rewards", "GetPendingUnlockParticipants failed: %v", err)
		return nil, fmt.Errorf("fetch pending unlocks: %w", err)
	}
	pools, err := amm.FetchLiquidityPools(a.chainClient)
	if err != nil {
		logging.Error("rewards", "pool fetch for LP classification failed: %v", err)
		return nil, err
	}

	// The epoch timer only refines reward-unlock timestamps — a failure here
	// must not hide the unlocks themselves, so it degrades to no timestamp.
	var timer *unlockEpochTimer
	if info, err := a.chainClient.GetEpochInfo(rewardsEpochID); err != nil {
		logging.Error("rewards", "GetEpochInfo(%s) failed: %v", rewardsEpochID, err)
	} else {
		timer = &unlockEpochTimer{
			CurrentEpoch:      info.CurrentEpoch,
			CurrentEpochStart: info.CurrentEpochStartTime,
			Duration:          info.Duration,
		}
	}

	unlocks := shapeNativeUnlocks(unbonding, params.Params.BondDenom)
	unlocks = append(unlocks, shapeRewardUnlocks(pending, address, pools, timer)...)
	sort.SliceStable(unlocks, func(i, j int) bool {
		// Entries without a timestamp sort last.
		if unlocks[i].CompletionTime == "" || unlocks[j].CompletionTime == "" {
			return unlocks[j].CompletionTime == ""
		}
		return unlocks[i].CompletionTime < unlocks[j].CompletionTime
	})
	return unlocks, nil
}

// --- shaping (pure, unit-tested) --------------------------------------------

// shapeRewardPrograms converts chain reward programs to the binding shape,
// flagging LP programs and resolving their source pool by LP denom.
func shapeRewardPrograms(rewards []rewardstypes.StakingReward, pools []amm.Pool) []RewardProgram {
	out := make([]RewardProgram, 0, len(rewards))
	for _, r := range rewards {
		p := RewardProgram{
			RewardID:         r.RewardId,
			PrizeAmount:      r.PrizeAmount,
			PrizeDenom:       r.PrizeDenom,
			StakingDenom:     r.StakingDenom,
			Duration:         r.Duration,
			Payouts:          r.Payouts,
			MinStake:         strconv.FormatUint(r.MinStake, 10),
			Lock:             r.Lock,
			StakedAmount:     r.StakedAmount,
			DistributedStake: r.DistributedStake,
		}
		p.IsLP, p.SourcePoolID = classifyLPDenom(r.StakingDenom, pools)
		out = append(out, p)
	}
	return out
}

// shapeRewardPositions joins the address's participations with their programs.
// A participation whose program is missing from the list (program expired but
// stake not yet withdrawn) is still returned, with zero pending rewards and
// only the participant's own fields.
func shapeRewardPositions(participants []rewardstypes.StakingRewardParticipant, programs []RewardProgram) []RewardPosition {
	byID := make(map[string]RewardProgram, len(programs))
	for _, p := range programs {
		byID[p.RewardID] = p
	}
	out := make([]RewardPosition, 0, len(participants))
	for _, part := range participants {
		pos := RewardPosition{
			RewardID:       part.RewardId,
			Amount:         part.Amount,
			JoinedAt:       part.JoinedAt,
			PendingRewards: "0",
		}
		if prog, ok := byID[part.RewardId]; ok {
			pos.StakingDenom = prog.StakingDenom
			pos.PrizeDenom = prog.PrizeDenom
			pos.Lock = prog.Lock
			pos.IsLP = prog.IsLP
			pos.SourcePoolID = prog.SourcePoolID
			pos.PendingRewards = pendingRewardsAmount(part.Amount, prog.DistributedStake, part.JoinedAt)
		}
		out = append(out, pos)
	}
	return out
}

// pendingRewardsAmount is the web calculateRewardsStakingPendingRewards:
// deposited × (distributedStake − joinedAt), rounded half-up to an integer.
// Malformed or negative inputs yield "0" (a payout can never be negative).
func pendingRewardsAmount(amount, distributedStake, joinedAt string) string {
	deposited, err := sdkmath.LegacyNewDecFromStr(amount)
	if err != nil {
		return "0"
	}
	distr, err := sdkmath.LegacyNewDecFromStr(zeroIfEmpty(distributedStake))
	if err != nil {
		return "0"
	}
	joined, err := sdkmath.LegacyNewDecFromStr(zeroIfEmpty(joinedAt))
	if err != nil {
		return "0"
	}
	pending := deposited.Mul(distr.Sub(joined))
	if pending.IsNegative() {
		return "0"
	}
	// Half-up rounding via floor(x+0.5): BigNumber's default ROUND_HALF_UP.
	// LegacyDec.RoundInt would round half-to-even (0.5 → 0) and drift from the web.
	return pending.Add(sdkmath.LegacyNewDecWithPrec(5, 1)).TruncateInt().String()
}

// unlockEpochTimer is the slice of the chain epoch info needed to turn an
// unlock epoch number into a wall-clock timestamp.
type unlockEpochTimer struct {
	CurrentEpoch      int64
	CurrentEpochStart time.Time
	Duration          time.Duration
}

// completionTime projects when the given epoch number is reached. Epochs in
// the past (unlock already due) resolve to a past timestamp, which the UI
// renders as "unlocking now".
func (t *unlockEpochTimer) completionTime(epoch int64) time.Time {
	return t.CurrentEpochStart.Add(time.Duration(epoch-t.CurrentEpoch) * t.Duration)
}

// shapeNativeUnlocks flattens unbonding delegations (one entry per unbonding
// operation) into unified pending unlocks. The denom is the chain's bond denom
// from staking params — never hardcoded.
func shapeNativeUnlocks(unbonding []stakingtypes.UnbondingDelegation, bondDenom string) []PendingUnlock {
	var out []PendingUnlock
	for _, u := range unbonding {
		for _, e := range u.Entries {
			out = append(out, PendingUnlock{
				Type:             UnlockTypeNative,
				Denom:            bondDenom,
				Amount:           e.Balance.String(),
				CompletionTime:   e.CompletionTime.UTC().Format(time.RFC3339),
				ValidatorAddress: u.ValidatorAddress,
			})
		}
	}
	return out
}

// shapeRewardUnlocks filters the chain's full pending-unlock list down to the
// address and converts each entry. The entry's Index encodes
// "{unlockEpoch}/{rewardId}/{address}" (x/rewards CreatePendingUnlockParticipantKey);
// timer turns the epoch into a timestamp and may be nil (timestamp omitted).
func shapeRewardUnlocks(pending []rewardstypes.PendingUnlockParticipant, address string, pools []amm.Pool, timer *unlockEpochTimer) []PendingUnlock {
	var out []PendingUnlock
	for _, p := range pending {
		if p.Address != address {
			continue
		}
		epoch, rewardID := parsePendingUnlockIndex(p.Index)
		u := PendingUnlock{
			Type:        UnlockTypeReward,
			Denom:       p.Denom,
			Amount:      p.Amount,
			RewardID:    rewardID,
			UnlockEpoch: epoch,
		}
		u.IsLP, u.SourcePoolID = classifyLPDenom(p.Denom, pools)
		if timer != nil && epoch > 0 {
			u.CompletionTime = timer.completionTime(epoch).UTC().Format(time.RFC3339)
		}
		out = append(out, u)
	}
	return out
}

// parsePendingUnlockIndex splits an x/rewards pending-unlock index
// "{unlockEpoch}/{rewardId}/{address}". A malformed index yields (0, "").
func parsePendingUnlockIndex(index string) (epoch int64, rewardID string) {
	parts := strings.SplitN(index, "/", 3)
	if len(parts) != 3 {
		return 0, ""
	}
	epoch, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, ""
	}
	return epoch, parts[1]
}

// classifyLPDenom reports whether denom is an AMM LP share token and, if so,
// the id of the pool it belongs to ("" when no pool matches — e.g. the pool
// list was fetched from a different network).
func classifyLPDenom(denom string, pools []amm.Pool) (bool, string) {
	if !assets.IsLP(denom) {
		return false, ""
	}
	for _, pool := range pools {
		if pool.LPDenom == denom {
			return true, pool.ID
		}
	}
	return true, ""
}

// zeroIfEmpty maps the chain's empty decimal string to "0" so LegacyDec parses it.
func zeroIfEmpty(s string) string {
	if s == "" {
		return "0"
	}
	return s
}
