package assets

// Classification lists mirror the web ui-kit constants (constants/assets.ts).
// The hub and web MUST agree on what is verified/visible, so these are copied
// verbatim and kept in this one obvious place for future sync. When the web
// values change, update them here too.
//
// Source of truth (2026-07-24):
//   packages/ui-kit/src/constants/assets.ts

// VerifiedAssets are denoms explicitly trusted regardless of registry presence.
var VerifiedAssets = map[string]bool{
	"factory/testbz1w9vva0muctcrmd9xgret9x4wasw2rrflsdkwfs/faneatiku2": true,
	"factory/testbz1z3mkcr2jz424w6m49frgjmy9uhlrx69p4cvrgf/vidulum":    true,
	"factory/testbz1z3mkcr2jz424w6m49frgjmy9uhlrx69p4cvrgf/bitcoinz":   true,
	"ubze": true,
	"utbz": true,
	"factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl": true,
}

// ExcludedAssets are denoms hidden from the app entirely. Only entries mapped to
// true are excluded (web parity: some entries are explicitly false = not excluded).
var ExcludedAssets = map[string]bool{
	"factory/testbz1w9vva0muctcrmd9xgret9x4wasw2rrflsdkwfs/faneatiku1":     false,
	"factory/bze1972aqfzdg29ugjln74edx0xvcg4ehvysjptk77/1000000000":        true,
	"ibc/689DD6F80E4DBCE14877462B182504037FAEAD0699D5804A7F5CB328D33ED24B": true,
	"factory/bze1f0qgels0eu96ev6a67znu70q7rquy9eragn8nw/ucorey":            true,
}

// StableCoins are denoms treated as stablecoins.
var StableCoins = map[string]bool{
	"factory/testbz1z3mkcr2jz424w6m49frgjmy9uhlrx69p4cvrgf/uusdt":          true,
	"factory/bze1z3mkcr2jz424w6m49frgjmy9uhlrx69phqwg3l/testusd":           true,
	"ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4": true,
}

// IsVerified reports whether a denom is on the verified list.
func IsVerified(denom string) bool { return VerifiedAssets[denom] }

// IsExcluded reports whether a denom is excluded from the app (mapped to true).
func IsExcluded(denom string) bool { return ExcludedAssets[denom] }

// IsStable reports whether a denom is a known stablecoin.
func IsStable(denom string) bool { return StableCoins[denom] }
