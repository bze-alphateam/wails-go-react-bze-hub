package main

import (
	"context"
)

// App struct holds the application state and provides methods
// that are bound to the frontend via Wails.
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct.
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// shutdown is called when the app is closing. Clean up resources here.
func (a *App) shutdown(ctx context.Context) {
	// Future: stop node, zero wallet keys, stop proxy, flush logs
}

// GetVersion returns the application version.
func (a *App) GetVersion() string {
	return "0.1.0"
}
