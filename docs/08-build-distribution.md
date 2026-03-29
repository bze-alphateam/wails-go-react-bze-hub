# Epic 08: Build & Distribution

Cross-platform builds, packaging, installers, code signing, CI/CD pipeline, and release process.

## 1. Build Matrix

| Platform | Architecture | Binary Name | Package Format | Notes |
|----------|-------------|-------------|----------------|-------|
| macOS | AMD64 | `BZE Hub.app` | `.dmg` | Intel Macs |
| macOS | ARM64 | `BZE Hub.app` | `.dmg` | Apple Silicon (M1+) |
| Windows | AMD64 | `BZE Hub.exe` | `.exe` (NSIS installer) | Windows 10/11 |
| Linux | AMD64 | `bze-hub` | `.AppImage` + `.deb` | Most distros |
| Linux | ARM64 | `bze-hub` | `.AppImage` + `.deb` | Raspberry Pi, ARM servers |

Optional: macOS Universal binary (AMD64 + ARM64 combined via `lipo`).

## 2. Wails Build Commands

### Local Development

```bash
# Development mode with hot reload
wails dev

# Development with specific frontend dev server URL
wails dev -frontenddevserverurl http://localhost:5173
```

### Production Builds

```bash
# Current platform
wails build

# Specific platform (cross-compilation)
wails build -platform darwin/amd64
wails build -platform darwin/arm64
wails build -platform windows/amd64
wails build -platform linux/amd64
wails build -platform linux/arm64
```

### Build Flags

```bash
wails build \
    -ldflags "-s -w \
        -X main.version=1.0.0 \
        -X main.commit=$(git rev-parse --short HEAD) \
        -X main.buildDate=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -trimpath \
    -platform darwin/arm64
```

| Flag | Purpose |
|------|---------|
| `-s -w` | Strip debug info and symbol table (smaller binary) |
| `-X main.version` | Embed version at build time |
| `-X main.commit` | Embed git commit hash |
| `-trimpath` | Remove local paths for reproducible builds |

## 3. macOS Specifics

### App Bundle Structure

```
BZE Hub.app/
  Contents/
    Info.plist          # App metadata (version, bundle ID, etc.)
    MacOS/
      bze-hub           # Main binary
    Resources/
      iconfile.icns     # App icon (multiple resolutions)
```

### Info.plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.getbze.bze-hub</string>
    <key>CFBundleName</key>
    <string>BZE Hub</string>
    <key>CFBundleDisplayName</key>
    <string>BZE Hub</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>CFBundleIconFile</key>
    <string>iconfile</string>
</dict>
</plist>
```

### Code Signing

```bash
# Sign the app bundle
codesign --deep --force --verify --verbose \
    --sign "Developer ID Application: BZE Alpha Team (TEAM_ID)" \
    --options runtime \
    "build/bin/BZE Hub.app"

# Verify signature
codesign --verify --verbose=4 "build/bin/BZE Hub.app"
```

Requires:
- Apple Developer account ($99/year)
- Developer ID Application certificate
- `--options runtime` enables hardened runtime (required for notarization)

### Notarization

```bash
# Create zip for notarization
ditto -c -k --keepParent "build/bin/BZE Hub.app" "BZE-Hub.zip"

# Submit for notarization
xcrun notarytool submit "BZE-Hub.zip" \
    --apple-id "developer@getbze.com" \
    --password "@keychain:AC_PASSWORD" \
    --team-id "TEAM_ID" \
    --wait

# Staple the ticket
xcrun stapler staple "build/bin/BZE Hub.app"
```

### DMG Creation

```bash
# Using create-dmg (brew install create-dmg)
create-dmg \
    --volname "BZE Hub" \
    --volicon "build/appicon.icns" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon-size 100 \
    --icon "BZE Hub.app" 175 190 \
    --hide-extension "BZE Hub.app" \
    --app-drop-link 425 190 \
    "BZE-Hub-1.0.0-darwin-arm64.dmg" \
    "build/bin/BZE Hub.app"
```

### Universal Binary (Optional)

Combine AMD64 and ARM64 into a single binary:

```bash
# Build both architectures
wails build -platform darwin/amd64 -o bze-hub-amd64
wails build -platform darwin/arm64 -o bze-hub-arm64

# Combine with lipo
lipo -create -output bze-hub-universal bze-hub-amd64 bze-hub-arm64
```

Note: this doubles the binary size. May not be worth it if separate downloads are available.

## 4. Windows Specifics

### WebView2 Runtime

Windows builds require the WebView2 Runtime:
- Pre-installed on Windows 11 and most Windows 10 (20H2+)
- The NSIS installer should include the WebView2 bootstrapper as a fallback
- Wails handles WebView2 detection at runtime

### NSIS Installer

Wails generates NSIS installer configuration in `build/windows/installer/`.

Key settings:

```nsi
!define PRODUCT_NAME "BZE Hub"
!define PRODUCT_PUBLISHER "BZE Alpha Team"
!define PRODUCT_WEB_SITE "https://getbze.com"

