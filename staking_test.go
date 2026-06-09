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
