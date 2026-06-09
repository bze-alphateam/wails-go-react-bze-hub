package chain

import (
	"context"

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
