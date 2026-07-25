package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"sync"

	"github.com/bze-alphateam/bze-hub/internal/crypto"
	"github.com/bze-alphateam/bze-hub/internal/logging"
	"github.com/cosmos/cosmos-sdk/codec"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	gogoproto "github.com/cosmos/gogoproto/proto"
)

// Gas is estimated per-tx via simulation, never hardcoded. These tune the
// estimate: gasAdjustment pads the simulated gas (sims slightly under-count),
// and gasPriceUbze sets the fee per gas unit. The BZE chain minimum is
// 0.01 ubze/gas (bze-configs app.toml); 0.02 adds headroom.
const (
	gasAdjustment = 1.5
	gasPriceUbze  = 0.02
)

// GetStakingOverview fetches all staking data (native + rewards) in parallel.
// Returns a combined map with keys: validators, delegatedValidators,
// availableBalance, delegations, unbonding, rewards, pool, stakingParams,
// annualProvisions, distributionParams, stakingRewards, rewardParticipants,
// pendingUnlocks.
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

	// Full validator objects for the validators this address delegated to —
	// includes jailed/unbonded validators (the bonded-only list above does not),
	// which stake-health detection needs to flag a delegation that stopped earning.
	wg.Add(1)
	go func() {
		defer wg.Done()
		if address == "" {
			return
		}
		delVals, err := a.chainClient.GetDelegatorValidators(address)
		if err != nil {
			logging.Error("staking", "GetDelegatorValidators failed: %v", err)
			setError(err)
			return
		}
		set("delegatedValidators", codecMarshalSlice(cdc, delVals))
	}()

	// Liquid (spendable) ubze balance — the "available" figure in the compact view.
	wg.Add(1)
	go func() {
		defer wg.Done()
		if address == "" {
			return
		}
		bal, err := a.chainClient.RestGet(fmt.Sprintf("/cosmos/bank/v1beta1/balances/%s/by_denom?denom=ubze", address))
		if err != nil {
			logging.Error("staking", "available balance fetch failed: %v", err)
			setError(err)
			return
		}
		// REST shape: { "balance": { "denom": "ubze", "amount": "..." } }
		set("availableBalance", bal["balance"])
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

	// Current "hour" epoch — reward-program unlocks are scheduled on this epoch, so
	// the UI uses it to show ≈hours remaining on a pending reward unlock.
	wg.Add(1)
	go func() {
		defer wg.Done()
		epoch, err := a.chainClient.GetCurrentEpoch("hour")
		if err != nil {
			logging.Error("staking", "GetCurrentEpoch(hour) failed: %v", err)
			setError(err)
			return
		}
		set("currentHourEpoch", epoch)
	}()

	wg.Wait()

	if firstErr != nil {
		logging.Error("staking", "GetStakingOverview partial failure: %v", firstErr)
	}

	return result, nil
}

