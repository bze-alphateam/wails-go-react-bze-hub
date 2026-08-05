package main

import (
	"testing"
	"time"

	sdkmath "cosmossdk.io/math"
	"github.com/bze-alphateam/bze-hub/internal/amm"
	rewardstypes "github.com/bze-alphateam/bze/x/rewards/types"
	stakingtypes "github.com/cosmos/cosmos-sdk/x/staking/types"
)

var testPools = []amm.Pool{
	{ID: "7", Base: "ubze", Quote: "uvdl", LPDenom: "ulp/abc123"},
	{ID: "9", Base: "ubze", Quote: "utbz", LPDenom: "ulp_ubze_utbz"},
}

func TestShapeRewardProgramsClassifiesLP(t *testing.T) {
	rewards := []rewardstypes.StakingReward{
		{RewardId: "1", StakingDenom: "ubze", PrizeDenom: "uvdl", PrizeAmount: "5000",
			Duration: 100, Payouts: 10, MinStake: 1000000, Lock: 5,
			StakedAmount: "900000", DistributedStake: "0.5"},
		{RewardId: "2", StakingDenom: "ulp/abc123", PrizeDenom: "ubze", PrizeAmount: "100"},
		{RewardId: "3", StakingDenom: "ulp/unknown", PrizeDenom: "ubze"},
	}

	out := shapeRewardPrograms(rewards, testPools)
	if len(out) != 3 {
		t.Fatalf("expected 3 programs, got %d", len(out))
	}

	plain := out[0]
	if plain.IsLP || plain.SourcePoolID != "" {
		t.Errorf("plain-token program classified as LP: %+v", plain)
	}
	if plain.MinStake != "1000000" {
		t.Errorf("minStake = %q, want string \"1000000\"", plain.MinStake)
	}
	if plain.PrizeAmount != "5000" || plain.StakedAmount != "900000" || plain.DistributedStake != "0.5" {
		t.Errorf("raw APR inputs not passed through: %+v", plain)
	}
	if plain.Duration != 100 || plain.Payouts != 10 || plain.Lock != 5 {
		t.Errorf("durations not passed through: %+v", plain)
	}

	lp := out[1]
	if !lp.IsLP || lp.SourcePoolID != "7" {
		t.Errorf("LP program not linked to pool 7: %+v", lp)
	}

	// LP denom with no matching pool stays flagged but without a pool ref.
	orphanLP := out[2]
	if !orphanLP.IsLP || orphanLP.SourcePoolID != "" {
		t.Errorf("unmatched LP program misclassified: %+v", orphanLP)
	}
}

func TestShapeRewardProgramsLegacyLPDenom(t *testing.T) {
	out := shapeRewardPrograms([]rewardstypes.StakingReward{
		{RewardId: "4", StakingDenom: "ulp_ubze_utbz"},
	}, testPools)
	if !out[0].IsLP || out[0].SourcePoolID != "9" {
		t.Errorf("legacy ulp_ denom not linked to pool 9: %+v", out[0])
	}
}

func TestShapeRewardPositions(t *testing.T) {
	programs := shapeRewardPrograms([]rewardstypes.StakingReward{
		{RewardId: "1", StakingDenom: "ulp/abc123", PrizeDenom: "uvdl", Lock: 14, DistributedStake: "0.75"},
	}, testPools)
	participants := []rewardstypes.StakingRewardParticipant{
		{Address: "bze1abc", RewardId: "1", Amount: "1000", JoinedAt: "0.25"},
		{Address: "bze1abc", RewardId: "99", Amount: "50", JoinedAt: "1"}, // program gone (expired)
	}

	out := shapeRewardPositions(participants, programs)
	if len(out) != 2 {
		t.Fatalf("expected 2 positions, got %d", len(out))
	}

	pos := out[0]
	if pos.StakingDenom != "ulp/abc123" || pos.PrizeDenom != "uvdl" || pos.Lock != 14 {
		t.Errorf("program fields not joined: %+v", pos)
	}
	if !pos.IsLP || pos.SourcePoolID != "7" {
		t.Errorf("LP classification not carried to position: %+v", pos)
	}
	// 1000 × (0.75 − 0.25) = 500
	if pos.PendingRewards != "500" {
		t.Errorf("pendingRewards = %q, want 500", pos.PendingRewards)
	}

	orphan := out[1]
	if orphan.StakingDenom != "" || orphan.PendingRewards != "0" {
		t.Errorf("orphan participation should keep its own fields only: %+v", orphan)
	}
	if orphan.Amount != "50" || orphan.RewardID != "99" {
		t.Errorf("orphan participant fields lost: %+v", orphan)
	}
}

