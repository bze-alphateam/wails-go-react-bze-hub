package chain

import (
	"context"

	"github.com/bze-alphateam/bze/x/rewards/types"
	"github.com/cosmos/cosmos-sdk/types/query"
)

// GetAllStakingRewards returns all staking reward programs.
func (c *Client) GetAllStakingRewards() ([]types.StakingReward, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := types.NewQueryClient(conn)
	resp, err := qc.AllStakingRewards(context.Background(), &types.QueryAllStakingRewardsRequest{
		Pagination: &query.PageRequest{
			Limit:      1000,
			Reverse:    true,
			CountTotal: false,
		},
	})
	if err != nil {
		return nil, err
	}

	return resp.GetList(), nil
}

// GetStakingRewardParticipants returns a user's active staking reward participations.
func (c *Client) GetStakingRewardParticipants(address string) ([]types.StakingRewardParticipant, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := types.NewQueryClient(conn)
	resp, err := qc.StakingRewardParticipant(context.Background(), &types.QueryStakingRewardParticipantRequest{
		Address: address,
		Pagination: &query.PageRequest{
			Limit: 500,
		},
	})
	if err != nil {
		return nil, err
	}

	return resp.GetList(), nil
}

// GetPendingUnlockParticipants returns all pending unlock entries.
func (c *Client) GetPendingUnlockParticipants() ([]types.PendingUnlockParticipant, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := types.NewQueryClient(conn)
	resp, err := qc.AllPendingUnlockParticipants(context.Background(), &types.QueryAllPendingUnlockParticipantsRequest{
		Pagination: &query.PageRequest{
			Limit: 1000,
		},
	})
	if err != nil {
		return nil, err
	}

	return resp.GetList(), nil
}
