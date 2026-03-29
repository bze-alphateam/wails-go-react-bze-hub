# Epic 05: Auto-Updater

Binary version checking against GitHub releases, download with checksum verification, binary replacement with rollback, and chain upgrade detection.

## 1. Overview

The auto-updater manages the `bzed` binary lifecycle:

- **Check** for new versions on GitHub
- **Notify** the user when an update is available
- **Download** and verify the new binary
- **Replace** the old binary with rollback capability
- **Detect** chain upgrades (governance-coordinated height-based upgrades)

Important: the auto-updater manages the `bzed` node binary, not the desktop app itself. Since dApp UIs load from live URLs, the desktop app rarely needs updating. When it does, users download a new release manually or via platform package managers.

## 2. Version Check Mechanism

### Check Schedule

- On app startup
- Every 6 hours while the app is running
- On manual "Check for Updates" button click in the dashboard

### GitHub API Query

```go
const (
    // TODO: confirm exact repo (bze-alphateam/bze or bze-alphateam/bze-v5)
    releaseURL = "https://api.github.com/repos/bze-alphateam/bze/releases/latest"
)

type GitHubRelease struct {
    TagName     string         `json:"tag_name"`     // "v8.1.0"
    Name        string         `json:"name"`         // Release title
    Body        string         `json:"body"`         // Release notes (markdown)
    PublishedAt time.Time      `json:"published_at"`
    Assets      []ReleaseAsset `json:"assets"`
}

type ReleaseAsset struct {
    Name               string `json:"name"`                 // "bzed-darwin-arm64.tar.gz"
    BrowserDownloadURL string `json:"browser_download_url"` // Direct download URL
    Size               int64  `json:"size"`                 // File size in bytes
}

func (u *Updater) CheckForUpdate() (*UpdateInfo, error) {
    resp, err := http.Get(releaseURL)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    var release GitHubRelease
    json.NewDecoder(resp.Body).Decode(&release)

    currentVersion := u.getCurrentVersion()
    latestVersion := strings.TrimPrefix(release.TagName, "v")

    if !isNewerVersion(currentVersion, latestVersion) {
        return nil, nil // Already up to date
    }

    return &UpdateInfo{
        CurrentVersion: currentVersion,
        LatestVersion:  latestVersion,
        ReleaseNotes:   release.Body,
        PublishedAt:    release.PublishedAt,
        DownloadURL:    u.findAssetURL(release.Assets),
        AssetSize:      u.findAssetSize(release.Assets),
    }, nil
}
```

### Rate Limiting

GitHub API allows 60 requests/hour for unauthenticated requests. With checks every 6 hours + startup, we're well within limits.

Cache the response for 1 hour to avoid unnecessary requests:

```go
type cachedResponse struct {
    data      *GitHubRelease
    fetchedAt time.Time
}

func (u *Updater) getCachedRelease() (*GitHubRelease, error) {
    if u.cache != nil && time.Since(u.cache.fetchedAt) < time.Hour {
        return u.cache.data, nil
    }
    // Fetch fresh
    ...
}
```

### Version Comparison

Semantic version comparison (major.minor.patch):

```go
func isNewerVersion(current, latest string) bool {
    // Parse "8.1.0" -> [8, 1, 0]
    // Compare major, then minor, then patch
    ...
}
```

## 3. Update Notification

### Non-Intrusive UI

When an update is available:
- Show a badge on the Dashboard tab icon
- Display a notification bar in the dashboard: "BZE Node v8.2.0 available (current: v8.1.0)"
- Include a brief summary from release notes
- Buttons: "Update Now" | "Remind Me Later"

### Do NOT Auto-Update

Chain upgrades may be coordinated with governance proposals at specific block heights. Auto-updating could cause the node to halt at an unexpected time. Always require user confirmation.

### Update Info Display

```typescript
interface UpdateInfo {
    currentVersion: string;
    latestVersion: string;
    releaseNotes: string;   // Markdown from GitHub
    publishedAt: string;    // ISO date
    downloadSize: string;   // Human-readable ("15.2 MB")
}
```

