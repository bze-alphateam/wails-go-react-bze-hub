package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// AppSettings holds all application settings, persisted to settings.json.
// Developer mode fields are always present with defaults; the UI toggle only controls visibility.
type AppSettings struct {
	// Normal mode
	Trusted          bool   `json:"trusted"`          // Whether device is trusted (show address without auth)
	AutoStartNode    bool   `json:"autoStartNode"`    // Default: true
	AutoCheckUpdates bool   `json:"autoCheckUpdates"` // Default: true
	Theme            string `json:"theme"`            // "light" or "dark"
	LogLevel         string `json:"logLevel"`         // "info" (default), "error", "debug"
	DeveloperMode    bool   `json:"developerMode"`    // Default: false

	// Developer mode — Node & Sync
	ResyncBlockThreshold int `json:"resyncBlockThreshold"` // Default: 28800 (~48h at 6s/block)
	MaxBlockAgeSec       int `json:"maxBlockAgeSec"`       // Default: 18

	// Developer mode — Proxy
	LocalNodeTimeoutMs        int `json:"localNodeTimeoutMs"`        // Default: 1500
	CircuitBreakerThreshold   int `json:"circuitBreakerThreshold"`   // Default: 3
	CircuitBreakerCooldownSec int `json:"circuitBreakerCooldownSec"` // Default: 120
	ProxyRESTPort             int `json:"proxyRestPort"`             // Default: 1418
	ProxyRPCPort              int `json:"proxyRpcPort"`              // Default: 26658

	// Developer mode — Health Monitor
	FastLoopIntervalSec  int `json:"fastLoopIntervalSec"`  // Default: 5
	SlowLoopIntervalSec  int `json:"slowLoopIntervalSec"`  // Default: 3600
	CrossCheckBlockDelta int `json:"crossCheckBlockDelta"` // Default: 2

	// Developer mode — Node Doctor
	DoctorRetryDelaysSec []int `json:"doctorRetryDelaysSec"` // Default: [5, 30, 120, 300]
}

// DefaultSettings returns settings with all defaults applied.
func DefaultSettings() AppSettings {
	return AppSettings{
		Trusted:                   false,
		AutoStartNode:             true,
		AutoCheckUpdates:          true,
		Theme:                     "light",
		LogLevel:                  "info",
		DeveloperMode:             false,
		ResyncBlockThreshold:      28800,
		MaxBlockAgeSec:            18,
		LocalNodeTimeoutMs:        1500,
		CircuitBreakerThreshold:   3,
		CircuitBreakerCooldownSec: 120,
		ProxyRESTPort:             2317,
		ProxyRPCPort:              36657,
		FastLoopIntervalSec:       5,
		SlowLoopIntervalSec:       3600,
		CrossCheckBlockDelta:      2,
		DoctorRetryDelaysSec:      []int{5, 30, 120, 300},
	}
}

func settingsPath() string {
	return filepath.Join(ConfigDir(), "settings.json")
}

// LoadSettings reads settings from disk. Returns defaults if file doesn't exist.
// Unmarshals into defaults so new fields added in future versions get their defaults.
func LoadSettings() (AppSettings, error) {
	s := DefaultSettings()
	data, err := os.ReadFile(settingsPath())
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return DefaultSettings(), err
	}
	return s, nil
}

// SaveSettings writes settings to disk.
func SaveSettings(s AppSettings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(settingsPath(), data, 0600)
}

// SettingsExist returns true if settings.json exists (used for first-run detection).
func SettingsExist() bool {
	_, err := os.Stat(settingsPath())
	return err == nil
}
