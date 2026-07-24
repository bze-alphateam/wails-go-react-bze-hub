package assets

import "strings"

// maxDenomLen mirrors the web MAX_DENOM_LEN used by truncateDenom.
const maxDenomLen = 8

// IsFactory reports whether denom is a tokenfactory denom (factory/{creator}/{sub}).
func IsFactory(denom string) bool { return strings.HasPrefix(denom, "factory/") }

// IsIBC reports whether denom is an IBC voucher (ibc/{hash}).
func IsIBC(denom string) bool { return strings.HasPrefix(denom, "ibc/") }

// IsLP reports whether denom is a tradebin AMM LP share token. LP denoms come in
// two formats: legacy `ulp_<base>_<quote>` (pools created before the hashed-denom
// upgrade) and `ulp/<hash>` (pools created after it).
func IsLP(denom string) bool {
	return strings.HasPrefix(denom, "ulp_") || strings.HasPrefix(denom, "ulp/")
}

// IsNative reports whether denom is the chain's native token.
func IsNative(denom string) bool { return denom == NativeDenom }

// ClassifyType returns the Type of a denom. Order matters: factory and ibc and lp
// are prefix-based; everything else (including ubze and registry assets) is native.
func ClassifyType(denom string) Type {
	switch {
	case IsFactory(denom):
		return TypeFactory
	case IsIBC(denom):
		return TypeIBC
	case IsLP(denom):
		return TypeLP
	default:
		return TypeNative
	}
}

// ParseFactoryDenom splits a `factory/{creator}/{subdenom}` denom. The subdenom
// may itself contain slashes, so only the first two segments are fixed. ok is
// false if denom is not a well-formed factory denom.
func ParseFactoryDenom(denom string) (creator, subdenom string, ok bool) {
	if !IsFactory(denom) {
		return "", "", false
	}
	rest := strings.TrimPrefix(denom, "factory/")
	slash := strings.IndexByte(rest, '/')
	if slash <= 0 || slash == len(rest)-1 {
		return "", "", false
	}
	return rest[:slash], rest[slash+1:], true
}

// TruncateDenom shortens a long denom for display, keeping the head and tail with
// an ellipsis in the middle. Mirrors the web stringTruncateFromCenter(str, 8).
func TruncateDenom(denom string) string {
	r := []rune(denom)
	if len(r) <= maxDenomLen {
		return denom
	}
	left := (maxDenomLen + 1) / 2       // ceil(maxLen/2)
	right := len(r) - maxDenomLen/2 + 1 // len - floor(maxLen/2) + 1
	if right < left {
		right = left
	}
	return string(r[:left]) + "…" + string(r[right:])
}
