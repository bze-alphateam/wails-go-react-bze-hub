package node

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/config"
	"github.com/bze-alphateam/bze-hub/internal/logging"
)

// NodeHome returns the path to the node's home directory.
func NodeHome() string {
	return filepath.Join(config.AppDataDir(), "node")
}

// IsNodeInitialized checks if the node has been initialized (config.toml exists).
func IsNodeInitialized() bool {
	_, err := os.Stat(filepath.Join(NodeHome(), "config", "config.toml"))
	return err == nil
}

// InitNode performs the full node initialization sequence:
// 1. Run bzed init
// 2. Download genesis, config.toml, app.toml from remote config
// 3. Post-process configs (moniker, ports, state sync, enable REST/RPC)
func InitNode(cfg *RemoteConfig, ports PortSet) error {
	home := NodeHome()
	binary := BinaryPath()

	// 1. Run bzed init (creates directory structure + crypto keys)
	if !IsNodeInitialized() {
		logging.Info("node", "running bzed init...")
		cmd := exec.Command(binary, "init", "bze-hub", "--chain-id", cfg.ChainID, "--home", home)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("bzed init failed: %w\noutput: %s", err, string(output))
		}
		logging.Info("node", "bzed init completed")
	}

	// 2. Download and replace config files
	logging.Info("node", "downloading genesis...")
	if err := downloadFile(cfg.GenesisURL, filepath.Join(home, "config", "genesis.json")); err != nil {
		return fmt.Errorf("download genesis: %w", err)
	}

	logging.Info("node", "downloading config.toml...")
	if err := downloadFile(cfg.ConfigTomlURL, filepath.Join(home, "config", "config.toml")); err != nil {
		return fmt.Errorf("download config.toml: %w", err)
	}

	logging.Info("node", "downloading app.toml...")
	if err := downloadFile(cfg.AppTomlURL, filepath.Join(home, "config", "app.toml")); err != nil {
		return fmt.Errorf("download app.toml: %w", err)
	}

	// 3. Post-process config.toml
	configPath := filepath.Join(home, "config", "config.toml")
	if err := postProcessConfig(configPath, cfg, ports); err != nil {
		return fmt.Errorf("post-process config.toml: %w", err)
	}

	// 4. Post-process app.toml
	appConfigPath := filepath.Join(home, "config", "app.toml")
	if err := postProcessAppConfig(appConfigPath, ports); err != nil {
		return fmt.Errorf("post-process app.toml: %w", err)
	}

	logging.Info("node", "initialization complete")
	return nil
}

// ReInitConfigs re-downloads and re-processes config files (used during re-sync).
// Does NOT run bzed init again — only refreshes configs.
func ReInitConfigs(cfg *RemoteConfig, ports PortSet) error {
	home := NodeHome()

	logging.Info("node", "re-downloading config files...")
	if err := downloadFile(cfg.ConfigTomlURL, filepath.Join(home, "config", "config.toml")); err != nil {
		return fmt.Errorf("download config.toml: %w", err)
	}
	if err := downloadFile(cfg.AppTomlURL, filepath.Join(home, "config", "app.toml")); err != nil {
		return fmt.Errorf("download app.toml: %w", err)
	}

	configPath := filepath.Join(home, "config", "config.toml")
	if err := postProcessConfig(configPath, cfg, ports); err != nil {
		return fmt.Errorf("post-process config.toml: %w", err)
	}

	appConfigPath := filepath.Join(home, "config", "app.toml")
	if err := postProcessAppConfig(appConfigPath, ports); err != nil {
		return fmt.Errorf("post-process app.toml: %w", err)
	}

	return nil
}

// --- Config post-processing ---

func postProcessConfig(configPath string, cfg *RemoteConfig, ports PortSet) error {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}
	content := string(data)

	// Set moniker
	moniker := GenerateMoniker()
	content = replaceTOMLValue(content, "moniker", fmt.Sprintf(`"%s"`, moniker))
	logging.Info("node", "moniker: %s", moniker)

	// Set node ports
	// P2P listen address
	content = replaceTOMLValue(content, "laddr", fmt.Sprintf(`"tcp://0.0.0.0:%d"`, ports.NodeP2P))
	// RPC listen address (in [rpc] section)
	content = replaceTOMLSectionValue(content, "[rpc]", "laddr", fmt.Sprintf(`"tcp://127.0.0.1:%d"`, ports.NodeRPC))

	// Configure state sync
	content = configureStateSyncInContent(content, cfg)

	return os.WriteFile(configPath, []byte(content), 0600)
}

