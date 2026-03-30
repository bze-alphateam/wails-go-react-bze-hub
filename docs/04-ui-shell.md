# Epic 04: UI Shell

Persistent React shell with iframe-based dApp rendering. Keplr-compatible bridge via a dedicated `@bze/hub-connector` library. No proxy, no floating injection.

## 1. Overview

The UI Shell provides a **persistent native-feeling window** with:

- **React Shell** (always rendered): tab bar, status bar, account switcher, approval dialog
- **Content Area**: Dashboard rendered locally as React components; dApps rendered in iframes from live URLs
- **Bridge**: A separate npm library (`@bze/hub-connector`) that dApps import to become BZE Hub compatible. It auto-detects the Hub parent and creates a `window.keplr` via postMessage.

The React shell never unloads. Switching tabs shows/hides iframes. The user always sees the tab bar, status bar, and can trigger the approval dialog regardless of which dApp is active.

## 2. Architecture

```
+-----------------------------------------------------------------------+
|  BZE Hub Window (Wails v2)                                            |
|                                                                       |
|  +-- React Shell (always rendered) --------------------------------+  |
|  |                                                                  |  |
|  |  +-- Tab Bar ------------------------------------------------+   |  |
|  |  | [Dashboard] [DEX] [Burner] [Stake]  |  bze1abc.. [v]      |   |  |
|  |  +-----------------------------------------------------------+   |  |
|  |                                                                  |  |
|  |  +-- Content Area -------------------------------------------+   |  |
|  |  |                                                           |   |  |
|  |  |  (when Dashboard tab active)                              |   |  |
|  |  |  <Dashboard />  -- React component, rendered locally      |   |  |
|  |  |                                                           |   |  |
|  |  |  (when DEX tab active)                                    |   |  |
|  |  |  <iframe src="https://dex.getbze.com" />                  |   |  |
|  |  |    |                                                      |   |  |
|  |  |    | dApp imports @bze/hub-connector                      |   |  |
|  |  |    | connector detects BZE Hub parent                     |   |  |
|  |  |    | creates window.keplr via postMessage                 |   |  |
|  |  |    |                                                      |   |  |
|  |  |    +-- postMessage ------> React Shell                    |   |  |
|  |  |                              |                            |   |  |
|  |  |                              +-- Wails binding --> Go     |   |  |
|  |  |                                   (wallet, signing)       |   |  |
|  |  |                                                           |   |  |
|  |  | (other iframes hidden with display:none, kept alive)      |   |  |
|  |  +-----------------------------------------------------------+   |  |
|  |                                                                  |  |
|  |  +-- Status Bar ----------------------------------------------+  |  |
|  |  | [*] Synced (1,234,567)  |  Mainnet  |  Node: bzed v8.1.0  |  |  |
|  |  +-----------------------------------------------------------+  |  |
|  |                                                                  |  |
|  |  +-- Approval Dialog (overlay on top of everything) ----------+  |  |
|  |  | "dex.getbze.com wants to sign: Create DEX Order"           |  |  |
|  |  | Fee: 0.025 BZE  |  [Reject]  [Approve]                    |  |  |
|  |  +-----------------------------------------------------------+  |  |
|  +------------------------------------------------------------------+  |
+-----------------------------------------------------------------------+
```

### Why This Works

- The **React shell is the Wails frontend** - it's always loaded from embedded assets, never unloads
- **dApp iframes** load from live URLs. Each iframe is its own browsing context with its own origin
- The **`@bze/hub-connector`** library runs inside the iframe. It detects BZE Hub as the parent and creates `window.keplr` using `postMessage` to communicate with the shell
- The **shell mediates** all communication: iframe postMessage <-> Wails bindings <-> Go backend
- The **approval dialog** renders in the React shell (above iframes), so it's always accessible and styled consistently

## 3. @bze/hub-connector Library

### Purpose

A small, standalone npm package that any Cosmos dApp can import to become BZE Hub compatible. It:

1. Detects if the app is running inside a BZE Hub iframe
2. If yes: creates `window.keplr` that communicates via `postMessage` to the Hub shell
3. If no: does nothing (no-op). The app uses its normal wallet extensions.

### Package Details

```
Package: @bze/hub-connector
Size: ~5 KB (minified)
Dependencies: none
Peer dependencies: none
```

### Usage in a dApp

```typescript
// In the dApp's entry point (e.g., _app.tsx or layout.tsx)
import { initHubConnector } from '@bze/hub-connector';

// Call once at startup. Returns true if running in BZE Hub, false otherwise.
const isInHub = initHubConnector();
```

That's it. If running in BZE Hub, `window.keplr` is now available and the dApp's `@interchain-kit` will detect it as Keplr.

### Implementation

