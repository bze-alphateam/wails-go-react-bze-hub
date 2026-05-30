package node

import (
	"strings"
	"testing"
)

func TestReplaceTOMLValue_LogLevel(t *testing.T) {
	const in = `# CometBFT config
log_level = "error"

moniker = "old"
`
	out := replaceTOMLValue(in, "log_level", `"info"`)

	if !strings.Contains(out, `log_level = "info"`) {
		t.Fatalf("expected log_level overridden to info, got:\n%s", out)
	}
	if strings.Contains(out, `log_level = "error"`) {
		t.Fatalf("old log_level value should be gone, got:\n%s", out)
	}
	// Unrelated keys must be untouched.
	if !strings.Contains(out, `moniker = "old"`) {
		t.Fatalf("moniker should be untouched, got:\n%s", out)
	}
}

func TestReplaceTOMLValue_PreservesIndentation(t *testing.T) {
	const in = "  log_level = \"error\"\n"
	out := replaceTOMLValue(in, "log_level", `"debug"`)
	if out != "  log_level = \"debug\"\n" {
		t.Fatalf("expected indentation preserved, got %q", out)
	}
}

func TestReplaceTOMLValue_NoMatchLeavesContentUnchanged(t *testing.T) {
	const in = "moniker = \"x\"\n"
	if out := replaceTOMLValue(in, "log_level", `"info"`); out != in {
		t.Fatalf("expected content unchanged when key absent, got %q", out)
	}
}

func TestReplaceTOMLSectionValue_OnlyWithinSection(t *testing.T) {
	const in = `[rpc]
laddr = "tcp://127.0.0.1:26657"

[p2p]
laddr = "tcp://0.0.0.0:26656"
`
	out := replaceTOMLSectionValue(in, "[p2p]", "laddr", `"tcp://0.0.0.0:40000"`)

	if !strings.Contains(out, `tcp://0.0.0.0:40000`) {
		t.Fatalf("expected p2p laddr replaced, got:\n%s", out)
	}
	// The [rpc] laddr with the same key name must NOT be touched.
	if !strings.Contains(out, `tcp://127.0.0.1:26657`) {
		t.Fatalf("rpc laddr should be untouched, got:\n%s", out)
	}
}