func postProcessAppConfig(appConfigPath string, ports PortSet) error {
	data, err := os.ReadFile(appConfigPath)
	if err != nil {
		return err
	}
	content := string(data)

	// REST API
	content = replaceTOMLSectionValue(content, "[api]", "enable", "true")
	content = replaceTOMLSectionValue(content, "[api]", "address", fmt.Sprintf(`"tcp://127.0.0.1:%d"`, ports.NodeREST))
	content = replaceTOMLSectionValue(content, "[api]", "enabled-unsafe-cors", "true")

	// gRPC
	content = replaceTOMLSectionValue(content, "[grpc]", "enable", "true")
	content = replaceTOMLSectionValue(content, "[grpc]", "address", fmt.Sprintf(`"127.0.0.1:%d"`, ports.NodeGRPC))

	return os.WriteFile(appConfigPath, []byte(content), 0600)
}

func configureStateSyncInContent(content string, cfg *RemoteConfig) string {
	// Enable state sync
	content = replaceTOMLSectionValue(content, "[statesync]", "enable", "true")

	// Set RPC servers
	servers := strings.Join(cfg.StateSyncRPCServers, ",")
	content = replaceTOMLSectionValue(content, "[statesync]", "rpc_servers", fmt.Sprintf(`"%s"`, servers))

	// Fetch trust height and hash
	trustHeight, trustHash, err := fetchTrustHeightAndHash(cfg)
	if err != nil {
		logging.Error("node", "failed to fetch trust height/hash: %v", err)
		return content
	}

	content = replaceTOMLSectionValue(content, "[statesync]", "trust_height", fmt.Sprintf("%d", trustHeight))
	content = replaceTOMLSectionValue(content, "[statesync]", "trust_hash", fmt.Sprintf(`"%s"`, trustHash))
	content = replaceTOMLSectionValue(content, "[statesync]", "trust_period", `"168h0m0s"`)

	logging.Info("node", "state sync configured: trust_height=%d, trust_hash=%s", trustHeight, trustHash[:16]+"...")
	return content
}

// --- Trust height/hash fetching ---

func fetchTrustHeightAndHash(cfg *RemoteConfig) (int64, string, error) {
	if len(cfg.StateSyncRPCServers) == 0 {
		return 0, "", fmt.Errorf("no state sync RPC servers configured")
	}

	rpcURL := cfg.StateSyncRPCServers[0]
	// Strip port suffix for HTTP requests if needed
	if strings.HasSuffix(rpcURL, ":443") {
		rpcURL = strings.TrimSuffix(rpcURL, ":443")
	}

	// Get latest height
	latestHeight, err := getLatestBlockHeight(rpcURL)
	if err != nil {
		return 0, "", fmt.Errorf("get latest height: %w", err)
	}

	// Calculate trust height
	offset := cfg.TrustHeightOffset
	if offset <= 0 {
		offset = 2000
	}
	trustHeight := latestHeight - offset
	if trustHeight <= 0 {
		trustHeight = 1
	}

	// Get block hash at trust height
	trustHash, err := getBlockHash(rpcURL, trustHeight)
	if err != nil {
		return 0, "", fmt.Errorf("get block hash at %d: %w", trustHeight, err)
	}

	return trustHeight, trustHash, nil
}

func getLatestBlockHeight(rpcURL string) (int64, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(rpcURL + "/block")
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	var result struct {
		Result struct {
			Block struct {
				Header struct {
					Height string `json:"height"`
				} `json:"header"`
			} `json:"block"`
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, err
	}

	var height int64
	fmt.Sscanf(result.Result.Block.Header.Height, "%d", &height)
	if height == 0 {
		return 0, fmt.Errorf("invalid height from %s", rpcURL)
	}

	return height, nil
}

func getBlockHash(rpcURL string, height int64) (string, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	url := fmt.Sprintf("%s/block?height=%d", rpcURL, height)
	resp, err := client.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		Result struct {
			BlockID struct {
				Hash string `json:"hash"`
			} `json:"block_id"`
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	if result.Result.BlockID.Hash == "" {
		return "", fmt.Errorf("empty hash for block %d", height)
	}

	return result.Result.BlockID.Hash, nil
}

// --- TOML helpers ---

// replaceTOMLValue replaces the first occurrence of `key = ...` with `key = newValue`.
func replaceTOMLValue(content, key, newValue string) string {
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, key+" =") || strings.HasPrefix(trimmed, key+"=") {
			// Preserve indentation
			indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
			lines[i] = fmt.Sprintf("%s%s = %s", indent, key, newValue)
			break
		}
	}
	return strings.Join(lines, "\n")
}

// replaceTOMLSectionValue replaces `key = ...` within a specific [section].
func replaceTOMLSectionValue(content, section, key, newValue string) string {
	lines := strings.Split(content, "\n")
	inSection := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Track sections
		if strings.HasPrefix(trimmed, "[") {
			inSection = (trimmed == section)
			continue
		}

		if inSection && (strings.HasPrefix(trimmed, key+" =") || strings.HasPrefix(trimmed, key+"=")) {
			indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
			lines[i] = fmt.Sprintf("%s%s = %s", indent, key, newValue)
			return strings.Join(lines, "\n") // Only replace first match in section
		}
	}

	return content
}

// --- File download helper ---

func downloadFile(url, destPath string) error {
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(destPath), 0700); err != nil {
		return err
	}

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}
