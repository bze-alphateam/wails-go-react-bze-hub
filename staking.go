package main

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/bze-alphateam/bze-hub/internal/logging"
	"github.com/cosmos/cosmos-sdk/codec"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	gogoproto "github.com/cosmos/gogoproto/proto"
)

// GetStakingOverview fetches all staking data (native + rewards) in parallel.
// Returns a combined map with keys: validators, delegations, unbonding, rewards,
// pool, stakingParams, annualProvisions, distributionParams, stakingRewards,
// rewardParticipants, pendingUnlocks.
func (a *App) GetStakingOverview(address string) (map[string]interface{}, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}

	cdc := a.chainClient.Cdc
	result := make(map[string]interface{})
	var mu sync.Mutex
	var wg sync.WaitGroup
	var firstErr error
	var errMu sync.Mutex

	setError := func(err error) {
		errMu.Lock()
		if firstErr == nil {
			firstErr = err
		}
		errMu.Unlock()
	}

	set := func(key string, val interface{}) {
		mu.Lock()
		result[key] = val
		mu.Unlock()
	}

	// Native staking queries
	wg.Add(1)
	go func() {
		defer wg.Done()
		vals, err := a.chainClient.GetValidators("BOND_STATUS_BONDED")
		if err != nil {
			logging.Error("staking", "GetValidators failed: %v", err)
			setError(err)
			return
		}
		set("validators", codecMarshalSlice(cdc, vals))
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		if address == "" {
			return
		}
		dels, err := a.chainClient.GetDelegations(address)
		if err != nil {
			logging.Error("staking", "GetDelegations failed: %v", err)
			setError(err)
			return
		}
		set("delegations", codecMarshalSlice(cdc, dels))
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		if address == "" {
			return
		}
		unbonding, err := a.chainClient.GetUnbondingDelegations(address)
		if err != nil {
			logging.Error("staking", "GetUnbondingDelegations failed: %v", err)
			setError(err)
			return
		}
		set("unbonding", codecMarshalSlice(cdc, unbonding))
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		if address == "" {
			return
		}
		rewards, err := a.chainClient.GetDelegationRewards(address)
		if err != nil {
			logging.Error("staking", "GetDelegationRewards failed: %v", err)
			setError(err)
			return
		}
		set("rewards", codecMarshalProto(cdc, rewards))
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		pool, err := a.chainClient.GetStakingPool()
		if err != nil {
			logging.Error("staking", "GetStakingPool failed: %v", err)
			setError(err)
			return
		}
		set("pool", codecMarshalProto(cdc, pool))
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		params, err := a.chainClient.GetStakingParams()
		if err != nil {
			logging.Error("staking", "GetStakingParams failed: %v", err)
			setError(err)
			return
		}
		set("stakingParams", codecMarshalProto(cdc, params))
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		provisions, err := a.chainClient.GetAnnualProvisions()
		if err != nil {
			logging.Error("staking", "GetAnnualProvisions failed: %v", err)
			setError(err)
			return
		}
		// Already a map from REST, no codec needed
		set("annualProvisions", provisions)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		distParams, err := a.chainClient.GetDistributionParams()
		if err != nil {
			logging.Error("staking", "GetDistributionParams failed: %v", err)
			setError(err)
			return
		}
		set("distributionParams", codecMarshalProto(cdc, distParams))
	}()

	// Rewards module queries
	wg.Add(1)
	go func() {
		defer wg.Done()
		rewards, err := a.chainClient.GetAllStakingRewards()
		if err != nil {
			logging.Error("staking", "GetAllStakingRewards failed: %v", err)
			setError(err)
			return
		}
		set("stakingRewards", marshalSlice(rewards))
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		if address == "" {
			return
		}
		participants, err := a.chainClient.GetStakingRewardParticipants(address)
		if err != nil {
			logging.Error("staking", "GetStakingRewardParticipants failed: %v", err)
			setError(err)
			return
		}
		set("rewardParticipants", marshalSlice(participants))
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		unlocks, err := a.chainClient.GetPendingUnlockParticipants()
		if err != nil {
			logging.Error("staking", "GetPendingUnlockParticipants failed: %v", err)
			setError(err)
			return
		}
		set("pendingUnlocks", marshalSlice(unlocks))
	}()

	wg.Wait()

	if firstErr != nil {
		logging.Error("staking", "GetStakingOverview partial failure: %v", firstErr)
	}

	return result, nil
}

// GetAccountInfo returns account_number and sequence for transaction signing.
func (a *App) GetAccountInfo(address string) (map[string]interface{}, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}

	resp, err := a.chainClient.GetAccount(address)
	if err != nil {
		return nil, fmt.Errorf("get account: %w", err)
	}

	var baseAccount authtypes.BaseAccount
	if resp.Account != nil {
		if err := unpackAccount(resp.Account, &baseAccount); err != nil {
			return nil, fmt.Errorf("unpack account: %w", err)
		}
	}

	return map[string]interface{}{
		"accountNumber": baseAccount.AccountNumber,
		"sequence":      baseAccount.Sequence,
		"address":       baseAccount.Address,
	}, nil
}

// BroadcastTx broadcasts a signed transaction via the REST proxy.
func (a *App) BroadcastTx(txJSON string) (map[string]interface{}, error) {
	proxyREST := fmt.Sprintf("http://localhost:%d", a.settings.ProxyRESTPort)
	url := proxyREST + "/cosmos/tx/v1beta1/txs"

	logging.Info("staking", "broadcasting tx via %s", url)

	resp, err := a.httpPost(url, txJSON)
	if err != nil {
		return nil, fmt.Errorf("broadcast tx: %w", err)
	}

	return resp, nil
}

// --- helpers ---

// codecMarshalProto marshals a gogoproto.Message using the Cosmos SDK codec (handles Any types correctly).
func codecMarshalProto(cdc *codec.ProtoCodec, msg gogoproto.Message) interface{} {
	jsonBytes, err := cdc.MarshalJSON(msg)
	if err != nil {
		logging.Error("staking", "codec marshal failed: %v", err)
		return nil
	}
	var out interface{}
	json.Unmarshal(jsonBytes, &out)
	return out
}

// codecMarshalSlice marshals a slice of structs whose pointer type implements gogoproto.Message.
func codecMarshalSlice[T any, PT interface {
	*T
	gogoproto.Message
}](cdc *codec.ProtoCodec, items []T) []interface{} {
	result := make([]interface{}, len(items))
	for i := range items {
		result[i] = codecMarshalProto(cdc, PT(&items[i]))
	}
	return result
}

// marshalSlice converts a slice of any struct to []interface{} via standard JSON (for non-cosmos types).
func marshalSlice[T any](items []T) []interface{} {
	result := make([]interface{}, len(items))
	for i, item := range items {
		data, err := json.Marshal(item)
		if err != nil {
			result[i] = nil
			continue
		}
		var out interface{}
		json.Unmarshal(data, &out)
		result[i] = out
	}
	return result
}

// unpackAccount unpacks a protobuf Any into a BaseAccount.
func unpackAccount(any *codectypes.Any, target *authtypes.BaseAccount) error {
	if any == nil {
		return fmt.Errorf("nil account")
	}
	return target.Unmarshal(any.Value)
}
