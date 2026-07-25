package events

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/logging"
	"github.com/gorilla/websocket"
)

// Connection tuning. pingPeriod must stay below pongWait so a stalled peer is
// detected within one pong window.
const (
	defaultInitialBackoff = 1 * time.Second
	defaultMaxBackoff     = 30 * time.Second
	// stableThreshold: a connection that lasted at least this long before dropping
	// is treated as healthy, so the next reconnect starts from the initial backoff
	// instead of an inflated one. Rapid failures keep escalating the backoff.
	defaultStableThreshold = 15 * time.Second

	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 30 * time.Second
)

// Stream maintains a single CometBFT WebSocket subscription (NewBlock + Tx) to
// the RPC proxy and re-emits classified events via emit. It reconnects with
// exponential backoff and resubscribes automatically. Because it connects to the
// proxy (not a node directly), local↔public failover and node restarts surface
// here as an ordinary dropped connection — the reconnect loop resumes silently.
type Stream struct {
	wsURL string
	emit  func(name string, data interface{})
	reg   *Registry

	initialBackoff  time.Duration
	maxBackoff      time.Duration
	stableThreshold time.Duration
}

// NewStream builds a stream that will connect to wsURL (e.g.
// ws://127.0.0.1:26658/websocket) and emit via emit. A nil registry uses the
// default (block + tx) classifiers.
func NewStream(wsURL string, emit func(name string, data interface{}), reg *Registry) *Stream {
	if reg == nil {
		reg = NewRegistry()
	}
	return &Stream{
		wsURL:           wsURL,
		emit:            emit,
		reg:             reg,
		initialBackoff:  defaultInitialBackoff,
		maxBackoff:      defaultMaxBackoff,
		stableThreshold: defaultStableThreshold,
	}
}

// Run connects and serves until ctx is cancelled, reconnecting with exponential
// backoff on any error. Launch via routines.Manager.Go so it stops cleanly on
// shutdown.
func (s *Stream) Run(ctx context.Context) {
	backoff := s.initialBackoff
	for {
		if ctx.Err() != nil {
			return
		}

		start := nowFunc()
		err := s.serve(ctx)
		if ctx.Err() != nil {
			return
		}

		// A connection that stayed up past the stable threshold resets the
		// backoff, so a healthy stream that drops reconnects promptly; a flapping
		// endpoint keeps backing off.
		if nowFunc().Sub(start) >= s.stableThreshold {
			backoff = s.initialBackoff
		}
		logging.Info("events", "stream disconnected (%v); reconnecting in %s", err, backoff)

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = nextBackoff(backoff, s.maxBackoff)
	}
}

// nowFunc is time.Now, overridable in tests.
var nowFunc = time.Now

// nextBackoff doubles cur, capped at max.
func nextBackoff(cur, max time.Duration) time.Duration {
	next := cur * 2
	if next > max {
		return max
	}
	return next
}

// serve dials, subscribes, and pumps messages until an error or ctx cancel.
// It always returns a non-nil error describing why the connection ended (ctx
// cancel included) so Run can log and reconnect.
func (s *Stream) serve(ctx context.Context) error {
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, s.wsURL, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()
	logging.Info("events", "connected to %s", s.wsURL)

	if err := subscribe(conn); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}

	// Keepalive: each pong (and each message) extends the read deadline; a ping
	// ticker keeps the connection warm and detects a dead peer within pongWait.
	_ = conn.SetReadDeadline(nowFunc().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(nowFunc().Add(pongWait))
	})

	// Close the connection when ctx is cancelled so the blocking ReadMessage below
	// unblocks and serve returns.
	stop := make(chan struct{})
	defer close(stop)
	go s.keepAlive(ctx, conn, stop)

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		_ = conn.SetReadDeadline(nowFunc().Add(pongWait))
		s.handle(data)
	}
}

// keepAlive pings periodically and closes the connection on ctx cancel or a
// failed ping, so serve's read loop exits.
func (s *Stream) keepAlive(ctx context.Context, conn *websocket.Conn, stop <-chan struct{}) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = conn.Close()
			return
		case <-stop:
			return
		case <-ticker.C:
			_ = conn.SetWriteDeadline(nowFunc().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				_ = conn.Close()
				return
			}
		}
	}
}

// subscribe sends the NewBlock and Tx subscription requests. CometBFT echoes the
// request id on every notification for that subscription.
func subscribe(conn *websocket.Conn) error {
	subs := []struct {
		id    int
		query string
	}{
		{1, queryNewBlock},
		{2, queryTx},
	}
	for _, sub := range subs {
		msg := map[string]interface{}{
			"jsonrpc": "2.0",
			"method":  "subscribe",
			"id":      sub.id,
			"params":  map[string]interface{}{"query": sub.query},
		}
		_ = conn.SetWriteDeadline(nowFunc().Add(writeWait))
		if err := conn.WriteJSON(msg); err != nil {
			return err
		}
	}
	return nil
}

// handle decodes one frame, classifies it, and emits any resulting events.
// Subscription acks (empty result data) and error frames are ignored.
func (s *Stream) handle(data []byte) {
	var msg rpcMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		logging.Debug("events", "unparsable message: %v", err)
		return
	}
	if msg.Error != nil {
		logging.Debug("events", "rpc error: %s", msg.Error.Message)
		return
	}
	if msg.Result.Data.Type == "" {
		return // subscription ack or non-event frame
	}
	for _, ev := range s.reg.Classify(&msg) {
		if s.emit != nil {
			s.emit(ev.Name, ev.Data)
		}
	}
}
