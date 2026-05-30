package node

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/state"
)

// blockHeightServer returns an httptest server that answers the CometBFT
// /block query with the given latest height. It records how many times it was
// hit via reqCount (may be nil).
func blockHeightServer(height int64, reqCount *int32) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if reqCount != nil {
			atomic.AddInt32(reqCount, 1)
		}
		fmt.Fprintf(w, `{"result":{"block":{"header":{"height":"%d"}}}}`, height)
	}))
}

func newTestMonitor(serverURL string, threshold int, onResync func()) *HealthMonitor {
	cfg := HealthConfig{MaxBlocksBehindResync: threshold}
	remoteCfg := &RemoteConfig{StateSyncRPCServers: []string{serverURL}}
	return NewHealthMonitor(state.New(), NewNodeProcess(PortSet{}), cfg, remoteCfg, PortSet{}, onResync, nil)
}

// waitFor polls cond until it is true or the timeout elapses.
func waitFor(timeout time.Duration, cond func() bool) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	return cond()
}

func TestLagResyncCheck_TriggersWhenTooFarBehind(t *testing.T) {
	const local = 22_186_180
	const threshold = 14_400
	srv := blockHeightServer(local+threshold+1, nil)
	defer srv.Close()

	var triggered int32
	hm := newTestMonitor(srv.URL, threshold, func() { atomic.AddInt32(&triggered, 1) })

	hm.lagResyncCheck(local)

	if atomic.LoadInt32(&triggered) != 1 {
		t.Fatalf("expected resync to trigger once when %d blocks behind (> threshold %d), got %d triggers",
			threshold+1, threshold, triggered)
	}
}

func TestLagResyncCheck_NoTriggerWithinThreshold(t *testing.T) {
	const local = 22_186_180
	const threshold = 14_400
	srv := blockHeightServer(local+threshold-1, nil) // just under the threshold
	defer srv.Close()

	var triggered int32
	hm := newTestMonitor(srv.URL, threshold, func() { atomic.AddInt32(&triggered, 1) })

	hm.lagResyncCheck(local)

	if atomic.LoadInt32(&triggered) != 0 {
		t.Fatalf("expected no resync when within threshold, got %d triggers", triggered)
	}
}

func TestLagResyncCheck_UpdatesTargetHeight(t *testing.T) {
	const local = 22_186_180
	const pub = 23_036_361
	srv := blockHeightServer(pub, nil)
	defer srv.Close()

	hm := newTestMonitor(srv.URL, 14_400, func() {})
	hm.lagResyncCheck(local)

	if got := hm.appState.GetNodeSnapshot().TargetHeight; got != pub {
		t.Fatalf("expected target height %d, got %d", pub, got)
	}
}

func TestLagResyncCheck_SkipsWhenAlreadyResyncing(t *testing.T) {
	const local = 22_186_180
	const threshold = 14_400
	srv := blockHeightServer(local+threshold+5_000, nil)
	defer srv.Close()

	var triggered int32
	hm := newTestMonitor(srv.URL, threshold, func() { atomic.AddInt32(&triggered, 1) })
	hm.appState.SetNodeStatus(state.NodeResyncing)

	hm.lagResyncCheck(local)

	if atomic.LoadInt32(&triggered) != 0 {
		t.Fatalf("expected no resync trigger while already resyncing, got %d", triggered)
	}
}

func TestLagResyncCheck_DebouncesRepeatTriggers(t *testing.T) {
	const local = 22_186_180
	const threshold = 14_400
	srv := blockHeightServer(local+threshold+5_000, nil)
	defer srv.Close()

	var triggered int32
	hm := newTestMonitor(srv.URL, threshold, func() { atomic.AddInt32(&triggered, 1) })

	// Two back-to-back checks (well within lagResyncDebounce) must only fire once.
	hm.lagResyncCheck(local)
	hm.lagResyncCheck(local)

	if got := atomic.LoadInt32(&triggered); got != 1 {
		t.Fatalf("expected exactly 1 trigger due to debounce, got %d", got)
	}
}

func TestMaybeResyncIfTooFarBehind_ThrottlesPublicQueries(t *testing.T) {
	const local = 22_186_180
	const threshold = 14_400
	var reqCount int32
	srv := blockHeightServer(local+threshold+5_000, &reqCount)
	defer srv.Close()

	hm := newTestMonitor(srv.URL, threshold, func() {})

	// Two rapid calls within lagCheckInterval: only the first should query public RPC.
	hm.maybeResyncIfTooFarBehind(local)
	hm.maybeResyncIfTooFarBehind(local)

	// Give the spawned goroutine time to hit the server.
	waitFor(time.Second, func() bool { return atomic.LoadInt32(&reqCount) >= 1 })
	// And a little longer to ensure a (wrongly) un-throttled second query would land.
	time.Sleep(50 * time.Millisecond)

	if got := atomic.LoadInt32(&reqCount); got != 1 {
		t.Fatalf("expected exactly 1 public RPC query (second throttled), got %d", got)
	}
}
