package main

import (
	"encoding/json"
	"testing"
)

// decode mimics how httpPost decodes a broadcast response (numbers → float64).
func decode(t *testing.T, s string) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return m
}

func TestParseBroadcastOutcome_Success(t *testing.T) {
	resp := decode(t, `{"tx_response":{"code":0,"txhash":"ABC123","raw_log":""}}`)
	o := parseBroadcastOutcome(resp)
	if !o.HasResponse || o.Code != 0 || o.TxHash != "ABC123" {
		t.Fatalf("unexpected outcome: %+v", o)
	}
}

func TestParseBroadcastOutcome_Rejected(t *testing.T) {
	resp := decode(t, `{"tx_response":{"code":5,"codespace":"sdk","txhash":"DEAD","raw_log":"insufficient funds"}}`)
	o := parseBroadcastOutcome(resp)
	if !o.HasResponse || o.Code != 5 {
		t.Fatalf("expected code 5, got %+v", o)
	}
	if o.RawLog != "insufficient funds" || o.Codespace != "sdk" {
		t.Fatalf("expected raw_log/codespace populated, got %+v", o)
	}
}

func TestParseBroadcastOutcome_NoTxResponse(t *testing.T) {
	resp := decode(t, `{"something":"else"}`)
	o := parseBroadcastOutcome(resp)
	if o.HasResponse {
		t.Fatalf("expected HasResponse=false, got %+v", o)
	}
}

func TestFeeFromSimGas(t *testing.T) {
	cases := []struct {
		name        string
		simGas      uint64
		wantGas     uint64
		wantFeeUbze string
	}{
		// gasLimit = ceil(simGas × 1.5); fee = ceil(gasLimit × 0.02) ubze.
		{"typical send", 80000, 120000, "2400"},
		{"rounds gas and fee up", 66667, 100001, "2001"}, // 66667×1.5=100000.5→100001; ×0.02=2000.02→2001
		{"zero gas", 0, 0, "0"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gasLimit, fee := feeFromSimGas(tc.simGas)
			if gasLimit != tc.wantGas {
				t.Errorf("gasLimit = %d, want %d", gasLimit, tc.wantGas)
			}
			if got := fee.AmountOf("ubze").String(); got != tc.wantFeeUbze {
				t.Errorf("fee = %s ubze, want %s", got, tc.wantFeeUbze)
			}
		})
	}
}

func TestAsInt(t *testing.T) {
	if asInt(float64(7)) != 7 {
		t.Error("float64 7 should be 7")
	}
	if asInt("12") != 12 {
		t.Error(`string "12" should be 12`)
	}
	if asInt(nil) != 0 {
		t.Error("nil should be 0")
	}
}
