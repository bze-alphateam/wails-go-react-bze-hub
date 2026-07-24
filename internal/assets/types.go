// Package assets is the single source of truth for token identity in BZE Hub —
// the Go-side equivalent of the web ui-kit's assets_factory. It classifies a
// denom (native / factory / ibc / lp), resolves it to a human-readable Asset
// (symbol, name, decimals, verified flag) using an embedded chain-registry
// snapshot plus on-chain data, and keeps that snapshot fresh via a non-blocking
// background refresh.
package assets

// Type is the kind of a denom. Values match the web asset engine's lowercase
// discriminants so the hub and web agree on typing.
type Type string

const (
	TypeNative  Type = "native"
	TypeFactory Type = "factory"
	TypeIBC     Type = "ibc"
	TypeLP      Type = "lp"
)

// NativeDenom is the chain's native staking/gas token.
const NativeDenom = "ubze"

// LPDecimals is the fixed exponent for AMM LP share tokens (web parity:
// LP_ASSETS_DECIMALS).
const LPDecimals = 12

// Asset is a resolved token identity. It carries no balance — balances are
// attached per-account by the caller (see App.GetAssets).
type Asset struct {
	Denom    string `json:"denom"`    // base (on-chain) denom
	Symbol   string `json:"symbol"`   // ticker, e.g. "BZE", "USDC"
	Name     string `json:"name"`     // display name, e.g. "BeeZee"
	Decimals int    `json:"decimals"` // exponent of the display unit
	Type     Type   `json:"type"`     // native | factory | ibc | lp
	Verified bool   `json:"verified"` // trusted/known asset
	Stable   bool   `json:"stable"`   // stablecoin
	LogoRef  string `json:"logoRef"`  // reference to a logo (populated with images in a follow-up story)

	// IBC carries the resolved trace metadata for ibc/* denoms; nil otherwise.
	IBC *IBCInfo `json:"ibc,omitempty"`
}

// IBCInfo is the resolved trace + counterparty data for an IBC denom.
type IBCInfo struct {
	ChannelID    string       `json:"channelId"` // the BZE-side channel the asset arrived on
	Counterparty IBCCounterpt `json:"counterparty"`
}

// IBCCounterpt describes the origin (first-hop) chain of an IBC asset.
type IBCCounterpt struct {
	ChainName       string `json:"chainName"`
	ChainPrettyName string `json:"chainPrettyName"`
	ChannelID       string `json:"channelId"`
	BaseDenom       string `json:"baseDenom"`
}

// RestClient is the subset of the chain REST proxy the engine needs. The
// production implementation is *chain.Client; tests supply a stub.
type RestClient interface {
	// RestGet fetches a REST endpoint and returns the parsed JSON object.
	RestGet(path string) (map[string]interface{}, error)
}
