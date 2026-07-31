package chain

import (
	"context"
	"fmt"

	epochstypes "github.com/bze-alphateam/bze/x/epochs/types"
)

// GetCurrentEpoch returns the current epoch number for the given epoch identifier
// (e.g. "hour", "day"). The x/rewards module schedules pending unlocks on the
// "hour" epoch, so the current "hour" epoch lets the UI compute how many epochs
// (≈ hours) remain before a pending unlock completes.
func (c *Client) GetCurrentEpoch(identifier string) (int64, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return 0, err
	}

	qc := epochstypes.NewQueryClient(conn)
	resp, err := qc.CurrentEpoch(context.Background(), &epochstypes.QueryCurrentEpochRequest{
		Identifier: identifier,
	})
	if err != nil {
		return 0, err
	}
	return resp.CurrentEpoch, nil
}

// GetEpochInfo returns the full epoch timer for the given identifier — current
// epoch number, current epoch start time, and tick duration. Unlike
// GetCurrentEpoch this lets a caller turn "unlocks at epoch N" into a wall-clock
// completion timestamp using only chain data (no hardcoded epoch length).
func (c *Client) GetEpochInfo(identifier string) (*epochstypes.EpochInfo, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := epochstypes.NewQueryClient(conn)
	resp, err := qc.EpochInfos(context.Background(), &epochstypes.QueryEpochsInfoRequest{})
	if err != nil {
		return nil, err
	}
	for i := range resp.Epochs {
		if resp.Epochs[i].Identifier == identifier {
			return &resp.Epochs[i], nil
		}
	}
	return nil, fmt.Errorf("epoch identifier %q not found", identifier)
}
