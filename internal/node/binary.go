package node

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/config"
)

const binaryName = "bzed"

// BinaryPath returns the path where the bzed binary should be stored.
func BinaryPath() string {
	name := binaryName
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(config.AppDataDir(), "bin", name)
}

// BinaryExists returns true if the bzed binary exists and is executable.
func BinaryExists() bool {
	info, err := os.Stat(BinaryPath())
	if err != nil {
		return false
	}
	return !info.IsDir() && info.Size() > 0
}

// ResolveBinaryURL determines the download URL for the current platform.
// First checks the remote config's binaries map, then falls back to GitHub releases.
func ResolveBinaryURL(cfg *RemoteConfig) (downloadURL string, checksum string, err error) {
	goos := runtime.GOOS
	goarch := runtime.GOARCH

	// 1. Check binaries map in config
	if url := cfg.GetBinaryURL(goos, goarch); url != "" {
		cleanURL, cs := ParseBinaryChecksum(url)
		return cleanURL, cs, nil
	}

	// 2. Fallback: GitHub releases API
	fmt.Printf("[node] no binary in config for %s/%s, checking GitHub releases for %s\n", goos, goarch, cfg.BinaryRepo)
	return resolveFromGitHub(cfg.BinaryRepo, goos, goarch)
}

// DownloadBinary downloads the binary from the given URL, verifies checksum, and saves it.
// The onProgress callback receives bytes downloaded and total bytes (-1 if unknown).
func DownloadBinary(downloadURL, expectedChecksum string, onProgress func(downloaded, total int64)) error {
	destPath := BinaryPath()

	// Ensure bin directory exists
	if err := os.MkdirAll(filepath.Dir(destPath), 0700); err != nil {
		return fmt.Errorf("create bin dir: %w", err)
	}

	// Download to temp file
	tmpPath := destPath + ".tmp"
	defer os.Remove(tmpPath)

	client := &http.Client{
		Timeout: 10 * time.Minute,
		// Follow redirects (GitHub uses CDN redirects)
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}
	resp, err := client.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download HTTP %d from %s", resp.StatusCode, downloadURL)
	}

	out, err := os.Create(tmpPath)
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}

	// Download with progress tracking + checksum computation
	hasher := sha256.New()
	writer := io.MultiWriter(out, hasher)

	var downloaded int64
	total := resp.ContentLength
	buf := make([]byte, 32*1024)

	// Fire initial progress
	if onProgress != nil {
		onProgress(0, total)
	}

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := writer.Write(buf[:n]); writeErr != nil {
				out.Close()
				return fmt.Errorf("write failed: %w", writeErr)
			}
			downloaded += int64(n)
			if onProgress != nil {
				onProgress(downloaded, total)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			out.Close()
			return fmt.Errorf("download read failed: %w", readErr)
		}
	}
	out.Close()

	// Verify checksum
	if expectedChecksum != "" {
		actualChecksum := hex.EncodeToString(hasher.Sum(nil))
		if actualChecksum != expectedChecksum {
			return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedChecksum, actualChecksum)
		}
		fmt.Println("[node] binary checksum verified")
	}

	// Move to final location
	if err := os.Rename(tmpPath, destPath); err != nil {
		return fmt.Errorf("move binary: %w", err)
	}

	// Set executable permission (Unix)
	if runtime.GOOS != "windows" {
		if err := os.Chmod(destPath, 0755); err != nil {
			return fmt.Errorf("chmod: %w", err)
		}
	}

	fmt.Printf("[node] binary saved to %s\n", destPath)
	return nil
}

// --- GitHub releases fallback ---

type githubRelease struct {
	TagName string        `json:"tag_name"`
	Assets  []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

func resolveFromGitHub(repo, goos, goarch string) (downloadURL, checksum string, err error) {
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)
	client := &http.Client{Timeout: 30 * time.Second}

	resp, err := client.Get(apiURL)
	if err != nil {
		return "", "", fmt.Errorf("GitHub API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("GitHub API HTTP %d", resp.StatusCode)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return "", "", fmt.Errorf("GitHub API decode failed: %w", err)
	}

	// Look for the binary matching our platform
	// Naming convention: bzed-{os}-{arch} (no extension, no archive)
	targetName := fmt.Sprintf("bzed-%s-%s", goos, goarch)
	if goos == "windows" {
		targetName = "bzed.exe"
	}

	for _, asset := range release.Assets {
		name := asset.Name
		// Match exact name or name without extension
		if name == targetName || strings.TrimSuffix(name, filepath.Ext(name)) == targetName {
			// Skip archives — we want the raw binary
			if isArchive(name) {
				continue
			}
			fmt.Printf("[node] found binary in GitHub release %s: %s\n", release.TagName, name)
			return asset.BrowserDownloadURL, "", nil
		}
	}

	// If no exact match, try any asset containing our platform identifier
	for _, asset := range release.Assets {
		if isArchive(asset.Name) {
			continue
		}
		if strings.Contains(asset.Name, goos) && strings.Contains(asset.Name, goarch) {
			fmt.Printf("[node] found binary by pattern in GitHub release %s: %s\n", release.TagName, asset.Name)
			return asset.BrowserDownloadURL, "", nil
		}
	}

	return "", "", fmt.Errorf("no binary found for %s/%s in release %s", goos, goarch, release.TagName)
}

func isArchive(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".tar.gz") ||
		strings.HasSuffix(lower, ".tgz") ||
		strings.HasSuffix(lower, ".zip") ||
		strings.HasSuffix(lower, ".gz") && !strings.HasSuffix(lower, ".tar.gz")
}
