package node

import (
	"fmt"
	"net"

	"github.com/bze-alphateam/bze-hub/internal/logging"
)

const maxPortIncrement = 100

// PortSet holds all the ports needed for the node and proxy.
type PortSet struct {
	// Node ports
	NodeP2P  int `json:"nodeP2P"`
	NodeRPC  int `json:"nodeRPC"`
	NodeREST int `json:"nodeREST"`
	NodeGRPC int `json:"nodeGRPC"`

	// Proxy ports
	ProxyREST int `json:"proxyREST"`
	ProxyRPC  int `json:"proxyRPC"`
}

// DefaultPorts returns the default port set.
func DefaultPorts() PortSet {
	return PortSet{
		NodeP2P:   26656,
		NodeRPC:   26657,
		NodeREST:  1317,
		NodeGRPC:  9090,
		ProxyREST: 2317,
		ProxyRPC:  36657,
	}
}

// DiscoverPorts finds available ports starting from defaults.
func DiscoverPorts(defaults PortSet) (PortSet, error) {
	logging.Info("ports", "discovering available ports (defaults: P2P:%d RPC:%d REST:%d gRPC:%d proxyREST:%d proxyRPC:%d)",
		defaults.NodeP2P, defaults.NodeRPC, defaults.NodeREST, defaults.NodeGRPC, defaults.ProxyREST, defaults.ProxyRPC)

	var result PortSet
	var err error

	result.NodeP2P, err = findAvailablePort("node-P2P", defaults.NodeP2P)
	if err != nil {
		return result, fmt.Errorf("node P2P port: %w", err)
	}

	result.NodeRPC, err = findAvailablePort("node-RPC", defaults.NodeRPC)
	if err != nil {
		return result, fmt.Errorf("node RPC port: %w", err)
	}

	result.NodeREST, err = findAvailablePort("node-REST", defaults.NodeREST)
	if err != nil {
		return result, fmt.Errorf("node REST port: %w", err)
	}

	result.NodeGRPC, err = findAvailablePort("node-gRPC", defaults.NodeGRPC)
	if err != nil {
		return result, fmt.Errorf("node gRPC port: %w", err)
	}

	result.ProxyREST, err = findAvailablePort("proxy-REST", defaults.ProxyREST)
	if err != nil {
		return result, fmt.Errorf("proxy REST port: %w", err)
	}

	result.ProxyRPC, err = findAvailablePort("proxy-RPC", defaults.ProxyRPC)
	if err != nil {
		return result, fmt.Errorf("proxy RPC port: %w", err)
	}

	logging.Info("ports", "all ports discovered: node(P2P:%d RPC:%d REST:%d gRPC:%d) proxy(REST:%d RPC:%d)",
		result.NodeP2P, result.NodeRPC, result.NodeREST, result.NodeGRPC, result.ProxyREST, result.ProxyRPC)

	return result, nil
}

// IsPortAvailable checks if a TCP port is available for binding.
func IsPortAvailable(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	ln.Close()
	return true
}

func findAvailablePort(name string, startPort int) (int, error) {
	for i := 0; i < maxPortIncrement; i++ {
		port := startPort + i
		if IsPortAvailable(port) {
			if port != startPort {
				logging.Info("ports", "%s: default %d taken, using %d (+%d)", name, startPort, port, i)
			} else {
				logging.Debug("ports", "%s: %d available", name, port)
			}
			return port, nil
		}
		logging.Debug("ports", "%s: %d in use, trying next", name, port)
	}
	logging.Error("ports", "%s: no available port in range %d-%d", name, startPort, startPort+maxPortIncrement-1)
	return 0, fmt.Errorf("no available port found in range %d-%d", startPort, startPort+maxPortIncrement-1)
}
