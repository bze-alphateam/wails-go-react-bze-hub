package main

import (
	"context"
	"fmt"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/assets"
	"github.com/bze-alphateam/bze-hub/internal/logging"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// initAssetEngine constructs the asset engine from the embedded chain-registry
// snapshot (synchronous, no network — startup is never delayed) and launches a
// non-blocking background refresh that swaps in fresh registry data and emits
// "assets:updated" when it lands. Idempotent: safe to call from either node
// setup path.
func (a *App) initAssetEngine() {
	if a.assetEngine != nil {
		return
	}
	if a.chainClient == nil {
		logging.Error("assets", "cannot init asset engine: chain client not ready")
		return
	}

	engine, err := assets.NewEngine(a.chainClient, func(event string, data interface{}) {
		wailsRuntime.EventsEmit(a.ctx, event, data)
	})
	if err != nil {
		logging.Error("assets", "failed to init asset engine: %v", err)
		return
	}
	a.assetEngine = engine
	logging.Info("assets", "asset engine initialized (embedded snapshot)")

	// Refresh the registry once in the background — bounded by the routine
	// manager, never blocking.
	a.routines.Go("assets-refresh", func(ctx context.Context) {
		engine.Refresh(ctx)
	})

	// Keep USD prices fresh: an immediate fetch then a periodic refresh (the
	// engine throttles to the 5-minute TTL). Emits "assets:updated" on each new
	// price set so the UI re-reads values.
	a.routines.Go("assets-prices", func(ctx context.Context) {
		engine.RefreshPrices(ctx)
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				engine.RefreshPrices(ctx)
			}
		}
	})
}

// GetAssets returns every non-excluded asset on the chain, resolved to its token
// identity (symbol/name/decimals/verified) with the active account's balance and
// on-chain supply attached. Bound to the frontend via Wails.
func (a *App) GetAssets() ([]assets.AssetBalance, error) {
	if a.assetEngine == nil {
		return nil, fmt.Errorf("asset engine not initialized")
	}
	return a.assetEngine.AllAssets(a.appState.GetActiveAddress())
}

// ResolveDenom resolves a single denom to its token identity. Bound to the
// frontend via Wails.
func (a *App) ResolveDenom(denom string) (assets.Asset, error) {
	if a.assetEngine == nil {
		return assets.Asset{}, fmt.Errorf("asset engine not initialized")
	}
	if denom == "" {
		return assets.Asset{}, fmt.Errorf("empty denom")
	}
	return a.assetEngine.Resolve(denom), nil
}

// GetPrices returns the current denom→USD unit price map (decimal strings). Only
// denoms with a known price are present. Bound to the frontend via Wails.
func (a *App) GetPrices() (map[string]string, error) {
	if a.assetEngine == nil {
		return nil, fmt.Errorf("asset engine not initialized")
	}
	return a.assetEngine.Prices()
}

// GetAssetLogo returns a data URL for a denom's logo (downloaded once and cached
// by the Go side, so the UI never makes a network request). Returns "" when the
// asset has no logo or the download failed — the frontend falls back to a
// placeholder then the symbol's initial. Bound to the frontend via Wails.
func (a *App) GetAssetLogo(denom string) (string, error) {
	if a.assetEngine == nil {
		return "", fmt.Errorf("asset engine not initialized")
	}
	if denom == "" {
		return "", nil
	}
	return a.assetEngine.LogoDataURL(denom), nil
}
