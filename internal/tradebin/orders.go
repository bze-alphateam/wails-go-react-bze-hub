package tradebin

import (
	"errors"
	"fmt"

	"cosmossdk.io/math"
)

// Tradebin message type URLs. Cancel is built frontend-side (BHUB-28); its shape
// is documented here so the frontend and hub agree:
//
//	/bze.tradebin.MsgCancelOrder {creator, market_id, order_id, order_type}
//
// built the same way M1 builds MsgSend — no server-side computation needed, so
// there is no BuildCancelMessages binding. BuildOrderMessages below is the one
// place with real logic (the fill+place split).
const (
	MsgCreateOrderType = "/bze.tradebin.MsgCreateOrder"
	MsgCancelOrderType = "/bze.tradebin.MsgCancelOrder"
)

// minOrderPrice mirrors the chain's minPrice
// (x/tradebin/types/message_create_order.go: LegacyNewDecWithPrec(1, 10) =
// 0.0000000001). A valid order price must be strictly greater than this.
var minOrderPrice = math.LegacyNewDecWithPrec(1, 10)

// Typed validation errors, mirroring the chain's MsgCreateOrder rejection
// reasons so the hub rejects exactly what the chain would (before broadcasting).
var (
	ErrMarketIdRequired   = errors.New("market id is required")
	ErrInvalidOrderAmount = errors.New("amount must be a positive integer")
	ErrInvalidOrderPrice  = errors.New("price must be greater than 0.0000000001")
	ErrAmountBelowMinimum = errors.New("amount is below the market minimum for this price")
)

// ValidateOrderInput mirrors the tradebin chain's *stateless* order checks so a
// form can reject invalid input before broadcasting. It covers everything
// MsgCreateOrder.ValidateBasic checks plus the keeper's min-amount rule
// (CalculateMinAmount) — the only order rules that don't depend on live book
// state:
//
//   - market id present
//   - amount is a positive integer (u-amount)
//   - price parses and is > 0.0000000001 (u-price decimal)
//   - amount ≥ ceil(1/price)·2 (the chain's dust floor)
//
// The chain's remaining check — checkPrice, which forbids a resting price that
// crosses the current book — is stateful and is handled structurally by
// BuildOrderMessages (each emitted order is priced at a resting level or the
// non-crossing leftover) and finally enforced by the chain at broadcast. isBuy
// is accepted for a complete form-validation signature (order type is always
// valid given the bool).
func ValidateOrderInput(marketId string, isBuy bool, amount, price string) error {
	if marketId == "" {
		return ErrMarketIdRequired
	}
	amt, ok := math.NewIntFromString(amount)
	if !ok || !amt.IsPositive() {
		return ErrInvalidOrderAmount
	}
	priceDec, err := math.LegacyNewDecFromStr(price)
	if err != nil || priceDec.LTE(minOrderPrice) {
		return ErrInvalidOrderPrice
	}
	minAmt := calculateMinAmount(priceDec)
	if minAmt.GT(amt) {
		return fmt.Errorf("%w: minimum is %s", ErrAmountBelowMinimum, minAmt.String())
	}
	return nil
}

// calculateMinAmount ports the chain's CalculateMinAmount
// (x/tradebin/keeper/service_order_book.go): ceil(1/price)·2, truncated to an
// integer. priceDec is assumed non-zero (the caller rejects a zero/invalid
// price first).
func calculateMinAmount(priceDec math.LegacyDec) math.Int {
	return math.LegacyOneDec().Quo(priceDec).Ceil().MulInt64(2).TruncateInt()
}

// BuildOrderMessages computes the ordered tradebin message list for placing an
// order, a Go port of the web dapp's getOrderTxMessages
// (apps/dex/src/app/exchange/market/page.tsx). It fetches the opposite side's
// aggregated orders, selects the levels that cross the given limit price, emits
// one MsgCreateOrder per crossing level (at that level's price, capped to the
// remaining amount), then a final MsgCreateOrder for any leftover at the limit
// price. When nothing crosses it is a single MsgCreateOrder at the limit price.
// The whole list is broadcast as ONE tx by the frontend.
//
// amount and price are chain-native strings: amount is an integer u-amount and
// price is a u-price decimal. The frontend converts from display units (it has
// the assets' decimals) before calling. Messages are returned as proto-JSON
// maps ({"@type", creator, order_type, amount, price, market_id}) so they plug
// straight into useTx/SignAndBroadcast.
func BuildOrderMessages(rest RestClient, marketId, address string, isBuy bool, amount, price string) ([]map[string]interface{}, error) {
	orderType := OrderTypeSell
	oppositeType := OrderTypeBuy
	if isBuy {
		orderType = OrderTypeBuy
		oppositeType = OrderTypeSell
	}

	limitPrice, err := math.LegacyNewDecFromStr(price)
	if err != nil {
		return nil, fmt.Errorf("invalid price %q: %w", price, err)
	}
	remaining, ok := math.NewIntFromString(amount)
	if !ok {
		return nil, fmt.Errorf("invalid amount %q", amount)
	}

	// Opposite side, ordered best-first (lowest sells / highest buys) exactly as
	// the web activeOrders are — fetchAggregatedOrders reverses the buy side.
	levels, err := fetchAggregatedOrders(rest, marketId, oppositeType)
	if err != nil {
		return nil, err
	}

	// Crossing levels (web ordersFilter): for a buy, sells strictly below the
	// limit; for a sell, buys strictly above it.
	crossing := make([]OrderbookLevel, 0, len(levels))
	for _, lvl := range levels {
		lvlPrice, err := math.LegacyNewDecFromStr(lvl.Price)
		if err != nil {
			continue
		}
		if (isBuy && limitPrice.GT(lvlPrice)) || (!isBuy && limitPrice.LT(lvlPrice)) {
			crossing = append(crossing, lvl)
		}
	}

	// No crossing orders → a single limit order.
	if len(crossing) == 0 {
		return []map[string]interface{}{createOrderMsg(address, marketId, orderType, amount, price)}, nil
	}

	msgs := make([]map[string]interface{}, 0, len(crossing)+1)
	for _, lvl := range crossing {
		lvlAmt, ok := math.NewIntFromString(lvl.Amount)
		if !ok {
			continue
		}
		// Fill the whole level, or just what's left of our order.
		msgAmt := lvlAmt
		if lvlAmt.GT(remaining) {
			msgAmt = remaining
		}
		msgs = append(msgs, createOrderMsg(address, marketId, orderType, msgAmt.String(), lvl.Price))
		remaining = remaining.Sub(msgAmt)
		if remaining.IsZero() {
			break
		}
	}

	// Anything not filled becomes a resting limit order at the user's price.
	if remaining.IsPositive() {
		msgs = append(msgs, createOrderMsg(address, marketId, orderType, remaining.String(), price))
	}

	return msgs, nil
}

// createOrderMsg builds a MsgCreateOrder proto-JSON map. Field names are the
// snake_case proto names the signing codec decodes (see amm_test.go).
func createOrderMsg(creator, marketId, orderType, amount, price string) map[string]interface{} {
	return map[string]interface{}{
		"@type":      MsgCreateOrderType,
		"creator":    creator,
		"order_type": orderType,
		"amount":     amount,
		"price":      price,
		"market_id":  marketId,
	}
}
