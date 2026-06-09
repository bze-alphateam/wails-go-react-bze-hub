package chain

import (
	"context"

	"github.com/cosmos/cosmos-sdk/types/query"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	disttypes "github.com/cosmos/cosmos-sdk/x/distribution/types"
	stakingtypes "github.com/cosmos/cosmos-sdk/x/staking/types"
)

// GetValidators returns validators filtered by status.
func (c *Client) GetValidators(status string) ([]stakingtypes.Validator, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := stakingtypes.NewQueryClient(conn)
	resp, err := qc.Validators(context.Background(), &stakingtypes.QueryValidatorsRequest{
		Status: status,
		Pagination: &query.PageRequest{
			Limit: 500,
		},
	})
	if err != nil {
		return nil, err
	}

	return resp.GetValidators(), nil
}

// GetDelegations returns all delegations for an address.
func (c *Client) GetDelegations(address string) ([]stakingtypes.DelegationResponse, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := stakingtypes.NewQueryClient(conn)
	resp, err := qc.DelegatorDelegations(context.Background(), &stakingtypes.QueryDelegatorDelegationsRequest{
		DelegatorAddr: address,
		Pagination: &query.PageRequest{
			Limit: 1000,
		},
	})
	if err != nil {
		return nil, err
	}

	return resp.GetDelegationResponses(), nil
}

// GetDelegatorValidators returns the full validator objects for every validator
// the address has delegated to. Unlike GetValidators("BOND_STATUS_BONDED"), this
// includes jailed/unbonded validators — which is exactly what stake-health
// detection needs (a jailed validator no longer pays rewards but the delegation
// still exists).
func (c *Client) GetDelegatorValidators(address string) ([]stakingtypes.Validator, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := stakingtypes.NewQueryClient(conn)
	resp, err := qc.DelegatorValidators(context.Background(), &stakingtypes.QueryDelegatorValidatorsRequest{
		DelegatorAddr: address,
		Pagination: &query.PageRequest{
			Limit: 1000,
		},
	})
	if err != nil {
		return nil, err
	}

	return resp.GetValidators(), nil
}

// GetUnbondingDelegations returns all unbonding delegations for an address.
func (c *Client) GetUnbondingDelegations(address string) ([]stakingtypes.UnbondingDelegation, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := stakingtypes.NewQueryClient(conn)
	resp, err := qc.DelegatorUnbondingDelegations(context.Background(), &stakingtypes.QueryDelegatorUnbondingDelegationsRequest{
		DelegatorAddr: address,
		Pagination: &query.PageRequest{
			Limit: 1000,
		},
	})
	if err != nil {
		return nil, err
	}

	return resp.GetUnbondingResponses(), nil
}

// GetDelegationRewards returns total delegation rewards for an address.
func (c *Client) GetDelegationRewards(address string) (*disttypes.QueryDelegationTotalRewardsResponse, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := disttypes.NewQueryClient(conn)
	return qc.DelegationTotalRewards(context.Background(), &disttypes.QueryDelegationTotalRewardsRequest{
		DelegatorAddress: address,
	})
}

// GetStakingPool returns the staking pool (bonded + not-bonded tokens).
func (c *Client) GetStakingPool() (*stakingtypes.QueryPoolResponse, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := stakingtypes.NewQueryClient(conn)
	return qc.Pool(context.Background(), &stakingtypes.QueryPoolRequest{})
}

// GetStakingParams returns the staking module parameters.
func (c *Client) GetStakingParams() (*stakingtypes.QueryParamsResponse, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := stakingtypes.NewQueryClient(conn)
	return qc.Params(context.Background(), &stakingtypes.QueryParamsRequest{})
}

// GetAnnualProvisions returns the current annual provisions from the mint module.
// Uses REST instead of gRPC because the response contains math.LegacyDec which
// panics during gRPC protobuf unmarshal with newer protobuf versions.
func (c *Client) GetAnnualProvisions() (map[string]interface{}, error) {
	return c.RestGet("/cosmos/mint/v1beta1/annual_provisions")
}

// GetDistributionParams returns the distribution module parameters.
func (c *Client) GetDistributionParams() (*disttypes.QueryParamsResponse, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := disttypes.NewQueryClient(conn)
	return qc.Params(context.Background(), &disttypes.QueryParamsRequest{})
}

// GetAccount returns the account info (for sequence/account_number needed in signing).
func (c *Client) GetAccount(address string) (*authtypes.QueryAccountResponse, error) {
	conn, err := c.GetConnection()
	if err != nil {
		return nil, err
	}

	qc := authtypes.NewQueryClient(conn)
	return qc.Account(context.Background(), &authtypes.QueryAccountRequest{
		Address: address,
	})
}
