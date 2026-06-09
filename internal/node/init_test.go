package node

import (
	"os"
	"path/filepath"
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

func TestSetLogLevelInFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("log_level = \"info\"\nmoniker = \"x\"\n"), 0600); err != nil {
		t.Fatal(err)
	}

	if err := setLogLevelInFile(path, "error"); err != nil {
		t.Fatalf("setLogLevelInFile: %v", err)
	}
	out, _ := os.ReadFile(path)
	if !strings.Contains(string(out), `log_level = "error"`) {
		t.Fatalf("expected log_level set to error, got:\n%s", out)
	}
	if !strings.Contains(string(out), `moniker = "x"`) {
		t.Fatalf("unrelated keys should be untouched, got:\n%s", out)
	}
}

func TestSetLogLevelInFile_NoWriteWhenUnchanged(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("log_level = \"error\"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	before, _ := os.Stat(path)
	if err := setLogLevelInFile(path, "error"); err != nil {
		t.Fatalf("setLogLevelInFile: %v", err)
	}
	after, _ := os.Stat(path)
	// Already at the desired level → file must not be rewritten.
	if !before.ModTime().Equal(after.ModTime()) {
		t.Fatalf("file should not be rewritten when log level is unchanged")
	}
}

func TestApplyNodeLogLevel_EmptyIsNoop(t *testing.T) {
	// Empty level must not touch the filesystem (and must not error even though
	// no node home exists in the test environment).
	if err := ApplyNodeLogLevel(""); err != nil {
		t.Fatalf("expected nil for empty log level, got %v", err)
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
