package events

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestNextBackoff(t *testing.T) {
	max := 30 * time.Second
	if got := nextBackoff(time.Second, max); got != 2*time.Second {
		t.Errorf("nextBackoff(1s) = %s, want 2s", got)
	}
	if got := nextBackoff(20*time.Second, max); got != max {
		t.Errorf("nextBackoff(20s) capped = %s, want %s", got, max)
	}
	if got := nextBackoff(max, max); got != max {
		t.Errorf("nextBackoff at cap = %s, want %s", got, max)
	}
}

const (
	blockFrame = `{"jsonrpc":"2.0","id":1,"result":{"query":"tm.event='NewBlock'","data":{"type":"tendermint/event/NewBlock","value":{"block":{"header":{"height":"100"}}}},"events":{"tm.event":["NewBlock"]}}}`
	txFrame    = `{"jsonrpc":"2.0","id":2,"result":{"query":"tm.event='Tx'","data":{"type":"tendermint/event/Tx","value":{}},"events":{"tx.height":["100"],"transfer.recipient":["bze1me"]}}}`
)

// TestStreamSubscribesEmitsAndReconnects spins a mock CometBFT WS endpoint that
// serves one block+tx frame then drops the first connection, and verifies the
// stream (a) sends both subscribe requests, (b) emits classified chain:block /
// chain:tx events, and (c) reconnects and resumes after the drop.
func TestStreamSubscribesEmitsAndReconnects(t *testing.T) {
	var conns int32
	var mu sync.Mutex
	var firstSubs []string // subscribe queries seen on the first connection
	up := websocket.Upgrader{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		n := atomic.AddInt32(&conns, 1)

		// Drain the two subscribe requests; record them on the first connection.
		for i := 0; i < 2; i++ {
			_, msg, err := c.ReadMessage()
			if err != nil {
				return
			}
			if n == 1 {
				mu.Lock()
				firstSubs = append(firstSubs, string(msg))
				mu.Unlock()
			}
		}

		_ = c.WriteMessage(websocket.TextMessage, []byte(blockFrame))
		_ = c.WriteMessage(websocket.TextMessage, []byte(txFrame))

		if n == 1 {
			return // drop → force a reconnect
		}
		// Later connections stay open until the client goes away.
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/websocket"
	emitted := make(chan Event, 64)
	s := NewStream(wsURL, func(name string, data interface{}) {
		emitted <- Event{Name: name, Data: data.(map[string]interface{})}
	}, nil)
	s.initialBackoff = 5 * time.Millisecond
	s.maxBackoff = 20 * time.Millisecond
	s.stableThreshold = time.Hour // connections here are short-lived; always back off

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx)

	// Collect events until we've seen two block frames (proving a reconnect) or time out.
	blocks, txs := 0, 0
	var lastTxAddrs []string
	deadline := time.After(3 * time.Second)
	for blocks < 2 {
		select {
		case ev := <-emitted:
			switch ev.Name {
			case BlockEvent:
				blocks++
				if ev.Data["height"] != "100" {
					t.Errorf("block height = %v, want 100", ev.Data["height"])
				}
			case TxEvent:
				txs++
				lastTxAddrs, _ = ev.Data["addresses"].([]string)
			}
		case <-deadline:
			t.Fatalf("timed out; got %d blocks, %d txs, %d connections", blocks, txs, atomic.LoadInt32(&conns))
		}
	}

	if atomic.LoadInt32(&conns) < 2 {
		t.Errorf("connections = %d, want >= 2 (reconnect)", atomic.LoadInt32(&conns))
	}
	if txs < 1 {
		t.Error("expected at least one chain:tx")
	}
	if len(lastTxAddrs) != 1 || lastTxAddrs[0] != "bze1me" {
		t.Errorf("tx addresses = %v, want [bze1me]", lastTxAddrs)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(firstSubs) != 2 ||
		!strings.Contains(firstSubs[0], queryNewBlock) ||
		!strings.Contains(firstSubs[1], queryTx) {
		t.Errorf("subscribe frames = %v, want NewBlock then Tx", firstSubs)
	}
}

// TestStreamStopsOnContextCancel verifies Run returns promptly when its context
// is cancelled (clean shutdown via the routines manager).
func TestStreamStopsOnContextCancel(t *testing.T) {
	up := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/websocket"
	s := NewStream(wsURL, func(string, interface{}) {}, nil)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { s.Run(ctx); close(done) }()

	time.Sleep(50 * time.Millisecond) // let it connect
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after context cancel")
	}
}