```typescript
// @bze/hub-connector/src/index.ts

const HUB_HANDSHAKE = "bze-hub:handshake";
const HUB_RESPONSE = "bze-hub:handshake-ack";
const BRIDGE_REQUEST = "bze-hub:bridge-request";
const BRIDGE_RESPONSE = "bze-hub:bridge-response";
const ACCOUNT_CHANGED = "bze-hub:account-changed";
const CHAIN_CHANGED = "bze-hub:chain-changed";

let hubDetected = false;
let messageId = 0;
const pendingRequests = new Map<string, { resolve: Function; reject: Function }>();

function sendToHub(method: string, params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const id = `hub-${++messageId}`;
        pendingRequests.set(id, { resolve, reject });

        window.parent.postMessage({
            type: BRIDGE_REQUEST,
            id,
            method,
            params,
        }, "*");

        setTimeout(() => {
            if (pendingRequests.has(id)) {
                pendingRequests.delete(id);
                reject(new Error("BZE Hub bridge request timed out"));
            }
        }, 120_000);
    });
}

function setupResponseListener() {
    window.addEventListener("message", (event) => {
        const { data } = event;

        if (data?.type === BRIDGE_RESPONSE) {
            const pending = pendingRequests.get(data.id);
            if (pending) {
                pendingRequests.delete(data.id);
                data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result);
            }
        }

        if (data?.type === ACCOUNT_CHANGED || data?.type === CHAIN_CHANGED) {
            window.dispatchEvent(new Event("keplr_keystorechange"));
        }
    });
}

function createKeplrBridge() {
    const keplr = {
        async enable(chainId: string) {
            await sendToHub("enable", [chainId]);
        },

        async getKey(chainId: string) {
            const result: any = await sendToHub("getKey", [chainId]);
            // Ensure pubKey and address are Uint8Array (they arrive as arrays over postMessage)
            if (result.pubKey && Array.isArray(result.pubKey)) {
                result.pubKey = new Uint8Array(result.pubKey);
            }
            if (result.address && Array.isArray(result.address)) {
                result.address = new Uint8Array(result.address);
            }
            return result;
        },

        async getOfflineSigner(chainId: string) {
            return {
                async getAccounts() {
                    const key = await keplr.getKey(chainId);
                    return [{ address: key.bech32Address, pubkey: key.pubKey, algo: "secp256k1" as const }];
                },
                async signDirect(signerAddress: string, signDoc: any) {
                    return sendToHub("signDirect", [chainId, signerAddress, signDoc]);
                },
                async signAmino(signerAddress: string, signDoc: any) {
                    return sendToHub("signAmino", [chainId, signerAddress, signDoc]);
                },
            };
        },

        async getOfflineSignerOnlyAmino(chainId: string) {
            return {
                async getAccounts() {
                    const key = await keplr.getKey(chainId);
                    return [{ address: key.bech32Address, pubkey: key.pubKey, algo: "secp256k1" as const }];
                },
                async signAmino(signerAddress: string, signDoc: any) {
                    return sendToHub("signAmino", [chainId, signerAddress, signDoc]);
                },
            };
        },

        async signDirect(chainId: string, signer: string, signDoc: any) {
            return sendToHub("signDirect", [chainId, signer, signDoc]);
        },

        async signAmino(chainId: string, signer: string, signDoc: any) {
            return sendToHub("signAmino", [chainId, signer, signDoc]);
        },

        async experimentalSuggestChain(chainInfo: any) {
            return sendToHub("suggestChain", [chainInfo]);
        },

        async signArbitrary(chainId: string, signer: string, data: string) {
            return sendToHub("signArbitrary", [chainId, signer, data]);
        },

        defaultOptions: {
            sign: { preferNoSetFee: false, preferNoSetMemo: true, disableBalanceCheck: false },
        },
    };

    (window as any).keplr = keplr;
    (window as any).getOfflineSigner = keplr.getOfflineSigner;
    (window as any).getOfflineSignerOnlyAmino = keplr.getOfflineSignerOnlyAmino;

    // Signal availability
    window.dispatchEvent(new Event("keplr_keystorechange"));
}

/**
 * Detect if running inside BZE Hub and set up the Keplr bridge.
 * Safe to call unconditionally - does nothing if not in BZE Hub.
 *
 * @returns true if running inside BZE Hub, false otherwise
 */
export function initHubConnector(): boolean {
    // Not in an iframe? Not in Hub.
    if (window.parent === window) return false;

    // Already initialized?
    if (hubDetected) return true;

    // Try handshake with parent
    return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
            resolve(false); // No response from parent - not in Hub
        }, 500);

        function onHandshake(event: MessageEvent) {
            if (event.data?.type === HUB_RESPONSE) {
                clearTimeout(timeout);
                window.removeEventListener("message", onHandshake);
                hubDetected = true;
                setupResponseListener();
                createKeplrBridge();
                resolve(true);
            }
        }

        window.addEventListener("message", onHandshake);
        window.parent.postMessage({ type: HUB_HANDSHAKE }, "*");
    }) as any; // Note: returns a Promise<boolean>, dApp can await or ignore
}

/**
 * Check if currently running inside BZE Hub (synchronous, after init).
 */
export function isInHub(): boolean {
    return hubDetected;
}
```

### What dApps Need to Do

For BZE's own dApps (dex, burner, staking):

```bash
npm install @bze/hub-connector
```

Then in the app's root layout or entry point:

