package main

import (
	"fmt"

	"github.com/bze-alphateam/bze-hub/internal/logging"
)

// restGetter is the subset of the chain client this file needs. Declared as an
// interface so the parsing can be exercised against a mocked REST response.
type restGetter interface {
	RestGet(path string) (map[string]interface{}, error)
}

// GetSpendableBalances returns denom→amount for the coins an address can spend
// right now. Spendable excludes locked/vesting balances (delegated stake is not
// in the bank balance at all), so it — not the raw balance — is the ceiling for
// a send and the basis for the Send UI's Max/fee math. Amounts are base-denom
// integer strings, as the chain returns them; no decimal conversion happens
// here. An empty address falls back to the active account. Bound to the
// frontend via Wails.
func (a *App) GetSpendableBalances(address string) (map[string]string, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}
	if address == "" {
		address = a.appState.GetActiveAddress()
	}
	if address == "" {
		return nil, fmt.Errorf("no address given and no active account")
	}
	return fetchSpendableBalances(a.chainClient, address)
}

// fetchSpendableBalances reads /cosmos/bank/v1beta1/spendable_balances/{address}
// through the REST proxy (the same proxy the asset engine uses) and flattens the
// coin list to denom→amount. Kept free of App state so it can be unit-tested.
func fetchSpendableBalances(rest restGetter, address string) (map[string]string, error) {
	resp, err := rest.RestGet("/cosmos/bank/v1beta1/spendable_balances/" + address + "?pagination.limit=1000")
	if err != nil {
		logging.Error("bank", "spendable balances fetch failed for %s: %v", address, err)
		return nil, fmt.Errorf("fetch spendable balances: %w", err)
	}

	// A funded or empty account both return a "balances" array; its absence means
	// the gateway answered with an error body instead. Failing loudly matters
	// here — silently returning an empty map would read as "0 spendable" and the
	// Send UI would cap the amount at zero.
	raw, ok := resp["balances"].([]interface{})
	if !ok {
		if msg, isErr := resp["message"].(string); isErr {
			logging.Error("bank", "spendable balances query rejected for %s: %s", address, msg)
			return nil, fmt.Errorf("spendable balances unavailable")
		}
		return nil, fmt.Errorf("unexpected spendable balances response")
	}

	out := make(map[string]string, len(raw))
	for _, b := range raw {
		coin, ok := b.(map[string]interface{})
		if !ok {
			continue
		}
		denom, _ := coin["denom"].(string)
		amount, _ := coin["amount"].(string)
		if denom == "" {
			continue
		}
		out[denom] = amount
	}
	return out, nil
}