## 4. Download and Verification

### Asset Selection

Match the correct binary for the current platform:

```go
func (u *Updater) findAssetURL(assets []ReleaseAsset) string {
    target := fmt.Sprintf("bzed-%s-%s", runtime.GOOS, runtime.GOARCH)
    // darwin-arm64, darwin-amd64, linux-amd64, linux-arm64, win64

    for _, asset := range assets {
        if strings.Contains(asset.Name, target) {
            return asset.BrowserDownloadURL
        }
    }
    return ""
}
```

### Download Flow

```go
func (u *Updater) Download(url string) (string, error) {
    // 1. Create temp file
    tmpPath := filepath.Join(u.binDir, fmt.Sprintf("bzed-%s.tmp", version))
    out, _ := os.Create(tmpPath)

    // 2. Download with progress tracking
    resp, _ := http.Get(url)
    defer resp.Body.Close()

    totalSize := resp.ContentLength
    reader := &progressReader{
        reader: resp.Body,
        total:  totalSize,
        onProgress: func(downloaded, total int64) {
            percent := float64(downloaded) / float64(total) * 100
            runtime.EventsEmit(u.ctx, "updater:progress", percent)
        },
    }

    io.Copy(out, reader)
    out.Close()

    return tmpPath, nil
}
```

### Checksum Verification

```go
func (u *Updater) VerifyChecksum(filePath string, release GitHubRelease) error {
    // 1. Find checksums file in release assets
    var checksumsURL string
    for _, asset := range release.Assets {
        if strings.Contains(asset.Name, "checksums") || strings.Contains(asset.Name, "SHA256") {
            checksumsURL = asset.BrowserDownloadURL
            break
        }
    }
    if checksumsURL == "" {
        return errors.New("no checksums file found in release")
    }

    // 2. Download and parse checksums
    resp, _ := http.Get(checksumsURL)
    // Format: "abcdef123...  bzed-darwin-arm64.tar.gz"

    // 3. Find expected hash for our asset
    expectedHash := parseChecksumFor(resp.Body, assetName)

    // 4. Compute actual hash
    f, _ := os.Open(filePath)
    defer f.Close()
    h := sha256.New()
    io.Copy(h, f)
    actualHash := hex.EncodeToString(h.Sum(nil))

    // 5. Compare
    if actualHash != expectedHash {
        os.Remove(filePath) // Delete corrupted download
        return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedHash, actualHash)
    }

    return nil
}
```

### Archive Extraction

```go
func (u *Updater) Extract(archivePath string) (string, error) {
    if strings.HasSuffix(archivePath, ".tar.gz") {
        return u.extractTarGz(archivePath)
    }
    if strings.HasSuffix(archivePath, ".zip") {
        return u.extractZip(archivePath)
    }
    return "", errors.New("unsupported archive format")
}
```

After extraction, set executable permission on Unix:
```go
if runtime.GOOS != "windows" {
    os.Chmod(binaryPath, 0755)
}
```

## 5. Binary Replacement

### Replacement Flow

```go
func (u *Updater) Replace(newBinaryPath string) error {
    currentPath := u.binaryPath()     // {appdata}/bin/bzed
    backupPath := currentPath + ".backup"

    // 1. Stop the running node
    if err := u.nodeManager.Stop(); err != nil {
        return fmt.Errorf("failed to stop node: %w", err)
    }

    // 2. Backup current binary
    if err := os.Rename(currentPath, backupPath); err != nil {
        return fmt.Errorf("failed to backup current binary: %w", err)
    }

    // 3. Move new binary into place
    if err := os.Rename(newBinaryPath, currentPath); err != nil {
        // Restore backup on failure
        os.Rename(backupPath, currentPath)
        return fmt.Errorf("failed to install new binary: %w", err)
    }

    // 4. Verify new binary works
    cmd := exec.Command(currentPath, "version", "--home", u.nodeManager.NodeHome())
    if err := cmd.Run(); err != nil {
        // Rollback: restore backup
        os.Rename(backupPath, currentPath)
        return fmt.Errorf("new binary verification failed, rolled back: %w", err)
    }

    // 5. Update version record
    u.setCurrentVersion(newVersion)

    // 6. Restart node
    if err := u.nodeManager.Start(); err != nil {
        return fmt.Errorf("failed to restart node with new binary: %w", err)
    }

    // 7. Clean up (keep backup for manual rollback)
    return nil
}
```