func TestPendingRewardsAmount(t *testing.T) {
	cases := []struct {
		name                        string
		amount, distributed, joined string
		want                        string
	}{
		{"basic", "1000", "0.75", "0.25", "500"},
		{"nothing distributed since join", "1000", "0.5", "0.5", "0"},
		{"rounds half up like the web", "1", "0.5", "0", "1"}, // 0.5 → 1 (BigNumber ROUND_HALF_UP)
		{"rounds down below half", "1", "0.4", "0", "0"},
		{"joined after snapshot (never negative)", "1000", "0.25", "0.75", "0"},
		{"empty decimals", "1000", "", "", "0"},
		{"malformed amount", "not-a-number", "0.5", "0", "0"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pendingRewardsAmount(tc.amount, tc.distributed, tc.joined); got != tc.want {
				t.Errorf("pendingRewardsAmount(%q, %q, %q) = %q, want %q",
					tc.amount, tc.distributed, tc.joined, got, tc.want)
			}
		})
	}
}

func TestParsePendingUnlockIndex(t *testing.T) {
	epoch, rewardID := parsePendingUnlockIndex("53064/12/bze1abc")
	if epoch != 53064 || rewardID != "12" {
		t.Errorf("got (%d, %q), want (53064, \"12\")", epoch, rewardID)
	}

	for _, malformed := range []string{"", "12", "12/34", "notanumber/12/bze1abc"} {
		epoch, rewardID = parsePendingUnlockIndex(malformed)
		if epoch != 0 || rewardID != "" {
			t.Errorf("parsePendingUnlockIndex(%q) = (%d, %q), want (0, \"\")", malformed, epoch, rewardID)
		}
	}
}

func TestShapeNativeUnlocks(t *testing.T) {
	completion := time.Date(2026, 8, 15, 12, 0, 0, 0, time.UTC)
	unbonding := []stakingtypes.UnbondingDelegation{
		{
			DelegatorAddress: "bze1abc",
			ValidatorAddress: "bzevaloper1xyz",
			Entries: []stakingtypes.UnbondingDelegationEntry{
				{Balance: sdkmath.NewInt(1000), CompletionTime: completion},
				{Balance: sdkmath.NewInt(2500), CompletionTime: completion.Add(24 * time.Hour)},
			},
		},
	}

	out := shapeNativeUnlocks(unbonding, "ubze")
	if len(out) != 2 {
		t.Fatalf("expected 2 unlocks (one per entry), got %d", len(out))
	}
	first := out[0]
	if first.Type != UnlockTypeNative || first.Denom != "ubze" || first.Amount != "1000" {
		t.Errorf("unexpected native unlock: %+v", first)
	}
	if first.ValidatorAddress != "bzevaloper1xyz" {
		t.Errorf("validator not carried: %+v", first)
	}
	if first.CompletionTime != "2026-08-15T12:00:00Z" {
		t.Errorf("completionTime = %q", first.CompletionTime)
	}
}

func TestShapeRewardUnlocks(t *testing.T) {
	timer := &unlockEpochTimer{
		CurrentEpoch:      100,
		CurrentEpochStart: time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC),
		Duration:          time.Hour,
	}
	pending := []rewardstypes.PendingUnlockParticipant{
		{Index: "112/5/bze1abc", Address: "bze1abc", Amount: "700", Denom: "ulp/abc123"},
		{Index: "105/6/bze1other", Address: "bze1other", Amount: "1", Denom: "ubze"},
	}

	out := shapeRewardUnlocks(pending, "bze1abc", testPools, timer)
	if len(out) != 1 {
		t.Fatalf("expected only bze1abc's unlock, got %d entries", len(out))
	}
	u := out[0]
	if u.Type != UnlockTypeReward || u.RewardID != "5" || u.UnlockEpoch != 112 || u.Amount != "700" {
		t.Errorf("unexpected reward unlock: %+v", u)
	}
	if !u.IsLP || u.SourcePoolID != "7" {
		t.Errorf("LP classification missing on unlock: %+v", u)
	}
	// 12 epochs × 1h after the current epoch's start.
	if u.CompletionTime != "2026-08-01T22:00:00Z" {
		t.Errorf("completionTime = %q", u.CompletionTime)
	}
}

func TestShapeRewardUnlocksWithoutTimer(t *testing.T) {
	pending := []rewardstypes.PendingUnlockParticipant{
		{Index: "112/5/bze1abc", Address: "bze1abc", Amount: "700", Denom: "ubze"},
	}
	out := shapeRewardUnlocks(pending, "bze1abc", nil, nil)
	if len(out) != 1 {
		t.Fatalf("expected 1 unlock, got %d", len(out))
	}
	if out[0].CompletionTime != "" {
		t.Errorf("expected empty completionTime without epoch info, got %q", out[0].CompletionTime)
	}
	if out[0].UnlockEpoch != 112 {
		t.Errorf("unlock epoch should still parse: %+v", out[0])
	}
}
