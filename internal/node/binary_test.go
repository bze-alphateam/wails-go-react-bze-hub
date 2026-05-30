package node

import "testing"

func TestNormalizeVersion(t *testing.T) {
	cases := map[string]string{
		"v8.1.0":       "8.1.0",
		"8.1.0":        "8.1.0",
		"  v8.1.0  ":   "8.1.0",
		"8.0.2\n":      "8.0.2",
		"8.0.2\nextra": "8.0.2", // bzed version prints the version on the first line
		"":             "",
	}
	for in, want := range cases {
		if got := normalizeVersion(in); got != want {
			t.Errorf("normalizeVersion(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSameVersion(t *testing.T) {
	if !sameVersion("v8.1.0", "8.1.0") {
		t.Error("expected v8.1.0 and 8.1.0 to be equal")
	}
	if !sameVersion(" 8.1.0\n", "8.1.0") {
		t.Error("expected whitespace-trimmed versions to be equal")
	}
	if sameVersion("8.0.2", "8.1.0") {
		t.Error("expected 8.0.2 and 8.1.0 to differ (the stale-binary case)")
	}
}

func TestDesiredBinaryVersion_UsesConfigPin(t *testing.T) {
	cfg := &RemoteConfig{BinaryVersion: "v8.1.0"}
	got, err := DesiredBinaryVersion(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "8.1.0" {
		t.Fatalf("expected pinned version 8.1.0, got %q", got)
	}
}