### Version Tracking

```go
// {appdata}/config/node-version.json
type NodeVersionFile struct {
    Version      string    `json:"version"`       // "8.1.0"
    InstalledAt  time.Time `json:"installedAt"`
    Checksum     string    `json:"checksum"`       // SHA256 of the binary itself
    PreviousVersion string `json:"previousVersion,omitempty"`
}
```

## 6. Chain Upgrade Detection

### How Cosmos Chain Upgrades Work

1. A governance proposal schedules an upgrade at a specific block height
2. When the node reaches that height, it halts with an upgrade-needed message
3. The operator replaces the binary with a new version that handles the upgrade
4. The node restarts and continues from the upgrade height

### Detection in BZE Hub

```go
func (m *Manager) monitorProcess() {
    err := m.cmd.Wait() // Wait for process to exit

    if err != nil {
        // Check stderr for upgrade signal
        stderr := m.readStderrLog()
        if strings.Contains(stderr, "UPGRADE") || strings.Contains(stderr, "upgrade needed") {
            // Extract upgrade name if possible
            upgradeName := parseUpgradeName(stderr)

            runtime.EventsEmit(m.ctx, "node:upgrade-needed", UpgradeInfo{
                Name:    upgradeName,
                Message: "The BZE chain requires a binary upgrade. Check for a new release.",
            })

            // Trigger update check
            m.updater.CheckForUpdate()
            return
        }

        // Regular error
        m.setState(NodeError)
    }
}
```

### Upgrade Flow

1. Node halts at upgrade height -> detected by process monitor
2. Auto-check for new release on GitHub
3. If new version available: show notification with "Upgrade Now"
4. User approves -> download, verify, replace, restart
5. Node continues from upgrade height with new binary

### Pre-Upgrade Warning (Optional Enhancement)

Query the chain for pending upgrade proposals:
```go
// Query REST: /cosmos/upgrade/v1beta1/current_plan
func (m *Manager) checkPendingUpgrade() (*UpgradePlan, error) {
    resp, err := http.Get(m.restEndpoint + "/cosmos/upgrade/v1beta1/current_plan")
    // Parse response for upgrade height and name
}
```

If an upgrade is scheduled within the next 24 hours, show a warning in the dashboard.

## 7. Rollback

### Manual Rollback

If the new binary causes issues after upgrade:

```go
func (u *Updater) Rollback() error {
    currentPath := u.binaryPath()
    backupPath := currentPath + ".backup"

    // Check backup exists
    if _, err := os.Stat(backupPath); os.IsNotExist(err) {
        return errors.New("no backup binary available for rollback")
    }

    // Stop node
    u.nodeManager.Stop()

    // Swap
    os.Rename(currentPath, currentPath+".failed")
    os.Rename(backupPath, currentPath)

    // Update version record
    u.setCurrentVersion(u.versionFile.PreviousVersion)

    // Restart
    return u.nodeManager.Start()
}
```

### Limitations

- Rollback after a chain upgrade that changed state format is NOT possible (the database has been migrated)
- In this case, a state sync re-sync is needed with the old binary (if the chain allows it)
- Document this clearly in the UI when offering rollback

## 8. Progress Reporting

All long-running operations report progress to the frontend:

```go
// Events emitted during update:
"updater:checking"           // Checking for new version
"updater:available"          // New version found (with UpdateInfo)
"updater:downloading"        // Download started
"updater:progress"           // Download progress (0-100%)
"updater:verifying"          // Checksum verification
"updater:installing"         // Binary replacement in progress
"updater:complete"           // Update complete, node restarting
"updater:error"              // Error at any step (with error message)
"updater:rollback-available" // Rollback is possible
```

Frontend displays these as a step-by-step progress indicator in the dashboard.
