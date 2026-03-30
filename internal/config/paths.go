package config

import (
	"os"
	"path/filepath"
	"runtime"
)

const appName = "bze-hub"

// AppDataDir returns the platform-specific application data directory.
func AppDataDir() string {
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(os.Getenv("HOME"), "Library", "Application Support", appName)
	case "windows":
		return filepath.Join(os.Getenv("APPDATA"), appName)
	default: // linux
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, appName)
		}
		return filepath.Join(os.Getenv("HOME"), ".local", "share", appName)
	}
}

// ConfigDir returns the path to the config subdirectory.
func ConfigDir() string {
	return filepath.Join(AppDataDir(), "config")
}

// LogsDir returns the path to the logs subdirectory.
func LogsDir() string {
	return filepath.Join(AppDataDir(), "logs")
}

// EnsureDirs creates all required directories if they don't exist.
func EnsureDirs() error {
	dirs := []string{
		ConfigDir(),
		LogsDir(),
		filepath.Join(AppDataDir(), "bin"),
		filepath.Join(AppDataDir(), "node"),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
	}
	return nil
}
