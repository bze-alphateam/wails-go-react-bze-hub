package main

import (
	"testing"

	"github.com/bze-alphateam/bze-hub/internal/chain"
	tradebintypes "github.com/bze-alphateam/bze/x/tradebin/types"
)

// TestMsgMultiSwapDecodesThroughSigningCodec proves a MsgMultiSwap proto-JSON
// resolves to the concrete tradebin type through the exact path
// SignAndBroadcast uses (chain.Client.DecodeMsgsJSON on the client's
// InterfaceRegistry). Without tradebintypes.RegisterInterfaces in NewClient this
// fails with "unable to resolve type URL /bze.tradebin.MsgMultiSwap", so a swap
// could never be signed.
func TestMsgMultiSwapDecodesThroughSigningCodec(t *testing.T) {
	c := chain.NewClient("", "", "", nil)

	msgsJSON := `[{
		"@type": "/bze.tradebin.MsgMultiSwap",
		"creator": "bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk",
		"routes": ["1", "2"],
		"input": {"denom": "ubze", "amount": "1000000"},
		"min_output": {"denom": "uvdl", "amount": "990000"}
	}]`

	msgs, err := c.DecodeMsgsJSON(msgsJSON)
	if err != nil {
		t.Fatalf("decode MsgMultiSwap: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 msg, got %d", len(msgs))
	}

	swap, ok := msgs[0].(*tradebintypes.MsgMultiSwap)
	if !ok {
		t.Fatalf("expected *tradebintypes.MsgMultiSwap, got %T", msgs[0])
	}
	if swap.Creator != "bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk" {
		t.Errorf("creator = %q", swap.Creator)
	}
	if len(swap.Routes) != 2 || swap.Routes[0] != "1" || swap.Routes[1] != "2" {
		t.Errorf("routes = %v", swap.Routes)
	}
	if swap.Input.Denom != "ubze" || swap.Input.Amount.String() != "1000000" {
		t.Errorf("input = %v", swap.Input)
	}
	if swap.MinOutput.Denom != "uvdl" || swap.MinOutput.Amount.String() != "990000" {
		t.Errorf("min_output = %v", swap.MinOutput)
	}
}