# Install directory
InstallDir "$PROGRAMFILES64\BZE Hub"

# Create shortcuts
CreateShortCut "$DESKTOP\BZE Hub.lnk" "$INSTDIR\bze-hub.exe"
CreateShortCut "$SMPROGRAMS\BZE Hub\BZE Hub.lnk" "$INSTDIR\bze-hub.exe"
CreateShortCut "$SMPROGRAMS\BZE Hub\Uninstall.lnk" "$INSTDIR\uninstall.exe"
```

### Windows Code Signing (Optional)

```bash
# Using signtool (from Windows SDK)
signtool sign /f certificate.pfx /p password \
    /t http://timestamp.digicert.com \
    /d "BZE Hub" \
    bze-hub.exe
```

Requires a code signing certificate (EV or OV).

### Windows Manifest

The `build/windows/wails.exe.manifest` file configures:
- DPI awareness (per-monitor V2)
- UAC execution level (asInvoker - no admin required)
- Compatibility declarations (Windows 10/11)

## 5. Linux Specifics

### AppImage

Self-contained package that runs on most Linux distributions:

```bash
# Using linuxdeploy
linuxdeploy \
    --appdir AppDir \
    --executable build/bin/bze-hub \
    --desktop-file build/linux/bze-hub.desktop \
    --icon-file build/appicon.png \
    --output appimage
```

### Desktop Entry File

`build/linux/bze-hub.desktop`:

```ini
[Desktop Entry]
Name=BZE Hub
Comment=Desktop gateway to the BZE blockchain ecosystem
Exec=bze-hub
Icon=bze-hub
Type=Application
Categories=Finance;Network;
Terminal=false
StartupWMClass=bze-hub
```

### .deb Package (Optional)

For Debian/Ubuntu users who prefer APT:

```
bze-hub_1.0.0_amd64.deb
  /usr/bin/bze-hub
  /usr/share/applications/bze-hub.desktop
  /usr/share/icons/hicolor/256x256/apps/bze-hub.png
```

### Dependencies

Runtime dependencies that must be present:
- `libgtk-3-0`
- `libwebkit2gtk-4.0-37` (or newer)
- `libayatana-appindicator3-1` (for system tray, optional)

Document these in the AppImage's embedded AppRun script and the .deb package control file.

## 6. CI/CD Pipeline (GitHub Actions)

### Workflow Structure

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            platform: darwin/arm64
            artifact: BZE-Hub-darwin-arm64.dmg
          - os: macos-13  # Intel runner
            platform: darwin/amd64
            artifact: BZE-Hub-darwin-amd64.dmg
          - os: windows-latest
            platform: windows/amd64
            artifact: BZE-Hub-windows-amd64-installer.exe
          - os: ubuntu-latest
            platform: linux/amd64
            artifact: BZE-Hub-linux-amd64.AppImage
          - os: ubuntu-latest  # Cross-compile or use ARM runner
            platform: linux/arm64
            artifact: BZE-Hub-linux-arm64.AppImage

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.25'

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Wails CLI
        run: go install github.com/wailsapp/wails/v2/cmd/wails@latest

      - name: Install Linux dependencies
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev

      - name: Build
        run: |
          cd bze-hub
          wails build -platform ${{ matrix.platform }} \
            -ldflags "-s -w -X main.version=${{ github.ref_name }}"

      - name: Package (macOS)
        if: runner.os == 'macOS'
        run: |
          # Code sign if certificate available
          # Create DMG
          ...

      - name: Package (Windows)
        if: runner.os == 'Windows'
        run: |
          # Run NSIS installer builder
          ...

      - name: Package (Linux)
        if: runner.os == 'Linux'
        run: |
          # Create AppImage
          ...

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: build/dist/${{ matrix.artifact }}

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4

      - name: Generate checksums
        run: |
          sha256sum */* > SHA256SUMS.txt

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            **/*.dmg
            **/*.exe
            **/*.AppImage
            SHA256SUMS.txt
          body: |
            ## BZE Hub ${{ github.ref_name }}

            ### Downloads
            | Platform | Architecture | Download |
            |----------|-------------|----------|
            | macOS | ARM64 (Apple Silicon) | BZE-Hub-darwin-arm64.dmg |
            | macOS | AMD64 (Intel) | BZE-Hub-darwin-amd64.dmg |
            | Windows | AMD64 | BZE-Hub-windows-amd64-installer.exe |
            | Linux | AMD64 | BZE-Hub-linux-amd64.AppImage |
            | Linux | ARM64 | BZE-Hub-linux-arm64.AppImage |

            ### Verify Downloads
            ```bash
            sha256sum -c SHA256SUMS.txt
            ```
```

### Secrets Required

