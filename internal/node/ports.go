package node

import (
	"fmt"
	"net"
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
// For each port, if the default is taken, it increments by 1 up to maxPortIncrement times.
// Returns the discovered port set or an error if any port can't be found.
func DiscoverPorts(defaults PortSet) (PortSet, error) {
	var result PortSet
	var err error

	result.NodeP2P, err = findAvailablePort(defaults.NodeP2P)
	if err != nil {
		return result, fmt.Errorf("node P2P port: %w", err)
	}

	result.NodeRPC, err = findAvailablePort(defaults.NodeRPC)
	if err != nil {
		return result, fmt.Errorf("node RPC port: %w", err)
	}

	result.NodeREST, err = findAvailablePort(defaults.NodeREST)
	if err != nil {
		return result, fmt.Errorf("node REST port: %w", err)
	}

	result.NodeGRPC, err = findAvailablePort(defaults.NodeGRPC)
	if err != nil {
		return result, fmt.Errorf("node gRPC port: %w", err)
	}

	result.ProxyREST, err = findAvailablePort(defaults.ProxyREST)
	if err != nil {
		return result, fmt.Errorf("proxy REST port: %w", err)
	}

	result.ProxyRPC, err = findAvailablePort(defaults.ProxyRPC)
	if err != nil {
		return result, fmt.Errorf("proxy RPC port: %w", err)
	}

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

// findAvailablePort starts from startPort and increments until it finds an available one.
func findAvailablePort(startPort int) (int, error) {
	for i := 0; i < maxPortIncrement; i++ {
		port := startPort + i
		if IsPortAvailable(port) {
			if port != startPort {
				fmt.Printf("[node] port %d taken, using %d instead\n", startPort, port)
			}
			return port, nil
		}
	}
	return 0, fmt.Errorf("no available port found in range %d-%d", startPort, startPort+maxPortIncrement-1)
}
