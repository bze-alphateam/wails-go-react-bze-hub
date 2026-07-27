package main

import (
	"fmt"

	"github.com/bze-alphateam/bze-hub/internal/logging"
	"github.com/bze-alphateam/bze-hub/internal/tradebin"
)

// tradebin.go — Wails bindings for the DEX trading terminal and pools. On-chain
// reads (markets, orderbook, my orders, params) go through the REST proxy; 24h
// stats, trade history, candles and pool volumes come from the public aggregator
// (host configurable via the AggregatorHost setting, default getbze.com). Mirrors
// the web ui-kit query layer. Order placement/cancel messages are built
// frontend-side and signed through the existing SignAndBroadcast binding.

// aggregator builds an aggregator client from the current settings.
func (a *App) aggregator() *tradebin.Aggregator {
	return tradebin.NewAggregator(a.settings.AggregatorHost)
}

// GetMarkets returns every tradebin order-book market merged with its 24h stats.
// Markets come from the node; stats from the aggregator. If the aggregator is
// unreachable the markets still list with StatsAvailable=false — never an error.
func (a *App) GetMarkets() ([]tradebin.MarketWithStats, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}
	markets, err := tradebin.FetchMarketsWithStats(a.chainClient, a.aggregator())
	if err != nil {
		logging.Error("tradebin", "GetMarkets: %v", err)
		return nil, fmt.Errorf("get markets: %w", err)
	}
	return markets, nil
}

// GetOrderbook returns the two-sided aggregated orderbook (buy/sell levels) for
// a market, from the node only (never the aggregator).
func (a *App) GetOrderbook(marketId string) (tradebin.Orderbook, error) {
	if a.chainClient == nil {
		return tradebin.Orderbook{}, fmt.Errorf("chain client not initialized")
	}
	ob, err := tradebin.FetchOrderbook(a.chainClient, marketId)
	if err != nil {
		logging.Error("tradebin", "GetOrderbook %s: %v", marketId, err)
		return tradebin.Orderbook{}, fmt.Errorf("get orderbook: %w", err)
	}
	return ob, nil
}

// GetMyOrders returns the caller's resting orders on a market, fully hydrated.
// An empty address falls back to the active account. Node-sourced only.
func (a *App) GetMyOrders(marketId, address string) ([]tradebin.Order, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}
	if address == "" {
		address = a.appState.GetActiveAddress()
	}
	orders, err := tradebin.FetchMyOrders(a.chainClient, marketId, address)
	if err != nil {
		logging.Error("tradebin", "GetMyOrders %s: %v", marketId, err)
		return nil, fmt.Errorf("get my orders: %w", err)
	}
	return orders, nil
}

// GetMarketParams returns the tradebin fee parameters for form display/validation.
func (a *App) GetMarketParams() (tradebin.MarketParams, error) {
	if a.chainClient == nil {
		return tradebin.MarketParams{}, fmt.Errorf("chain client not initialized")
	}
	params, err := tradebin.FetchMarketParams(a.chainClient)
	if err != nil {
		logging.Error("tradebin", "GetMarketParams: %v", err)
		return tradebin.MarketParams{}, fmt.Errorf("get market params: %w", err)
	}
	return params, nil
}

// BuildOrderMessages returns the ordered tradebin message list for placing an
// order (fill crossing resting orders, then place the remainder as a limit
// order), for the frontend to broadcast as one tx via SignAndBroadcast. amount
// and price are chain-native strings (u-amount integer / u-price decimal); the
// frontend converts from display units first. Node-sourced (reads the opposite
// side of the book).
func (a *App) BuildOrderMessages(marketId, address string, isBuy bool, amount, price string) ([]map[string]interface{}, error) {
	if a.chainClient == nil {
		return nil, fmt.Errorf("chain client not initialized")
	}
	if address == "" {
		address = a.appState.GetActiveAddress()
	}
	msgs, err := tradebin.BuildOrderMessages(a.chainClient, marketId, address, isBuy, amount, price)
	if err != nil {
		logging.Error("tradebin", "BuildOrderMessages %s: %v", marketId, err)
		return nil, fmt.Errorf("build order messages: %w", err)
	}
	return msgs, nil
}

// ValidateOrderInput mirrors the chain's stateless order rules (amount/price
// bounds, min-amount) so a form can reject invalid input before broadcasting.
// Returns nil when valid, or a human-readable error the form can surface.
func (a *App) ValidateOrderInput(marketId string, isBuy bool, amount, price string) error {
	return tradebin.ValidateOrderInput(marketId, isBuy, amount, price)
}

// GetMarketHistory returns recent trades for a market from the aggregator.
func (a *App) GetMarketHistory(marketId string) ([]tradebin.Trade, error) {
	trades, err := a.aggregator().MarketHistory(marketId)
	if err != nil {
		logging.Error("tradebin", "GetMarketHistory %s: %v", marketId, err)
		return nil, fmt.Errorf("get market history: %w", err)
	}
	return trades, nil
}

// GetAddressMarketHistory returns a specific address's trade history on a market
// from the aggregator. An empty address falls back to the active account.
func (a *App) GetAddressMarketHistory(marketId, address string) ([]tradebin.Trade, error) {
	if address == "" {
		address = a.appState.GetActiveAddress()
	}
	trades, err := a.aggregator().AddressMarketHistory(marketId, address)
	if err != nil {
		logging.Error("tradebin", "GetAddressMarketHistory %s: %v", marketId, err)
		return nil, fmt.Errorf("get address market history: %w", err)
	}
	return trades, nil
}

// GetCandles returns TradingView-shaped candles for a market at the given
// interval (minutes) and count (limit) from the aggregator.
func (a *App) GetCandles(marketId string, minutes int, limit int) ([]tradebin.Candle, error) {
	candles, err := a.aggregator().Candles(marketId, minutes, limit)
	if err != nil {
		logging.Error("tradebin", "GetCandles %s: %v", marketId, err)
		return nil, fmt.Errorf("get candles: %w", err)
	}
	return candles, nil
}

// GetPoolsStats returns per-pool 24h stats from the aggregator. TVL/APR are
// composed frontend-side (BHUB-30) from these volumes plus pool reserves and
// USD prices.
func (a *App) GetPoolsStats() ([]tradebin.PoolStat, error) {
	stats, err := a.aggregator().PoolsStats()
	if err != nil {
		logging.Error("tradebin", "GetPoolsStats: %v", err)
		return nil, fmt.Errorf("get pools stats: %w", err)
	}
	return stats, nil
}