```typescript
import { initHubConnector } from '@bze/hub-connector';

// Initialize on app load - async but fire-and-forget is fine
initHubConnector();
```

That's all. The connector:
- Does a fast handshake with the parent window (500ms timeout)
- If BZE Hub responds: creates `window.keplr` before `@interchain-kit` initializes
- If no response (normal browser): does nothing, app works as before

### For Third-Party Cosmos dApps

Any dApp in the Cosmos ecosystem can add BZE Hub support:

```bash
npm install @bze/hub-connector
```

```typescript
import { initHubConnector } from '@bze/hub-connector';
initHubConnector();
// That's it. If the user opens this dApp in BZE Hub, it will auto-connect.
```

> **TODO**: `@bze/hub-connector` needs its own package structure — separate folder in the monorepo (e.g., `bze-ecosystem/hub-connector/`), its own `package.json`, `tsconfig.json`, `tsup` build config (ESM + CJS + DTS), README with integration guide, and npm publish pipeline. The code spec above defines the full API; this needs to become a real publishable package before the dApps can import it.

### dApp Changes Checklist

Each BZE dApp (dex, burner, staking) needs these changes to work inside BZE Hub:

**Required:**
- [ ] `npm install @bze/hub-connector`
- [ ] Call `initHubConnector()` in the app entry point (e.g., `_app.tsx` or `layout.tsx`), before React tree mounts
- [ ] Add `X-Frame-Options: ALLOWALL` (or remove the header) in `next.config.js` headers config, so the app can be loaded in an iframe
- [ ] Alternatively, use `Content-Security-Policy: frame-ancestors *` instead of X-Frame-Options

**Recommended:**
- [ ] In the Settings sidebar, detect `isInHub()` from hub-connector and disable the endpoint fields (Hub manages endpoints via proxy)
- [ ] Show a "Connected to BZE Hub" indicator somewhere in the UI when `isInHub()` returns true

### dApp Wallet Connection in Hub Mode

When the hub-connector detects BZE Hub, the dApp's connect button should **auto-connect to the address selected in the shell** without showing the wallet selection modal (Keplr / Leap / WalletConnect). The shell IS the wallet — it removes all complexity.

