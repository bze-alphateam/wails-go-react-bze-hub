package chain

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/bze-alphateam/bze-hub/internal/logging"
	"github.com/bze-alphateam/bze-hub/internal/state"
	"github.com/cosmos/cosmos-sdk/codec"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/std"
	stakingtypes "github.com/cosmos/cosmos-sdk/x/staking/types"
	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// Client manages gRPC connections to the BZE chain.
// It connects to the local node when synced, otherwise falls back to the public gRPC endpoint.
type Client struct {
	localAddr  string // e.g. "localhost:9090"
	publicAddr string // e.g. "grpc.getbze.com:443"
	restAddr   string // e.g. "localhost:2317" — REST proxy, used for endpoints with protobuf compat issues
	appState   *state.AppState

	// Cosmos SDK codec for proper JSON marshaling of protobuf types
	Cdc        *codec.ProtoCodec
	httpClient *http.Client

	mu        sync.Mutex
	localConn *grpc.ClientConn
	pubConn   *grpc.ClientConn
}

// NewClient creates a new chain gRPC client with a properly configured Cosmos SDK codec.
// restProxyAddr is used as fallback for endpoints that have protobuf type incompatibilities (e.g. mint AnnualProvisions).
func NewClient(localGRPCAddr string, publicGRPCAddr string, restProxyAddr string, appState *state.AppState) *Client {
	// Create interface registry and register all standard SDK types
	// This is required so that codec/types.Any fields (like consensus_pubkey) can marshal to JSON.
	ir := codectypes.NewInterfaceRegistry()
	std.RegisterInterfaces(ir)
	stakingtypes.RegisterInterfaces(ir)

	cdc := codec.NewProtoCodec(ir)

	return &Client{
		localAddr:  localGRPCAddr,
		publicAddr: publicGRPCAddr,
		restAddr:   restProxyAddr,
		appState:   appState,
		Cdc:        cdc,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// GetConnection returns a gRPC connection, preferring the local node when synced.
func (c *Client) GetConnection() (*grpc.ClientConn, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.appState.GetNodeStatus() == state.NodeSynced {
		return c.getLocalConn()
	}

	return c.getPublicConn()
}

// Close closes all open gRPC connections.
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.localConn != nil {
		c.localConn.Close()
		c.localConn = nil
	}
	if c.pubConn != nil {
		c.pubConn.Close()
		c.pubConn = nil
	}
}

func (c *Client) getLocalConn() (*grpc.ClientConn, error) {
	if c.localConn != nil && c.localConn.GetState() == connectivity.Ready {
		return c.localConn, nil
	}

	if c.localConn != nil {
		c.localConn.Close()
	}

	logging.Debug("chain", "connecting to local gRPC at %s", c.localAddr)
	conn, err := grpc.Dial(
		c.localAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return nil, fmt.Errorf("local gRPC dial failed: %w", err)
	}

	c.localConn = conn
	return conn, nil
}

func (c *Client) getPublicConn() (*grpc.ClientConn, error) {
	if c.pubConn != nil && c.pubConn.GetState() == connectivity.Ready {
		return c.pubConn, nil
	}

	if c.pubConn != nil {
		c.pubConn.Close()
	}

	logging.Debug("chain", "connecting to public gRPC at %s", c.publicAddr)
	tlsCreds, err := loadTLSCredentials()
	if err != nil {
		return nil, fmt.Errorf("TLS credentials: %w", err)
	}

	conn, err := grpc.Dial(
		c.publicAddr,
		grpc.WithTransportCredentials(tlsCreds),
	)
	if err != nil {
		return nil, fmt.Errorf("public gRPC dial failed: %w", err)
	}

	c.pubConn = conn
	return conn, nil
}

// RestGet fetches a REST endpoint via the proxy and returns parsed JSON.
// Used for endpoints that have protobuf type incompatibilities with the gRPC client.
func (c *Client) RestGet(path string) (map[string]interface{}, error) {
	url := fmt.Sprintf("http://%s%s", c.restAddr, path)
	logging.Debug("chain", "REST GET %s", url)

	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("REST GET %s: %w", path, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return result, nil
}

func loadTLSCredentials() (credentials.TransportCredentials, error) {
	certPool, err := x509.SystemCertPool()
	if err != nil {
		return nil, err
	}

	return credentials.NewTLS(&tls.Config{
		RootCAs:    certPool,
		NextProtos: []string{"h2"},
	}), nil
}
