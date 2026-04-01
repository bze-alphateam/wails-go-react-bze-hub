package node

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/config"
	"github.com/bze-alphateam/bze-hub/internal/logging"
)

// RemoteConfig holds the configuration fetched from the remote config.json URL.
// This controls where the app gets genesis, node configs, binaries, and chain parameters.
type RemoteConfig struct {
	Version             string            `json:"version"`
	GenesisURL          string            `json:"genesis_url"`
	ConfigTomlURL       string            `json:"config_toml_url"`
	AppTomlURL          string            `json:"app_toml_url"`
	ChainID             string            `json:"chain_id"`
	StateSyncRPCServers []string          `json:"state_sync_rpc_servers"`
	PublicREST          string            `json:"public_rest"`
	PublicRPC           string            `json:"public_rpc"`
	BinaryRepo          string            `json:"binary_repo"`
	TrustHeightOffset   int64             `json:"trust_height_offset"`
	Binaries            map[string]string `json:"binaries,omitempty"` // os/arch -> URL?checksum=sha256:...
}

const cachedConfigFilename = "remote-config.json"

// FetchRemoteConfig downloads the config from the given URL and caches it locally.
// If the fetch fails, it falls back to the cached version.
func FetchRemoteConfig(configURL string) (*RemoteConfig, error) {
	logging.Debug("node", "fetching remote config from %s", configURL)
	cfg, err := fetchFromURL(configURL)
	if err != nil {
		logging.Error("node", "remote config fetch failed (%v), trying cached version", err)
		cached, cacheErr := LoadCachedConfig()
		if cacheErr != nil {
			return nil, fmt.Errorf("remote config fetch failed and no cache available: %w", err)
		}
		logging.Info("node", "using cached remote config")
		return cached, nil
	}

	// Cache the fetched config
	if err := cacheConfig(cfg); err != nil {
		logging.Error("node", "failed to cache remote config: %v", err)
	}
	logging.Debug("node", "remote config fetched (chain: %s, version: %s)", cfg.ChainID, cfg.Version)

	return cfg, nil
}

// LoadCachedConfig reads the cached remote config from disk.
func LoadCachedConfig() (*RemoteConfig, error) {
	path := cachedConfigPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("no cached config: %w", err)
	}
	var cfg RemoteConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("cached config corrupt: %w", err)
	}
	return &cfg, nil
}

// GetBinaryURL returns the binary download URL for the current platform from the config.
// Returns empty string if not specified (caller should use GitHub releases fallback).
func (c *RemoteConfig) GetBinaryURL(goos, goarch string) string {
	if c.Binaries == nil {
		return ""
	}
	key := goos + "/" + goarch
	return c.Binaries[key]
}

// ParseBinaryChecksum extracts the SHA256 checksum from a URL with ?checksum=sha256:... suffix.
// Returns the clean URL and the hex checksum. If no checksum in URL, returns empty checksum.
func ParseBinaryChecksum(urlWithChecksum string) (cleanURL string, checksum string) {
	// Look for ?checksum=sha256: in the URL
	idx := -1
	for i := len(urlWithChecksum) - 1; i >= 0; i-- {
		if urlWithChecksum[i] == '?' {
			idx = i
			break
		}
	}
	if idx == -1 {
		return urlWithChecksum, ""
	}

	cleanURL = urlWithChecksum[:idx]
	query := urlWithChecksum[idx+1:]

	// Parse checksum=sha256:HASH
	const prefix = "checksum=sha256:"
	for _, param := range splitParams(query) {
		if len(param) > len(prefix) && param[:len(prefix)] == prefix {
			checksum = param[len(prefix):]
			return cleanURL, checksum
		}
	}

	return urlWithChecksum, ""
}

// --- Internal ---

func fetchFromURL(url string) (*RemoteConfig, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}

	var cfg RemoteConfig
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return nil, fmt.Errorf("decode failed: %w", err)
	}

	return &cfg, nil
}

func cacheConfig(cfg *RemoteConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(cachedConfigPath(), data, 0600)
}

func cachedConfigPath() string {
	return filepath.Join(config.ConfigDir(), cachedConfigFilename)
}

func splitParams(query string) []string {
	var params []string
	start := 0
	for i := 0; i <= len(query); i++ {
		if i == len(query) || query[i] == '&' {
			if i > start {
				params = append(params, query[start:i])
			}
			start = i + 1
		}
	}
	return params
}