// SignAndBroadcast builds, signs (SIGN_MODE_DIRECT), encodes, and broadcasts a
// transaction. msgsJSON is a JSON array of protobuf messages, each an object with
// an "@type" field (e.g. {"@type":"/cosmos.staking.v1beta1.MsgDelegate", ...}).
// This is the correct path: it produces a real protobuf TxRaw, unlike the old
// frontend flow which base64-encoded a JSON blob (causing "tx parse error").
func (a *App) SignAndBroadcast(signer string, msgsJSON string, memo string) (map[string]interface{}, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}
	if signer == "" {
		signer = a.store.ActiveAddress
	}

	msgs, err := a.chainClient.DecodeMsgsJSON(msgsJSON)
	if err != nil {
		logging.Error("staking", "decode messages failed: %v", err)
		return nil, fmt.Errorf("decode messages: %w", err)
	}

	privKey, err := a.wallet.PrivKey(signer, a.password)
	if err != nil {
		return nil, fmt.Errorf("load signing key: %w", err)
	}
	defer crypto.SecureZero(privKey.Key)

	// Account number + sequence for the signer.
	base, err := a.baseAccount(signer)
	if err != nil {
		return nil, err
	}
	chainID := a.chainID()

	// Estimate gas by simulating, then pad it and derive the fee. Never hardcoded.
	simGas, err := a.chainClient.SimulateGas(msgs, privKey, chainID, base.AccountNumber, base.Sequence, memo)
	if err != nil {
		logging.Error("staking", "gas simulation failed: %v", err)
		return nil, fmt.Errorf("estimate gas: %w", err)
	}
	gasLimit, fee := feeFromSimGas(simGas)
	logging.Info("staking", "gas: simulated=%d adjusted=%d fee=%v", simGas, gasLimit, fee)

	txBytes, err := a.chainClient.BuildSignedTxBytes(
		msgs, privKey, chainID, base.AccountNumber, base.Sequence, fee, gasLimit, memo,
	)
	if err != nil {
		logging.Error("staking", "build/sign tx failed: %v", err)
		return nil, fmt.Errorf("build tx: %w", err)
	}

	body, err := json.Marshal(map[string]interface{}{
		"tx_bytes": base64.StdEncoding.EncodeToString(txBytes),
		"mode":     "BROADCAST_MODE_SYNC",
	})
	if err != nil {
		return nil, fmt.Errorf("marshal broadcast body: %w", err)
	}

	proxyREST := fmt.Sprintf("http://localhost:%d", a.settings.ProxyRESTPort)
	url := proxyREST + "/cosmos/tx/v1beta1/txs"
	logging.Info("staking", "broadcasting tx (%d msg(s), signer %s) via %s", len(msgs), signer, url)

	resp, err := a.httpPost(url, string(body))
	if err != nil {
		logging.Error("staking", "broadcast transport error: %v", err)
		return nil, fmt.Errorf("broadcast tx: %w", err)
	}

	logBroadcastResult(resp)
	return resp, nil
}

// EstimateTxFee simulates the given messages and returns the fee the tx would pay,
// without signing for broadcast or touching the mempool. It runs the exact same
// path SignAndBroadcast uses to price a tx — simulate gas → ×1.5 adjustment →
// 0.02 ubze/gas — so the preview a user sees matches what they'll actually pay.
// Returns {"gas": <adjusted gas limit>, "amount": "<ubze fee>", "denom": "ubze"}.
// The signing key is loaded only to build the simulation tx (the BZE ante handler
// inspects signer info even in simulation) and is zeroed immediately after.
func (a *App) EstimateTxFee(signer string, msgsJSON string, memo string) (map[string]interface{}, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}
	if signer == "" {
		signer = a.store.ActiveAddress
	}

	msgs, err := a.chainClient.DecodeMsgsJSON(msgsJSON)
	if err != nil {
		return nil, fmt.Errorf("decode messages: %w", err)
	}

	privKey, err := a.wallet.PrivKey(signer, a.password)
	if err != nil {
		return nil, fmt.Errorf("load signing key: %w", err)
	}
	defer crypto.SecureZero(privKey.Key)

	base, err := a.baseAccount(signer)
	if err != nil {
		return nil, err
	}

	simGas, err := a.chainClient.SimulateGas(msgs, privKey, a.chainID(), base.AccountNumber, base.Sequence, memo)
	if err != nil {
		logging.Error("staking", "fee estimate simulation failed: %v", err)
		return nil, fmt.Errorf("estimate gas: %w", err)
	}
	gasLimit, fee := feeFromSimGas(simGas)

	return map[string]interface{}{
		"gas":    gasLimit,
		"amount": fee.AmountOf("ubze").String(),
		"denom":  "ubze",
	}, nil
}

// feeFromSimGas turns a simulated gas figure into the padded gas limit and the fee
// coins the tx should carry: gas × gasAdjustment, then × gasPriceUbze ubze/gas.
// The single place this arithmetic lives, shared by broadcast and fee preview.
func feeFromSimGas(simGas uint64) (uint64, sdk.Coins) {
	gasLimit := uint64(math.Ceil(float64(simGas) * gasAdjustment))
	feeUbze := int64(math.Ceil(float64(gasLimit) * gasPriceUbze))
	return gasLimit, sdk.NewCoins(sdk.NewInt64Coin("ubze", feeUbze))
}

