package main

import (
	"fmt"
	"testing"

	"github.com/bze-alphateam/bze-hub/internal/chain"
	sdk "github.com/cosmos/cosmos-sdk/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
)

const (
	testFrom = "bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk"
	testTo   = "bze1972aqfzdg29ugjln74edx0xvcg4ehvysjptk77"
)

// mockRest serves canned REST responses keyed by path.
type mockRest struct {
	responses map[string]map[string]interface{}
	err       error
	lastPath  string
}

func (m *mockRest) RestGet(path string) (map[string]interface{}, error) {
	m.lastPath = path
	if m.err != nil {
		return nil, m.err
	}
	if resp, ok := m.responses[path]; ok {
		return resp, nil
	}
	return map[string]interface{}{}, nil
}

// TestMsgSendDecodesThroughSigningCodec proves a MsgSend proto-JSON resolves to
// the concrete type through the very path SignAndBroadcast uses
// (chain.Client.DecodeMsgsJSON on the client's InterfaceRegistry). Without bank
// registered in NewClient this fails with "unable to resolve type URL".
func TestMsgSendDecodesThroughSigningCodec(t *testing.T) {
	c := chain.NewClient("", "", "", nil)

	msgsJSON := fmt.Sprintf(`[{
		"@type": "/cosmos.bank.v1beta1.MsgSend",
		"from_address": %q,
		"to_address": %q,
		"amount": [{"denom": "ubze", "amount": "1500000"}]
	}]`, testFrom, testTo)

	msgs, err := c.DecodeMsgsJSON(msgsJSON)
	if err != nil {
		t.Fatalf("decode MsgSend: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 msg, got %d", len(msgs))
	}

	send, ok := msgs[0].(*banktypes.MsgSend)
	if !ok {
		t.Fatalf("expected *banktypes.MsgSend, got %T", msgs[0])
	}
	if send.FromAddress != testFrom || send.ToAddress != testTo {
		t.Errorf("addresses = %s → %s, want %s → %s", send.FromAddress, send.ToAddress, testFrom, testTo)
	}
	if len(send.Amount) != 1 || send.Amount[0].Denom != "ubze" || send.Amount[0].Amount.String() != "1500000" {
		t.Errorf("amount = %v, want 1500000ubze", send.Amount)
	}
}

// A MsgSend must also survive the encode step, since SignAndBroadcast packs the
// decoded messages into the tx body as Any values.
func TestMsgSendRoundTripsThroughCodec(t *testing.T) {
	c := chain.NewClient("", "", "", nil)

	original := &banktypes.MsgSend{
		FromAddress: testFrom,
		ToAddress:   testTo,
		Amount:      sdk.NewCoins(sdk.NewInt64Coin("ubze", 1500000)),
	}

	encoded, err := c.Cdc.MarshalInterfaceJSON(original)
	if err != nil {
		t.Fatalf("marshal MsgSend: %v", err)
	}
	msgs, err := c.DecodeMsgsJSON("[" + string(encoded) + "]")
	if err != nil {
		t.Fatalf("re-decode MsgSend: %v", err)
	}
	if _, ok := msgs[0].(*banktypes.MsgSend); !ok {
		t.Fatalf("round-trip gave %T, want *banktypes.MsgSend", msgs[0])
	}
}

func TestFetchSpendableBalances(t *testing.T) {
	uvdl := "factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl"
	path := "/cosmos/bank/v1beta1/spendable_balances/" + testFrom + "?pagination.limit=1000"
	rest := &mockRest{responses: map[string]map[string]interface{}{
		path: {
			"balances": []interface{}{
				map[string]interface{}{"denom": "ubze", "amount": "1500000"},
				map[string]interface{}{"denom": uvdl, "amount": "42"},
			},
		},
	}}

	got, err := fetchSpendableBalances(rest, testFrom)
	if err != nil {
		t.Fatalf("fetchSpendableBalances: %v", err)
	}
	if rest.lastPath != path {
		t.Errorf("queried %q, want %q", rest.lastPath, path)
	}
	if got["ubze"] != "1500000" {
		t.Errorf("ubze = %q, want 1500000", got["ubze"])
	}
	if got[uvdl] != "42" {
		t.Errorf("%s = %q, want 42", uvdl, got[uvdl])
	}
	if len(got) != 2 {
		t.Errorf("got %d denoms, want 2", len(got))
	}
}

// An account with nothing spendable is a normal answer, not an error.
func TestFetchSpendableBalancesEmpty(t *testing.T) {
	rest := &mockRest{responses: map[string]map[string]interface{}{
		"/cosmos/bank/v1beta1/spendable_balances/" + testFrom + "?pagination.limit=1000": {
			"balances": []interface{}{},
		},
	}}

	got, err := fetchSpendableBalances(rest, testFrom)
	if err != nil {
		t.Fatalf("empty balances should not error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %v, want empty map", got)
	}
}

// A gateway error body (e.g. malformed address) must surface as an error rather
// than an empty map, which the Send UI would read as "0 spendable".
func TestFetchSpendableBalancesErrorBody(t *testing.T) {
	rest := &mockRest{responses: map[string]map[string]interface{}{
		"/cosmos/bank/v1beta1/spendable_balances/nonsense?pagination.limit=1000": {
			"code":    float64(3),
			"message": "decoding bech32 failed",
		},
	}}

	if _, err := fetchSpendableBalances(rest, "nonsense"); err == nil {
		t.Fatal("expected an error for a gateway error body")
	}
}

func TestFetchSpendableBalancesTransportError(t *testing.T) {
	rest := &mockRest{err: fmt.Errorf("connection refused")}

	if _, err := fetchSpendableBalances(rest, testFrom); err == nil {
		t.Fatal("expected an error when the REST call fails")
	}
}