| Secret | Purpose |
|--------|---------|
| `APPLE_DEVELOPER_CERTIFICATE` | macOS code signing (base64-encoded .p12) |
| `APPLE_DEVELOPER_PASSWORD` | Certificate password |
| `APPLE_ID` | For notarization |
| `APPLE_ID_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Developer team ID |
| `WINDOWS_CERTIFICATE` | Windows code signing (optional) |

## 7. Versioning

### Semantic Versioning

The desktop app uses semantic versioning independent of the `bzed` node version:

```
BZE Hub v1.2.3
  ^       ^ ^ ^
  |       | | |
  app     major.minor.patch
```

- **Major**: Breaking changes to configuration format or data directories
- **Minor**: New features (new dashboard panels, new dApp tabs)
- **Patch**: Bug fixes, security patches

### Version Display

In the app: "BZE Hub v1.0.0 | Node: bzed v8.1.0 | Network: Mainnet"

### Version Embedding

```go
// Set at build time via -ldflags
var (
    version   = "dev"
    commit    = "unknown"
    buildDate = "unknown"
)

func Version() string {
    return fmt.Sprintf("BZE Hub %s (commit: %s, built: %s)", version, commit, buildDate)
}
```

## 8. Testing Before Release

### Automated Tests (CI)

```yaml
test:
  runs-on: ${{ matrix.os }}
  strategy:
    matrix:
      os: [macos-latest, windows-latest, ubuntu-latest]
  steps:
    - name: Go tests
      run: go test ./internal/... -v -race

    - name: Frontend tests
      run: |
        cd frontend
        npm ci
        npm test
```

### Smoke Test Checklist (Manual)

For each platform before release:

- [ ] App launches without errors
- [ ] First-launch wizard completes successfully
- [ ] Node binary downloads correctly for the platform
- [ ] Node initializes and begins state sync
- [ ] Wallet creation generates valid mnemonic and address
- [ ] Mnemonic import works (test with known mnemonic)
- [ ] Account switching reflects in all dApp tabs
- [ ] DEX tab loads and recognizes the injected Keplr bridge
- [ ] Burner tab loads and connects
- [ ] Staking tab loads and connects
- [ ] Transaction signing shows approval dialog
- [ ] Approving a transaction broadcasts successfully
- [ ] Rejecting a transaction returns error to dApp gracefully
- [ ] Node status panel shows correct sync progress
- [ ] Proxy failover works (stop local node, verify dApps continue working via public endpoints)
- [ ] Settings changes persist after app restart
- [ ] Auto-updater detects test release
- [ ] Update download and verification succeeds
- [ ] App quits cleanly (node process stops, keys zeroed)

### Integration Test for Keplr Bridge

```typescript
// test/bridge.test.ts
describe("Keplr Bridge", () => {
    test("enable returns without error for valid chain ID", async () => {
        await window.keplr.enable("beezee-1");
    });

    test("getKey returns valid key structure", async () => {
        const key = await window.keplr.getKey("beezee-1");
        expect(key.bech32Address).toMatch(/^bze1/);
        expect(key.algo).toBe("secp256k1");
        expect(key.pubKey).toBeInstanceOf(Uint8Array);
    });

    test("signAmino returns valid signature", async () => {
        const signer = await window.keplr.getOfflineSigner("beezee-1");
        const accounts = await signer.getAccounts();
        expect(accounts.length).toBeGreaterThan(0);

        const signDoc = { /* minimal amino sign doc */ };
        const result = await signer.signAmino(accounts[0].address, signDoc);
        expect(result.signature).toBeDefined();
    });
});
```

> **Open questions — Testing strategy** (to discuss before implementation):
> - How to test the postMessage bridge protocol end-to-end (hub-connector <-> shell <-> Go)?
> - How to test proxy failover reliably in CI (need to simulate node up/down)?
> - Cross-platform keyring testing: how to test macOS Keychain access control in CI (runners may not have Touch ID)?
> - How to test wallet signing without broadcasting real transactions (mock chain or testnet)?
> - Should we have integration tests that spin up a real dApp in an iframe and verify the bridge works?
> - Performance testing: how many concurrent proxy requests before degradation?
> - How to test the first-launch wizard flow in an automated way (it's heavily interactive)?

## 9. Distribution Channels

### Primary: GitHub Releases

All builds published as GitHub release assets with SHA256 checksums.

### Secondary (Future)

| Channel | Platform | Notes |
|---------|----------|-------|
| Homebrew Cask | macOS | `brew install --cask bze-hub` |
| Chocolatey | Windows | `choco install bze-hub` |
| Snap Store | Linux | `snap install bze-hub` |
| Flathub | Linux | Flatpak distribution |
| AUR | Arch Linux | Community-maintained |

These are nice-to-haves for later phases. GitHub Releases is sufficient for MVP.

## 10. Release Process

1. Update version in `wails.json` and Go constants
2. Create and push git tag: `git tag v1.0.0 && git push origin v1.0.0`
3. GitHub Actions builds all 5 platform targets
4. macOS builds are signed and notarized
5. All artifacts uploaded to GitHub Release draft
6. SHA256 checksums generated and attached
7. Write release notes (changelog, known issues, upgrade instructions)
8. Publish the release
9. Announce on BZE community channels