// baseAccount fetches the signer's on-chain account and unpacks its number and
// sequence — the auth info every signed/simulated tx needs. A never-seen account
// (nil Account) yields a zero-valued BaseAccount, which is correct for a first tx.
func (a *App) baseAccount(signer string) (authtypes.BaseAccount, error) {
	var base authtypes.BaseAccount
	acctResp, err := a.chainClient.GetAccount(signer)
	if err != nil {
		return base, fmt.Errorf("get account: %w", err)
	}
	if acctResp.Account != nil {
		if err := unpackAccount(acctResp.Account, &base); err != nil {
			return base, fmt.Errorf("unpack account: %w", err)
		}
	}
	return base, nil
}

// chainID resolves the chain id to sign for: the remote config's value when
// available, else the beezee-1 mainnet default.
func (a *App) chainID() string {
	if a.remoteConfig != nil && a.remoteConfig.ChainID != "" {
		return a.remoteConfig.ChainID
	}
	return "beezee-1"
}

// GetTxStatus looks up a previously-broadcast tx by hash to confirm its on-chain
// result. In BROADCAST_MODE_SYNC the broadcast only confirms mempool acceptance
// (CheckTx); the final DeliverTx result is known only once the tx is included in a
// block. Returns {found:false} while the tx is still pending (not yet in a block),
// or {found:true, code, rawLog, txhash} once committed (code 0 = success, non-zero
// = in-block failure). Callers poll this for a few seconds after a successful
// broadcast before declaring the tx done.
func (a *App) GetTxStatus(hash string) (map[string]interface{}, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}
	if hash == "" {
		return nil, fmt.Errorf("empty tx hash")
	}

	resp, err := a.chainClient.RestGet("/cosmos/tx/v1beta1/txs/" + hash)
	if err != nil {
		// Transport/parse error — treat as not-yet-available rather than failing.
		logging.Debug("staking", "GetTxStatus %s: %v", hash, err)
		return map[string]interface{}{"found": false}, nil
	}

	o := parseBroadcastOutcome(resp)
	if !o.HasResponse {
		// Not in a block yet (REST returns a not-found error body, no tx_response).
		return map[string]interface{}{"found": false}, nil
	}
	return map[string]interface{}{
		"found":  true,
		"code":   o.Code,
		"rawLog": o.RawLog,
		"txhash": o.TxHash,
	}, nil
}

// broadcastOutcome is the parsed result of a tx broadcast response.
type broadcastOutcome struct {
	HasResponse bool
	Code        int // 0 = accepted; non-zero = rejected (CheckTx error)
	TxHash      string
	RawLog      string
	Codespace   string
}

// parseBroadcastOutcome extracts the tx_response fields from a Cosmos REST
// broadcast response. Kept pure (no logging/IO) so it can be unit-tested.
func parseBroadcastOutcome(resp map[string]interface{}) broadcastOutcome {
	tr, ok := resp["tx_response"].(map[string]interface{})
	if !ok {
		return broadcastOutcome{}
	}
	o := broadcastOutcome{HasResponse: true, Code: asInt(tr["code"])}
	o.TxHash, _ = tr["txhash"].(string)
	o.RawLog, _ = tr["raw_log"].(string)
	o.Codespace, _ = tr["codespace"].(string)
	return o
}

// logBroadcastResult surfaces a tx's acceptance result in the app logs — without
// it a failed tx is silent server-side (the frontend only logs to the webview
// console). NOTE: in BROADCAST_MODE_SYNC, code==0 means the tx passed CheckTx and
// entered the mempool; it can still fail later in DeliverTx. Confirming final
// execution requires querying the tx by hash.
func logBroadcastResult(resp map[string]interface{}) {
	o := parseBroadcastOutcome(resp)
	if !o.HasResponse {
		logging.Error("staking", "broadcast returned no tx_response: %v", resp)
		return
	}
	if o.Code == 0 {
		logging.Info("staking", "tx accepted into mempool (txhash: %s)", o.TxHash)
		return
	}
	logging.Error("staking", "tx REJECTED — code=%d codespace=%q txhash=%s raw_log=%s",
		o.Code, o.Codespace, o.TxHash, o.RawLog)
}

// asInt coerces a JSON-decoded value (float64 or string) to int.
func asInt(v interface{}) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case string:
		i, _ := strconv.Atoi(n)
		return i
	}
	return 0
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
