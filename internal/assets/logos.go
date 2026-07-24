package assets

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/bze-alphateam/bze-hub/internal/config"
)

// maxLogoBytes caps a single logo download (logos are small; this guards against
// a misconfigured URL streaming a huge body).
const maxLogoBytes = 2 << 20 // 2 MiB

// logoCache downloads asset logos once and serves them to the UI as data URLs,
// so the React side never makes a network request. Downloaded bytes are cached
// both in memory and on disk (app data dir), keyed by denom. A denom known to
// have no usable logo is memoised as an empty string so it isn't retried every
// render. Safe for concurrent use.
type logoCache struct {
	mu       sync.Mutex
	dir      string
	http     *http.Client
	mem      map[string]string // denom → data URL ("" = known missing)
	inflight map[string]bool
}

func newLogoCache(client *http.Client) *logoCache {
	return &logoCache{
		dir:      filepath.Join(config.AppDataDir(), "assets", "logos"),
		http:     client,
		mem:      map[string]string{},
		inflight: map[string]bool{},
	}
}

// diskPath is the on-disk file for a denom's logo, named by a hash of the denom
// (denoms contain slashes) plus the source extension so the mime type survives
// a restart.
func (c *logoCache) diskPath(denom, ext string) string {
	sum := sha256.Sum256([]byte(denom))
	return filepath.Join(c.dir, hex.EncodeToString(sum[:])+ext)
}

// get returns a cached data URL for a denom. It checks memory first, then disk
// (for the two extensions we persist). ok=false means "not cached yet" — an
// empty data URL cached in memory (known-missing) returns ("", true).
func (c *logoCache) get(denom string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.getLocked(denom)
}

func (c *logoCache) getLocked(denom string) (string, bool) {
	if url, ok := c.mem[denom]; ok {
		return url, true
	}
	for _, ext := range []string{".svg", ".png"} {
		if data, err := os.ReadFile(c.diskPath(denom, ext)); err == nil {
			url := dataURL(mimeForExt(ext), data)
			c.mem[denom] = url
			return url, true
		}
	}
	return "", false
}

// fetch returns the cached data URL for a denom or, on a miss, downloads the
// first candidate URL that succeeds, persists it, and memoises it. When no
// candidate yields an image the denom is memoised as known-missing (""), so
// subsequent calls return immediately and the UI falls back to its placeholder.
func (c *logoCache) fetch(denom string, candidates []string) string {
	c.mu.Lock()
	if url, ok := c.getLocked(denom); ok {
		c.mu.Unlock()
		return url
	}
	c.mu.Unlock()

	for _, src := range candidates {
		data, ext, ok := c.download(src)
		if !ok {
			continue
		}
		if err := c.persist(denom, ext, data); err != nil {
			// Disk write failure is non-fatal: still serve from memory.
			_ = err
		}
		url := dataURL(mimeForExt(ext), data)
		c.mu.Lock()
		c.mem[denom] = url
		c.mu.Unlock()
		return url
	}

	// Nothing worked — remember that so we don't retry on every render.
	c.mu.Lock()
	c.mem[denom] = ""
	c.mu.Unlock()
	return ""
}

// download GETs a single logo URL. Returns the bytes and a normalised file
// extension (".svg"/".png") on success.
func (c *logoCache) download(src string) ([]byte, string, bool) {
	resp, err := c.http.Get(src)
	if err != nil {
		return nil, "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", false
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxLogoBytes))
	if err != nil || len(data) == 0 {
		return nil, "", false
	}
	return data, extForSource(src, resp.Header.Get("Content-Type")), true
}

// persist writes a logo to disk, creating the cache dir on first use.
func (c *logoCache) persist(denom, ext string, data []byte) error {
	if err := os.MkdirAll(c.dir, 0700); err != nil {
		return err
	}
	return os.WriteFile(c.diskPath(denom, ext), data, 0600)
}

// --- helpers ---------------------------------------------------------------

// extForSource picks ".svg" or ".png" from the source URL extension, falling
// back to the content-type, then defaulting to ".png".
func extForSource(src, contentType string) string {
	switch {
	case strings.HasSuffix(strings.ToLower(src), ".svg"):
		return ".svg"
	case strings.HasSuffix(strings.ToLower(src), ".png"):
		return ".png"
	case strings.Contains(contentType, "svg"):
		return ".svg"
	default:
		return ".png"
	}
}

func mimeForExt(ext string) string {
	if ext == ".svg" {
		return "image/svg+xml"
	}
	return "image/png"
}

func dataURL(mime string, data []byte) string {
	return fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data))
}
