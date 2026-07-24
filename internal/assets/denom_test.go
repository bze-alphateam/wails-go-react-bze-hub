package assets

import "testing"

func TestClassifyType(t *testing.T) {
	cases := map[string]Type{
		"ubze":                     TypeNative,
		"factory/bze1creator/uabc": TypeFactory,
		"ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1": TypeIBC,
		"ulp_ubze_uatom": TypeLP,
		"ulp/ABCDEF":     TypeLP,
		"randomdenom":    TypeNative,
	}
	for denom, want := range cases {
		if got := ClassifyType(denom); got != want {
			t.Errorf("ClassifyType(%q) = %q, want %q", denom, got, want)
		}
	}
}

func TestParseFactoryDenom(t *testing.T) {
	creator, sub, ok := ParseFactoryDenom("factory/bze1creator/uabc")
	if !ok || creator != "bze1creator" || sub != "uabc" {
		t.Fatalf("got (%q,%q,%v), want (bze1creator,uabc,true)", creator, sub, ok)
	}

	// Subdenom may itself contain slashes.
	creator, sub, ok = ParseFactoryDenom("factory/bze1creator/path/to/token")
	if !ok || creator != "bze1creator" || sub != "path/to/token" {
		t.Fatalf("got (%q,%q,%v), want (bze1creator,path/to/token,true)", creator, sub, ok)
	}

	for _, bad := range []string{"ubze", "factory/", "factory/onlycreator", "factory/creator/"} {
		if _, _, ok := ParseFactoryDenom(bad); ok {
			t.Errorf("ParseFactoryDenom(%q) = ok, want not ok", bad)
		}
	}
}

func TestTruncateDenom(t *testing.T) {
	if got := TruncateDenom("ubze"); got != "ubze" {
		t.Errorf("short denom changed: %q", got)
	}
	long := "ibc/6490A7EAB61059BFC1"
	got := TruncateDenom(long)
	if len([]rune(got)) >= len([]rune(long)) {
		t.Errorf("TruncateDenom(%q) = %q, expected shorter", long, got)
	}
	if got == long {
		t.Errorf("expected truncation for long denom")
	}
}
