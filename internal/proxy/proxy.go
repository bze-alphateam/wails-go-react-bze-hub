package proxy

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sync"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/logging"
	"github.com/bze-alphateam/bze-hub/internal/state"
)

// Config holds proxy configuration.
type Config struct {
	RESTPort       int
	RPCPort        int
	LocalRESTAddr  string // e.g., "http://localhost:1317"
	LocalRPCAddr   string // e.g., "http://localhost:26657"
	PublicRESTAddr string // e.g., "https://rest.getbze.com"
	PublicRPCAddr  string // e.g., "https://rpc.getbze.com"

	// Circuit breaker
	TimeoutMs     int // Per-request timeout for local node (default: 1500)
	FailThreshold int // Failures before marking unsafe (default: 3)
	CooldownSec   int // Seconds to avoid local after tripping (default: 120)
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		RESTPort:       1418,
		RPCPort:        26658,
		LocalRESTAddr:  "http://localhost:1317",
		LocalRPCAddr:   "http://localhost:26657",
		PublicRESTAddr: "https://rest.getbze.com",
		PublicRPCAddr:  "https://rpc.getbze.com",
		TimeoutMs:      1500,
		FailThreshold:  3,
		CooldownSec:    120,
	}
}

// circuitBreaker tracks failures to the local node and decides when to skip it.
type circuitBreaker struct {
	mu          sync.RWMutex
	failCount   int
	unsafeUntil time.Time
	threshold   int
	cooldown    time.Duration
}

func newCircuitBreaker(threshold int, cooldownSec int) *circuitBreaker {
	return &circuitBreaker{
		threshold: threshold,
		cooldown:  time.Duration(cooldownSec) * time.Second,
	}
}

func (cb *circuitBreaker) isLocalSafe() bool {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	if cb.failCount >= cb.threshold {
		return time.Now().After(cb.unsafeUntil)
	}
	return true
}

func (cb *circuitBreaker) recordFailure(unrecoverable bool) {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	if unrecoverable {
		// Skip the count, go straight to cooldown
		cb.failCount = cb.threshold
	} else {
		cb.failCount++
	}
	if cb.failCount >= cb.threshold {
		cb.unsafeUntil = time.Now().Add(cb.cooldown)
		logging.Info("proxy", "circuit breaker tripped (failures: %d, unrecoverable: %v) — using public for %s", cb.failCount, unrecoverable, cb.cooldown)
	}
}

func (cb *circuitBreaker) recordSuccess() {
	cb.mu.Lock()
	wasTripped := cb.failCount >= cb.threshold
	cb.failCount = 0
	cb.mu.Unlock()

	if wasTripped {
		logging.Info("proxy", "circuit breaker recovered — local node healthy again")
	}
}

// isUnrecoverable returns true for errors that mean the local node is definitely down.
func isUnrecoverable(err error) bool {
	var netErr *net.OpError
	if errors.As(err, &netErr) {
		return true
	}
	// Connection refused, reset, etc.
	if errors.Is(err, context.DeadlineExceeded) {
		return false // timeout is recoverable
	}
	return false
}

// EndpointProxy is a reverse proxy that routes to local or public endpoints.
type EndpointProxy struct {
	appState  *state.AppState
	cb        *circuitBreaker
	localURL  *url.URL
	publicURL *url.URL
	timeout   time.Duration
	server    *http.Server
	label     string // "REST" or "RPC" for logging
}

// NewEndpointProxy creates a proxy for a given endpoint pair.
func NewEndpointProxy(label string, localAddr, publicAddr string, appState *state.AppState, cfg Config) (*EndpointProxy, error) {
	localURL, err := url.Parse(localAddr)
	if err != nil {
		return nil, fmt.Errorf("invalid local URL %q: %w", localAddr, err)
	}
	publicURL, err := url.Parse(publicAddr)
	if err != nil {
		return nil, fmt.Errorf("invalid public URL %q: %w", publicAddr, err)
	}

	return &EndpointProxy{
		appState:  appState,
		cb:        newCircuitBreaker(cfg.FailThreshold, cfg.CooldownSec),
		localURL:  localURL,
		publicURL: publicURL,
		timeout:   time.Duration(cfg.TimeoutMs) * time.Millisecond,
		label:     label,
	}, nil
}

// ServeHTTP handles each request, routing to local or public.
func (p *EndpointProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// CORS headers — required for iframe dApps calling localhost
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	useLocal := p.appState.GetNodeStatus() == state.NodeSynced && p.cb.isLocalSafe()

	// Log broadcast requests
	if r.Method == "POST" && (r.URL.Path == "/cosmos/tx/v1beta1/txs" || r.URL.Path == "/") {
		logging.Debug("proxy", "%s BROADCAST %s %s", p.label, r.Method, r.URL.Path)
	}

	if useLocal {
		logging.Debug("proxy", "%s %s %s → local (%s)", p.label, r.Method, r.URL.Path, p.localURL.Host)
		if err := p.forwardWithTimeout(w, r, p.localURL); err != nil {
			// Local failed — fallback to public
			unrecoverable := isUnrecoverable(err)
			p.cb.recordFailure(unrecoverable)
			logging.Error("proxy", "%s local failed (%v), falling back to public", p.label, err)
			p.forwardTo(w, r, p.publicURL)
		} else {
			p.cb.recordSuccess()
		}
	} else {
		logging.Debug("proxy", "%s %s %s → public (%s)", p.label, r.Method, r.URL.Path, p.publicURL.Host)
		p.forwardTo(w, r, p.publicURL)
	}
}

// forwardWithTimeout forwards a request to the target with a timeout.
func (p *EndpointProxy) forwardWithTimeout(w http.ResponseWriter, r *http.Request, target *url.URL) error {
	// Create a context with timeout
	ctx, cancel := context.WithTimeout(r.Context(), p.timeout)
	defer cancel()

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: p.timeout,
		}).DialContext,
	}
	// Set Host header to match the target
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
	}

	// Capture errors from the proxy
	errCh := make(chan error, 1)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		errCh <- err
	}

	proxy.ServeHTTP(w, r.WithContext(ctx))

	select {
	case err := <-errCh:
		return err
	default:
		return nil
	}
}

// forwardTo forwards a request directly to the target (no timeout wrapper, used for public).
func (p *EndpointProxy) forwardTo(w http.ResponseWriter, r *http.Request, target *url.URL) {
	proxy := httputil.NewSingleHostReverseProxy(target)
	// Set Host header to match the target so Cloudflare/CDNs don't block
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		logging.Error("proxy", "%s public error: %v", p.label, err)
		http.Error(w, "proxy error", http.StatusBadGateway)
	}
	proxy.ServeHTTP(w, r)
}

// Start begins listening on the given port. Blocks until the server stops.
func (p *EndpointProxy) Start(port int) error {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	p.server = &http.Server{
		Addr:    addr,
		Handler: p,
	}
	logging.Info("proxy", "%s proxy listening on %s (local: %s, public: %s)", p.label, addr, p.localURL.Host, p.publicURL.Host)
	err := p.server.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}

// Stop gracefully shuts down the proxy server.
func (p *EndpointProxy) Stop(ctx context.Context) error {
	if p.server == nil {
		return nil
	}
	logging.Info("proxy", "%s proxy stopping", p.label)
	return p.server.Shutdown(ctx)
}
