package config

import (
	"os"
	"path/filepath"
	"testing"
)

// isolateConfigDir points ConfigDir() at a fresh temp dir for the duration of
// the test (linux honours XDG_DATA_HOME — see AppDataDir).
func isolateConfigDir(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_DATA_HOME", dir)
	if err := os.MkdirAll(ConfigDir(), 0700); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}
}

func TestDefaultSettingsSectionViewsEmpty(t *testing.T) {
	s := DefaultSettings()
	if s.SectionViews == nil {
		t.Fatal("SectionViews should be initialised (non-nil) on defaults")
	}
	if len(s.SectionViews) != 0 {
		t.Fatalf("SectionViews should be empty on fresh install, got %v", s.SectionViews)
	}
}

func TestLoadSettingsMissingFileReturnsDefaults(t *testing.T) {
	isolateConfigDir(t)

	s, err := LoadSettings()
	if err != nil {
		t.Fatalf("LoadSettings: %v", err)
	}
	if len(s.SectionViews) != 0 {
		t.Fatalf("expected empty SectionViews on fresh data dir, got %v", s.SectionViews)
	}
}

func TestSaveAndLoadSectionViews(t *testing.T) {
	isolateConfigDir(t)

	s := DefaultSettings()
	s.SectionViews["view.earn"] = "advanced"
	s.SectionViews["view.trade"] = "simple"
	if err := SaveSettings(s); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}

	loaded, err := LoadSettings()
	if err != nil {
		t.Fatalf("LoadSettings: %v", err)
	}
	if got := loaded.SectionViews["view.earn"]; got != "advanced" {
		t.Fatalf("view.earn = %q, want advanced", got)
	}
	if got := loaded.SectionViews["view.trade"]; got != "simple" {
		t.Fatalf("view.trade = %q, want simple", got)
	}
}

// A settings.json written before SectionViews existed must still load, with the
// field defaulting to an empty (non-nil) map.
func TestLoadSettingsLegacyFileWithoutSectionViews(t *testing.T) {
	isolateConfigDir(t)

	legacy := `{"trusted":true,"autoStartNode":false,"theme":"dark","logLevel":"debug"}`
	if err := os.WriteFile(filepath.Join(ConfigDir(), "settings.json"), []byte(legacy), 0600); err != nil {
		t.Fatalf("write legacy settings: %v", err)
	}

	s, err := LoadSettings()
	if err != nil {
		t.Fatalf("LoadSettings: %v", err)
	}
	if s.SectionViews == nil {
		t.Fatal("SectionViews should default to a non-nil map for legacy files")
	}
	if len(s.SectionViews) != 0 {
		t.Fatalf("SectionViews should be empty for legacy files, got %v", s.SectionViews)
	}
	// Sanity: the legacy fields still loaded.
	if !s.Trusted || s.Theme != "dark" {
		t.Fatalf("legacy fields not loaded: %+v", s)
	}
}