Implementation: the hub-connector (or a small addition to the dApp's provider) checks `isInHub()`:
- If `true`: skip the wallet modal entirely. Call `window.keplr.enable()` directly with the chain ID. The user is already "connected" — the active address from the shell's top bar is the connected address.
- If `false`: normal flow — show the wallet selection modal as usual.

This means in Hub mode:
- No "Connect Wallet" button visible (or it shows as already connected)
- No Keplr/Leap/WalletConnect selection modal
- The address shown in the dApp matches the active address in the shell's top bar
- Switching accounts in the shell immediately updates the dApp (via `keplr_keystorechange`)

> **Open question:** Verify none of the dApps set restrictive CSP `frame-ancestors` headers today. Need to check Next.js default headers for each dApp.

> **TODO — Dark/Light mode sync with dApp iframes:**
> When the user toggles dark/light mode in the Hub shell, the dApps in iframes should react to match. The shell controls the theme — dApps follow, not the other way around. Options to decide:
> - Hub-connector sends a `bze-hub:theme-changed` message to iframes. The dApp reads it and calls its own `setColorMode()`.
> - Hub-connector sets `prefers-color-scheme` via the iframe's `media` attribute (limited browser support).
> - The hub-connector writes the theme to the iframe's localStorage in the format the dApp expects, then triggers a reload/re-render.
> Whichever approach is chosen: **shell is the source of truth for theme. dApps never override it back.**

## 4. React Shell Layout

### Component Structure

```tsx
// App.tsx - the Wails frontend root
function App() {
    const [activeTab, setActiveTab] = useState("dashboard");
    const [approvalRequest, setApprovalRequest] = useState<SignRequest | null>(null);
    const nodeStatus = useNodeStatus();   // Wails event listener
    const accounts = useAccounts();        // Wails binding

    return (
        <div className="app-shell">
            <TabBar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                account={accounts.active}
                onAccountSwitch={accounts.switchAccount}
            />

            <ContentArea activeTab={activeTab} />

            <StatusBar
                nodeStatus={nodeStatus}
                network={settings.network}
            />

            {approvalRequest && (
                <ApprovalDialog
                    request={approvalRequest}
                    onApprove={() => handleApprove(approvalRequest.id)}
                    onReject={() => handleReject(approvalRequest.id)}
                />
            )}
        </div>
    );
}
```

### Content Area

```tsx
function ContentArea({ activeTab }: { activeTab: string }) {
    return (
        <div className="content-area">
            {/* Dashboard - rendered locally */}
            <div style={{ display: activeTab === "dashboard" ? "block" : "none" }}>
                <Dashboard />
            </div>

            {/* dApp iframes - always mounted, shown/hidden */}
            {DAPP_TABS.map(tab => (
                <iframe
                    key={tab.id}
                    src={tab.url}
                    title={tab.label}
                    style={{
                        display: activeTab === tab.id ? "block" : "none",
                        width: "100%",
                        height: "100%",
                        border: "none",
                    }}
                />
            ))}
        </div>
    );
}

const DAPP_TABS = [
    { id: "dex", label: "DEX", url: "https://dex.getbze.com" },
    { id: "burner", label: "Burner", url: "https://burner.getbze.com" },
    { id: "staking", label: "Staking", url: "https://stake.getbze.com" },
];
```

### Tab Bar

```tsx
function TabBar({ activeTab, onTabChange, account, onAccountSwitch }) {
    return (
        <div className="tab-bar">
            <div className="tabs">
                <TabButton id="dashboard" icon={HomeIcon} label="Dashboard" active={activeTab === "dashboard"} onClick={onTabChange} />
                <TabButton id="dex" icon={ChartIcon} label="DEX" active={activeTab === "dex"} onClick={onTabChange} />
                <TabButton id="burner" icon={FlameIcon} label="Burner" active={activeTab === "burner"} onClick={onTabChange} />
                <TabButton id="staking" icon={LockIcon} label="Staking" active={activeTab === "staking"} onClick={onTabChange} />
            </div>
            <div className="account-section">
                <AccountSwitcher account={account} onSwitch={onAccountSwitch} />
            </div>
        </div>
    );
}
```

### Status Bar

```tsx
function StatusBar({ nodeStatus, network }) {
    const statusColor = {
        synced: "green",
        syncing: "amber",
        starting: "blue",
        error: "red",
        stopped: "gray",
    }[nodeStatus.state] || "gray";

    return (
        <div className="status-bar">
            <span className={`status-dot ${statusColor}`} />
            <span>Node: {nodeStatus.state} ({nodeStatus.latestHeight?.toLocaleString()})</span>
            <span className="separator">|</span>
            <span>Network: {network}</span>
            <span className="separator">|</span>
            <span>bzed {nodeStatus.binaryVersion}</span>
        </div>
    );
}
```

## 5. Message Handler (Shell Side)

The React shell listens for postMessage from iframes and forwards to Go:

```typescript
// hooks/useBridgeHandler.ts
import * as App from '../wailsjs/go/main/App';
import { EventsOn } from '../wailsjs/runtime/runtime';

export function useBridgeHandler(setApprovalRequest: Function) {
    useEffect(() => {
        function handleMessage(event: MessageEvent) {
            const { data } = event;

            // Handshake: iframe checking if it's in BZE Hub
            if (data?.type === "bze-hub:handshake") {
                (event.source as Window).postMessage(
                    { type: "bze-hub:handshake-ack" },
                    "*"
                );
                return;
            }

            // Bridge request from iframe
            if (data?.type === "bze-hub:bridge-request") {
                handleBridgeRequest(data, event.source as Window);
                return;
            }
        }

        async function handleBridgeRequest(request: any, source: Window) {
            const { id, method, params } = request;

            try {
                let result: any;

                switch (method) {
                    case "enable":
                        result = await App.KeplrEnable(params[0]);
                        break;
                    case "getKey":
                        result = await App.KeplrGetKey(params[0]);
                        break;
                    case "signAmino":
                        // This triggers the approval dialog in Go,
                        // which emits a Wails event back to us
                        result = await App.KeplrSignAmino(
                            params[0], params[1], JSON.stringify(params[2])
                        );
                        break;
                    case "signDirect":
                        result = await App.KeplrSignDirect(
                            params[0], params[1], JSON.stringify(params[2])
                        );
                        break;
                    case "suggestChain":
                        result = await App.KeplrSuggestChain(JSON.stringify(params[0]));
                        break;
                    case "signArbitrary":
                        result = await App.KeplrSignArbitrary(params[0], params[1], params[2]);
                        break;
                    default:
                        throw new Error(`Unknown method: ${method}`);
                }

                source.postMessage({ type: "bze-hub:bridge-response", id, result }, "*");
            } catch (err) {
                source.postMessage({
                    type: "bze-hub:bridge-response",
                    id,
                    error: (err as Error).message,
                }, "*");
            }
        }

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    // Listen for approval requests from Go backend
    useEffect(() => {
        const cancel = EventsOn("bridge:sign-request", (request: any) => {
            setApprovalRequest(request);
        });
        return cancel;
    }, []);
}
```

## 6. Approval Dialog

The approval dialog is a React component rendered in the shell, above all iframes:

```tsx
function ApprovalDialog({ request, onApprove, onReject }: ApprovalDialogProps) {
    const [timeLeft, setTimeLeft] = useState(60);

    useEffect(() => {
        const timer = setInterval(() => {
            setTimeLeft(t => {
                if (t <= 1) { onReject(); return 0; }
                return t - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className="approval-overlay">
            <div className="approval-dialog">
                <h3>Transaction Approval</h3>
                <p className="origin">{request.origin} wants to sign:</p>

                <div className="tx-details">
                    <div className="tx-action">{request.summary}</div>

                    {request.messages.map((msg, i) => (
                        <div key={i} className="tx-message">
                            <span className="msg-type">{msg.typeHuman}</span>
                            {msg.details && <span className="msg-detail">{msg.details}</span>}
                        </div>
                    ))}

                    <div className="tx-fee">Fee: {request.fee}</div>
                    {request.memo && <div className="tx-memo">Memo: {request.memo}</div>}
                </div>

                <div className="tx-signer">
                    Signer: {request.signerName} ({request.signerAddress})
                </div>

                <div className="approval-actions">
                    <button className="btn-reject" onClick={onReject}>Reject</button>
                    <button className="btn-approve" onClick={onApprove}>Approve</button>
                </div>

                <div className="auto-reject">Auto-reject in {timeLeft}s</div>
            </div>
        </div>
    );
}
```

Since this renders in the React shell (not injected into an iframe), it:
- Is styled consistently with the app theme
- Appears above all iframes (z-index)
- Can be as rich as needed (icons, formatted amounts, links)
- Is not affected by dApp CSS

## 7. Endpoint Routing via Local Proxy Servers

### The Problem

The dApps use endpoints from two paths:
1. **REST queries** (LCD client) - reads from `getSettings()` -> localStorage
2. **RPC signing** (`@interchain-kit`) - uses chain registry or `experimentalSuggestChain`

If we pointed dApps directly at the local node, we'd need to switch them to public endpoints when the node is down - requiring complex localStorage manipulation and reconnection logic.

### The Solution: Hub Proxy Servers

The Hub runs **two local proxy servers** that are always available:

| Proxy | Listens On | Proxies To |
|-------|-----------|------------|
| REST proxy | `http://localhost:1418` | Local node `:1317` (if synced) OR `https://rest.getbze.com` (fallback) |
| RPC proxy | `http://localhost:26658` | Local node `:26657` (if synced) OR `https://rpc.getbze.com` (fallback) |

The dApps **always** point to the proxy URLs. They never change. The Hub handles all failover logic internally and transparently.

```
dApp (iframe)
    |
    | REST: http://localhost:1418/cosmos/bank/v1beta1/balances/bze1...
    | RPC:  http://localhost:26658
    | WS:   ws://localhost:26658/websocket
    |
    v
Hub Proxy Servers (Go, always running)
    |
    |-- Is local node synced and healthy?
    |     YES --> forward to localhost:1317 / localhost:26657
    |     NO  --> forward to https://rest.getbze.com / https://rpc.getbze.com
    |
    v
Response back to dApp (transparent, same format either way)
```

### Go Implementation

```go
// internal/proxy/proxy.go

type EndpointProxy struct {
    listenAddr    string  // e.g., ":1418"
    localTarget   string  // e.g., "http://localhost:1317"
    publicTarget  string  // e.g., "https://rest.getbze.com"
    nodeManager   *node.Manager
}

func (p *EndpointProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    var target string
    if p.nodeManager.State() == node.Synced {
        target = p.localTarget
    } else {
        target = p.publicTarget
    }

    // Reverse proxy to the selected target
    targetURL, _ := url.Parse(target)
    proxy := httputil.NewSingleHostReverseProxy(targetURL)

    // Set CORS headers for iframe access
    w.Header().Set("Access-Control-Allow-Origin", "*")
    w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

    if r.Method == "OPTIONS" {
        w.WriteHeader(http.StatusOK)
        return
    }

    proxy.ServeHTTP(w, r)
}

// RPC proxy also handles WebSocket upgrades
type RPCProxy struct {
    EndpointProxy
}

func (p *RPCProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // WebSocket upgrade for /websocket path
    if r.URL.Path == "/websocket" || isWebSocketUpgrade(r) {
        p.handleWebSocket(w, r)
        return
    }

    // Regular HTTP RPC
    p.EndpointProxy.ServeHTTP(w, r)
}

func (p *RPCProxy) handleWebSocket(w http.ResponseWriter, r *http.Request) {
    var target string
    if p.nodeManager.State() == node.Synced {
        target = strings.Replace(p.localTarget, "http", "ws", 1) + "/websocket"
    } else {
        target = strings.Replace(p.publicTarget, "https", "wss", 1) + "/websocket"
    }

    // Bidirectional WebSocket proxy
    // Use gorilla/websocket or nhooyr.io/websocket for the proxy
    // ...
}
```

### Starting the Proxies

```go
func (a *App) startup(ctx context.Context) {
    // ... other init ...

    // Start REST proxy
    restProxy := &proxy.EndpointProxy{
        listenAddr:  ":1418",
        localTarget: "http://localhost:1317",
        publicTarget: "https://rest.getbze.com",
        nodeManager: a.nodeManager,
    }
    go http.ListenAndServe("127.0.0.1:1418", restProxy)

    // Start RPC proxy (with WebSocket support)
    rpcProxy := &proxy.RPCProxy{
        EndpointProxy: proxy.EndpointProxy{
            listenAddr:  ":26658",
            localTarget: "http://localhost:26657",
            publicTarget: "https://rpc.getbze.com",
            nodeManager: a.nodeManager,
        },
    }
    go http.ListenAndServe("127.0.0.1:26658", rpcProxy)
}
```

### What the Hub-Connector Does

After the handshake, the connector writes the **proxy URLs** to localStorage. These are stable and never change:

```typescript
// Inside @bze/hub-connector, after handshake completes:

function configureEndpoints(config: HubConfig) {
    // config.proxyRest = "http://localhost:1418"
    // config.proxyRpc  = "http://localhost:26658"
    // config.chainId   = "beezee-1"
    // config.storageKeyVersion = "1"

    const key = `${config.storageKeyVersion}-${config.chainId}:bze_app_settings`;
    const settings = {
        endpoints: {
            restEndpoint: config.proxyRest,
            rpcEndpoint: config.proxyRpc,
        },
        preferredFeeDenom: "ubze",
    };

    localStorage.setItem(key, JSON.stringify({
        data: JSON.stringify(settings),
        expiry: 0,
    }));
}
```

This only needs to happen **once** (on first connection). The URLs never change. The Hub proxy handles all failover transparently.

### experimentalSuggestChain

The Keplr bridge also points `experimentalSuggestChain` to the proxy URLs:

```go
func (a *App) KeplrSuggestChain(chainInfoJSON string) error {
    var chainInfo ChainInfo
    json.Unmarshal([]byte(chainInfoJSON), &chainInfo)

    // Always point to proxy - it handles failover internally
    chainInfo.RPC = "http://localhost:26658"
    chainInfo.REST = "http://localhost:1418"

    a.bridge.SetChainInfo(chainInfo)
    return nil
}
```

### No Endpoint Change Events Needed

Since the proxy URLs are stable, the dApps **never need to be notified** of endpoint changes. The Hub proxy transparently switches between local node and public endpoints per-request. This eliminates:
- `bze-hub:endpoints-changed` messages
- localStorage rewrites on state change
- `keplr_keystorechange` events for endpoint switches
- Any race conditions with endpoint timing

### What About the Settings Sidebar?

When running in BZE Hub, the dApp's Settings sidebar should:
- Show the proxy endpoints as the current endpoints (they're valid URLs that respond)
- Optionally: disable the endpoint fields (the Hub manages them)
- The connector exports `isInHub()` so the Settings UI can detect this

### Proxy Port Configuration

Default ports (configurable in Hub settings):

| Proxy | Default Port | Config Key |
|-------|-------------|-----------|
| REST | 1418 | `proxyRestPort` |
| RPC | 26658 | `proxyRpcPort` |

These must not conflict with the actual node ports (1317, 26657). Port availability is checked at startup.

### Proxy Scope

The proxy handles **BZE chain endpoints only**:
- REST API (`/cosmos/*`, `/bze/*`, `/ibc/*` paths)
- RPC (Tendermint/CometBFT JSON-RPC)
- WebSocket (`/websocket` for real-time subscriptions)

**NOT proxied:**
- **Aggregator API** (`bze-aggregator-api`) — dApps call it directly at its public URL. The aggregator endpoint is not configurable in the dApp UIs, so no proxy needed.
- **Other chain endpoints** — The dApps support IBC chains (Osmosis, Archway, Noble, etc.) for cross-chain operations. Those chains' RPC/REST endpoints are fetched from chain-registry by `@interchain-kit` and hit directly. The Hub proxy only handles the BZE chain.
- **External services** — CoinGecko price API, Medium articles feed, etc. are called directly by the dApps or the aggregator.

### Benefits of the Proxy Approach

1. **dApps are completely unaware of failover** - they always hit the same URLs
2. **No endpoint switching logic in the frontend** - the proxy handles it per-request
3. **WebSocket connections survive** node restarts (proxy can reconnect to the backend)
4. **Future: smart routing** - the proxy could load-balance between multiple public RPCs, add request caching, rate limiting, etc.
5. **Third-party dApps work the same way** - any dApp pointed at the proxy URLs gets automatic failover

### Proxy Failover Mechanism

The proxy uses a **circuit breaker** pattern to decide when to route to local vs public. The health monitor (see 02-node-manager.md section 7) provides the base `synced` / `not synced` state, but the proxy adds its own per-request resilience on top.

#### Local Node Timeout

Every request to the local node has a **1500ms timeout**. If the local node doesn't respond within 1500ms, the proxy:
1. Forwards that same request to a public endpoint (the dApp doesn't notice)
2. Increments a timeout counter

#### Circuit Breaker (3-Strike Rule)

If **3 requests in the current session** timeout or fail against the local node:
1. The proxy marks the local node as **"unsafe"**
2. All traffic switches to public endpoints for a **2-minute cooldown**
3. After 2 minutes, the proxy tries the local node again
4. If the local node responds normally, it's marked as safe and traffic resumes
5. If it fails again, another 2-minute cooldown starts

```go
type ProxyCircuitBreaker struct {
    mu              sync.RWMutex
    failCount       int
    unsafeUntil     time.Time
    cooldownDuration time.Duration // default: 2 minutes
    failThreshold   int           // default: 3
}

func (cb *ProxyCircuitBreaker) isLocalSafe() bool {
    cb.mu.RLock()
    defer cb.mu.RUnlock()

    if cb.failCount >= cb.failThreshold {
        return time.Now().After(cb.unsafeUntil)
    }
    return true
}

func (cb *ProxyCircuitBreaker) recordFailure() {
    cb.mu.Lock()
    defer cb.mu.Unlock()

    cb.failCount++
    if cb.failCount >= cb.failThreshold {
        cb.unsafeUntil = time.Now().Add(cb.cooldownDuration)
        log.Info("[proxy] local node marked unsafe — using public endpoints for %s", cb.cooldownDuration)
    }
}

func (cb *ProxyCircuitBreaker) recordSuccess() {
    cb.mu.Lock()
    defer cb.mu.Unlock()
    cb.failCount = 0 // Reset on success
}
```

#### Request Flow

```go
func (p *EndpointProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // CORS headers (required — iframes at dApp origins call localhost)
    w.Header().Set("Access-Control-Allow-Origin", "*")
    w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
    if r.Method == "OPTIONS" {
        w.WriteHeader(http.StatusOK)
        return
    }

    // Decide target: local or public
    useLocal := p.nodeManager.State() == node.Synced && p.circuitBreaker.isLocalSafe()

    if useLocal {
        err := p.forwardWithTimeout(w, r, p.localTarget, 1500*time.Millisecond)
        if err != nil {
            // Local failed — forward to public as fallback
            log.Debug("[proxy] local node failed (%v), falling back to public", err)
            p.circuitBreaker.recordFailure()
            p.forwardToPublic(w, r)
        } else {
            p.circuitBreaker.recordSuccess()
        }
    } else {
        p.forwardToPublic(w, r)
    }
}
```

#### Error Classification

Not all errors are equal. The proxy classifies errors as recoverable or unrecoverable:

| Error Type | Classification | Action |
|-----------|---------------|--------|
| Timeout (>1500ms) | Recoverable | Fallback to public, increment fail counter |
| Connection refused | Unrecoverable | Fallback to public, mark unsafe for 2 min immediately |
| HTTP 5xx from local node | Recoverable | Fallback to public, increment fail counter |
| HTTP 4xx from local node | Not an error | Return as-is (client sent bad request) |
| Network error mid-response | Unrecoverable | Fallback to public, mark unsafe for 2 min |

For unrecoverable errors (connection refused, network error), the proxy skips the 3-strike count and marks the local node unsafe immediately — there's no point in trying 2 more times if the node is clearly down.

```go
func isUnrecoverable(err error) bool {
    // Connection refused, connection reset, no route to host
    var netErr *net.OpError
    if errors.As(err, &netErr) {
        return true
    }
    return false
}
```

#### WebSocket Failover

WebSocket connections are different from HTTP requests — they're long-lived.

**Strategy**: The dApps (`@interchain-kit`) are already configured to reconnect WebSocket connections when they fail. The proxy doesn't try to transparently migrate a live WebSocket from local to public. Instead:

1. Proxy establishes WebSocket to local node (if synced and circuit breaker is safe)
2. If local node drops the WebSocket → the proxy's connection breaks → the dApp's connection breaks
3. The dApp detects the disconnect and reconnects automatically
4. On reconnection, the proxy evaluates the current state again:
   - If local node is still healthy → connect to local
   - If local node is unhealthy (circuit breaker tripped) → connect to public

```go
func (p *RPCProxy) handleWebSocket(w http.ResponseWriter, r *http.Request) {
    // Determine target
    useLocal := p.nodeManager.State() == node.Synced && p.circuitBreaker.isLocalSafe()

    var targetWS string
    if useLocal {
        targetWS = "ws://localhost:26657/websocket"
    } else {
        targetWS = "wss://rpc.getbze.com/websocket"
    }

    // Establish bidirectional WebSocket proxy
    // When either side closes, the other side closes too
    // The dApp will reconnect, hitting this handler again with fresh routing
    proxyWebSocket(w, r, targetWS)
}
```

#### CORS

The proxy must set CORS headers on every response because dApp iframes run at their live URL origins (e.g., `https://dex.getbze.com`) and call the proxy at `http://localhost:1418` — a cross-origin request.

Headers set on every response:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

The proxy also handles `OPTIONS` preflight requests by returning `200 OK` immediately.

This is safe because the proxy only binds to `127.0.0.1` — it's not exposed to the network. The `*` origin is fine for localhost-only services.

## 8. Account Switching

When the user switches accounts in the tab bar:

```typescript
async function switchAccount(address: string) {
    await App.SetActiveAccount(address);

    // Notify all iframes
    document.querySelectorAll("iframe").forEach(iframe => {
        iframe.contentWindow?.postMessage({
            type: "bze-hub:account-changed",
        }, "*");
    });
}
```

The connector dispatches `keplr_keystorechange`, and `@interchain-kit` re-queries `window.keplr.getKey()`.

## 9. iframe Configuration

### Required Headers on dApp Servers

The dApps must allow being framed. In Next.js configuration:

```javascript
// next.config.js (for dex.getbze.com, burner.getbze.com, stake.getbze.com)
module.exports = {
    async headers() {
        return [{
            source: "/(.*)",
            headers: [
                // Allow framing from any origin (or restrict to BZE Hub if desired)
                // Remove X-Frame-Options or set to ALLOWALL
                { key: "X-Frame-Options", value: "ALLOWALL" },
                // Or use CSP frame-ancestors
                // { key: "Content-Security-Policy", value: "frame-ancestors *" },
            ],
        }];
    },
};
```

Note: `X-Frame-Options: DENY` or `SAMEORIGIN` would block the iframe. The dApps need to allow framing.

### iframe Attributes

```html
<iframe
    src="https://dex.getbze.com"
    style="width: 100%; height: 100%; border: none;"
    allow="clipboard-write"
/>
```

- No `sandbox` attribute needed for trusted BZE dApps (full functionality)
- `allow="clipboard-write"` lets dApps copy addresses to clipboard
- For future third-party dApps: add `sandbox="allow-scripts allow-same-origin allow-forms"` for isolation

### iframe Sizing

The content area fills the space between tab bar and status bar:

```css
.app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
}

.tab-bar { height: 48px; flex-shrink: 0; }
.status-bar { height: 28px; flex-shrink: 0; }

.content-area {
    flex: 1;
    position: relative;
    overflow: hidden;
}

.content-area iframe {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    border: none;
}
```

## 10. Loading States

### iframe Loading

```tsx
function DAppFrame({ tab, isActive }: DAppFrameProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    return (
        <div style={{ display: isActive ? "block" : "none", position: "relative", width: "100%", height: "100%" }}>
            {loading && <LoadingSpinner label={`Loading ${tab.label}...`} />}
            {error && <ErrorState label={tab.label} onRetry={() => { setError(false); setLoading(true); }} />}

            <iframe
                src={tab.url}
                onLoad={() => setLoading(false)}
                onError={() => { setLoading(false); setError(true); }}
                style={{ width: "100%", height: "100%", border: "none", opacity: loading ? 0 : 1 }}
            />
        </div>
    );
}
```

### Offline Mode

- dApp iframes can't load without internet -> show error state with retry button
- Dashboard tab works fully offline (React component, Wails bindings)
- Wallet management, node controls, settings all work offline
- The local node continues running (P2P sync works independently)

## 11. Tab State Preservation

All iframes are mounted once and kept alive via `display: none/block`:

- Switching from DEX to Burner hides the DEX iframe but doesn't unload it
- Switching back to DEX shows it instantly with all state preserved (scroll position, form inputs, wallet connection)
- Memory impact: 3 active iframes (each ~50-100 MB) is acceptable for a desktop app

### Lazy Loading

Iframes can be lazily initialized (only mount when first activated):

```tsx
const [mountedTabs, setMountedTabs] = useState<Set<string>>(new Set(["dashboard"]));

function onTabChange(tabId: string) {
    setActiveTab(tabId);
    setMountedTabs(prev => new Set([...prev, tabId]));
}

// Only render iframe if tab has been activated at least once
{mountedTabs.has(tab.id) && (
    <iframe src={tab.url} style={{ display: activeTab === tab.id ? "block" : "none" }} />
)}
```

This means the DEX iframe doesn't load until the user first clicks the DEX tab, saving bandwidth and memory on startup.

## 12. Future: Third-Party dApp Tabs

Users can add custom dApp URLs:

1. "Add App" button in the tab bar
2. Enter URL and name
3. If the dApp has `@bze/hub-connector`, it auto-connects via the handshake
4. If not, the Hub detects no handshake response and shows a notice: "This app doesn't support BZE Hub wallet. You may need to connect a browser wallet separately."
5. Permission model applies (see 06-security.md): first-time approval required

Custom tabs are stored in `{appdata}/config/custom-tabs.json`:

```json
{
    "tabs": [
        { "id": "custom-1", "label": "My dApp", "url": "https://my-dapp.example.com", "addedAt": "2026-03-29T12:00:00Z" }
    ]
}
```

## 13. Considerations and Risks

### iframe Maturity

iframes are one of the most mature web technologies (existed since HTML 4). All modern browsers and webview engines handle them reliably. Next.js apps work correctly inside iframes with proper header configuration.

### X-Frame-Options / CSP

The dApps MUST allow framing. This is the only server-side change needed. In Next.js, it's a single config entry. Vercel, Netlify, and self-hosted all support custom headers.

### Cross-Origin postMessage Security

- The shell validates `event.data.type` before processing (only handles `bze-hub:*` messages)
- The connector validates handshake responses before activating
- For third-party dApps: the shell can additionally check `event.origin` against the expected URL

### Performance

- 3 hidden iframes consume memory (~50-100 MB each) but no CPU when hidden
- Lazy loading mitigates initial startup cost
- Wails' WebView2/WebKit engines handle multiple iframes efficiently

### Cookie/Storage Isolation

Each iframe has its own origin, so cookies, localStorage, and IndexedDB are naturally isolated. No dApp can access another dApp's storage.
