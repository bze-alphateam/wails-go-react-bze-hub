package assets

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/config"
)

// embeddedRegistry is the fallback chain-registry snapshot compiled into the
// binary. It always resolves the assets the app needs even with no network and
// no cache. Refreshed data (see Engine.Refresh) overrides it at runtime.
//
//go:embed registry/registry.json
var embeddedRegistry []byte

// Registry is a minimal chain-registry snapshot: the BZE asset list plus the
// counterpart chains' asset lists used for IBC naming.
type Registry struct {
	Version string  `json:"version"`
	Chains  []Chain `json:"chains"`
}

// Chain is one chain's identity and asset list.
type Chain struct {
	ChainName  string          `json:"chainName"`
	ChainID    string          `json:"chainId"`
	PrettyName string          `json:"prettyName"`
	Assets     []RegistryAsset `json:"assets"`
}

// RegistryAsset is a single asset entry from a chain's registry asset list.
type RegistryAsset struct {
	Base        string      `json:"base"`
	Symbol      string      `json:"symbol"`
	Name        string      `json:"name"`
	Display     string      `json:"display"`
	DenomUnits  []DenomUnit `json:"denomUnits"`
	CoingeckoID string      `json:"coingeckoId,omitempty"` // aggregator price key (e.g. "bzedge")
	LogoURIs    *LogoURIs   `json:"logoURIs,omitempty"`
	Images      []LogoURIs  `json:"images,omitempty"`
}

// DenomUnit maps a denom to its exponent (e.g. bze → 6).
type DenomUnit struct {
	Denom    string `json:"denom"`
	Exponent int    `json:"exponent"`
}

// LogoURIs holds the logo source URLs for an asset (mirrors chain-registry's
// logo_URIs / images entries).
type LogoURIs struct {
	SVG string `json:"svg,omitempty"`
	PNG string `json:"png,omitempty"`
}

// LogoCandidates returns the asset's logo source URLs in the web engine's
// priority order (logoURIs.svg → logoURIs.png → images[i].svg → images[i].png),
// skipping empties. The logo cache downloads the first that succeeds.
func (a RegistryAsset) LogoCandidates() []string {
	var out []string
	add := func(u string) {
		if u != "" {
			out = append(out, u)
		}
	}
	if a.LogoURIs != nil {
		add(a.LogoURIs.SVG)
		add(a.LogoURIs.PNG)
	}
	for _, img := range a.Images {
		add(img.SVG)
		add(img.PNG)
	}
	return out
}

// Exponent returns the exponent of the asset's display unit, or 0 if unknown.
func (a RegistryAsset) Exponent() int {
	for _, u := range a.DenomUnits {
		if u.Denom == a.Display {
			return u.Exponent
		}
	}
	return 0
}

// bzeChainName is the chain name of the BZE chain within the snapshot.
const bzeChainName = "beezee"

// parseRegistry unmarshals a snapshot, validating it has at least one chain.
func parseRegistry(data []byte) (*Registry, error) {
	var r Registry
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, fmt.Errorf("parse registry: %w", err)
	}
	if len(r.Chains) == 0 {
		return nil, fmt.Errorf("registry has no chains")
	}
	return &r, nil
}

// LoadEmbedded returns the snapshot compiled into the binary.
func LoadEmbedded() (*Registry, error) {
	return parseRegistry(embeddedRegistry)
}

// FindByBase searches every chain for an asset with the given base denom and
// returns it together with its chain. The first match wins.
func (r *Registry) FindByBase(base string) (RegistryAsset, *Chain, bool) {
	for i := range r.Chains {
		for _, a := range r.Chains[i].Assets {
			if a.Base == base {
				return a, &r.Chains[i], true
			}
		}
	}
	return RegistryAsset{}, nil, false
}

// BZEAsset looks up an asset by base denom on the BZE chain only.
func (r *Registry) BZEAsset(base string) (RegistryAsset, bool) {
	for i := range r.Chains {
		if !strings.EqualFold(r.Chains[i].ChainName, bzeChainName) {
			continue
		}
		for _, a := range r.Chains[i].Assets {
			if a.Base == base {
				return a, true
			}
		}
	}
	return RegistryAsset{}, false
}

// ChainByID returns the chain with the given chain-id.
func (r *Registry) ChainByID(chainID string) (*Chain, bool) {
	for i := range r.Chains {
		if r.Chains[i].ChainID == chainID {
			return &r.Chains[i], true
		}
	}
	return nil, false
}

// --- cache + remote refresh -------------------------------------------------

// cachePath is where a successfully-refreshed snapshot is persisted, so the next
// launch starts from fresh data instead of the (possibly older) embed.
func cachePath() string {
	return filepath.Join(config.AppDataDir(), "assets", "registry.json")
}

// loadCache reads the on-disk snapshot if present. A missing file is not an error
// (returns nil, nil) — the embed is the fallback.
func loadCache() (*Registry, error) {
	data, err := os.ReadFile(cachePath())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return parseRegistry(data)
}

// saveCache persists a snapshot to the app data dir.
func saveCache(data []byte) error {
	path := cachePath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

// fetchRemote downloads and parses a snapshot from url. On any failure the caller
// keeps its current (cache or embed) registry — the app never blocks or breaks on
// a bad refresh.
func fetchRemote(url string, client *http.Client) (*Registry, []byte, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, nil, fmt.Errorf("fetch registry: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("fetch registry: status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20)) // 8 MiB cap
	if err != nil {
		return nil, nil, fmt.Errorf("read registry: %w", err)
	}

	reg, err := parseRegistry(data)
	if err != nil {
		return nil, nil, err
	}
	return reg, data, nil
}

// defaultHTTPClient is the client used for the background registry refresh.
func defaultHTTPClient() *http.Client {
	return &http.Client{Timeout: 20 * time.Second}
}
