package assets

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// pngBytes is a tiny valid-enough PNG header; content isn't validated, only cached.
var pngBytes = []byte("\x89PNG\r\n\x1a\nfake-logo")

func TestLogoCacheHitMiss(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())

	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(pngBytes)
	}))
	defer srv.Close()

	c := newLogoCache(srv.Client())
	denom := "ubze"
	src := srv.URL + "/beezee/images/bze.png"

	// Miss → downloads once, returns a png data URL.
	url := c.fetch(denom, []string{src})
	if !strings.HasPrefix(url, "data:image/png;base64,") {
		t.Fatalf("data URL = %q, want png data URL", url)
	}
	if hits != 1 {
		t.Fatalf("hits after first fetch = %d, want 1", hits)
	}

	// Memory hit → no new download.
	if got, ok := c.get(denom); !ok || got != url {
		t.Errorf("mem get = %q ok=%v, want cached url", got, ok)
	}
	if _ = c.fetch(denom, []string{src}); hits != 1 {
		t.Errorf("hits after mem hit = %d, want 1", hits)
	}

	// Fresh cache (cold memory) over the same dir → disk hit, still no download.
	c2 := newLogoCache(srv.Client())
	got, ok := c2.get(denom)
	if !ok || got != url {
		t.Errorf("disk get = %q ok=%v, want cached url", got, ok)
	}
	if hits != 1 {
		t.Errorf("hits after disk hit = %d, want 1", hits)
	}
}

func TestLogoCacheFallsBackThroughCandidates(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".svg") {
			w.WriteHeader(http.StatusNotFound) // first candidate fails
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(pngBytes)
	}))
	defer srv.Close()

	c := newLogoCache(srv.Client())
	url := c.fetch("uosmo", []string{srv.URL + "/osmo.svg", srv.URL + "/osmo.png"})
	if !strings.HasPrefix(url, "data:image/png;base64,") {
		t.Errorf("expected png fallback data URL, got %q", url)
	}
}

func TestLogoCacheKnownMissing(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())

	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c := newLogoCache(srv.Client())
	if url := c.fetch("umystery", []string{srv.URL + "/x.png"}); url != "" {
		t.Errorf("failed download should yield empty data URL, got %q", url)
	}
	// Known-missing is memoised: a second fetch doesn't hit the network again.
	if url := c.fetch("umystery", []string{srv.URL + "/x.png"}); url != "" {
		t.Errorf("second fetch = %q, want empty", url)
	}
	if hits != 1 {
		t.Errorf("hits = %d, want 1 (known-missing memoised)", hits)
	}
}

func TestLogoDataURLNoCandidates(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	eng, err := NewEngine(&mockRest{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	// An LP denom has no registry logo → empty, and no panic.
	if url := eng.LogoDataURL("ulp/POOLHASH"); url != "" {
		t.Errorf("LP logo = %q, want empty", url)
	}
}
