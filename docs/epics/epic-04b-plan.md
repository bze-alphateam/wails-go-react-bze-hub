# Epic 4b Plan: @bze/hub-connector Library

## Goal

Create the standalone `@bze/hub-connector` npm package that any Cosmos dApp can import to become BZE Hub compatible. When running inside the Hub iframe, it creates a `window.keplr`-compatible API via postMessage.

## Context

The Hub shell renders dApps in iframes (Epic 4a). The connector library runs INSIDE the iframe (same origin as the dApp). It detects the Hub parent via a handshake and creates `window.keplr` that delegates signing to the Hub's Go backend through the shell's postMessage handler.

## What the Connector Does

1. On import: check if running in an iframe (`window.parent !== window`)
2. Send handshake message to parent: `{ type: "bze-hub:handshake" }`
3. Parent responds: `{ type: "bze-hub:handshake-ack", config: { chainId, proxyRest, proxyRpc, storageKeyVersion } }`
4. If no response in 500ms: not in Hub, do nothing (dApp works normally with Keplr/Leap)
5. If response: create `window.keplr` object that routes all calls via postMessage to parent
6. Write proxy endpoints to localStorage so dApp's REST client uses the Hub proxy
7. Dispatch `keplr_keystorechange` event to signal wallet availability

## Package Structure

```
hub-connector/
  package.json
  tsconfig.json
  tsup.config.ts     # Build: ESM + CJS + DTS
  src/
    index.ts          # Public API: initHubConnector(), isInHub()
    bridge.ts         # postMessage send/receive + request correlation
    keplr.ts          # window.keplr implementation
    storage.ts        # localStorage endpoint writing
    types.ts          # TypeScript interfaces
  README.md
```

## Keplr API Surface

```typescript
window.keplr = {
  enable(chainId): Promise<void>
  getKey(chainId): Promise<Key>
  getOfflineSigner(chainId): Promise<OfflineSigner>
  getOfflineSignerOnlyAmino(chainId): Promise<OfflineAminoSigner>
  signDirect(chainId, signer, signDoc): Promise<DirectSignResponse>
  signAmino(chainId, signer, signDoc): Promise<AminoSignResponse>
  experimentalSuggestChain(chainInfo): Promise<void>
  signArbitrary(chainId, signer, data): Promise<AminoSignResponse>
}
```

Each method sends a postMessage to parent with a unique request ID, waits for response.

## postMessage Protocol

```typescript
// Connector → Shell
{ type: "bze-hub:handshake" }
{ type: "bze-hub:bridge-request", id: string, method: string, params: unknown[] }

// Shell → Connector
{ type: "bze-hub:handshake-ack", config: {...} }
{ type: "bze-hub:bridge-response", id: string, result?: unknown, error?: string }

// Shell → Connector (push events)
{ type: "bze-hub:account-changed" }
{ type: "bze-hub:endpoints-changed", endpoints: { rpc, rest } }
```

## What This Does NOT Include

- No shell-side message handler (that's Epic 4c)
- No Go signing integration (that's Epic 4c)
- No approval dialog (that's Epic 4c)
- The connector is built and published but not yet integrated

## Deliverables

- `hub-connector/` folder in the monorepo with full source
- `npm run build` produces ESM + CJS + DTS
- README with integration guide (one `npm install` + one line of code)
- Unit tests for handshake, bridge, keplr API construction

## Verification

1. `cd hub-connector && npm run build` succeeds
2. The built package exports `initHubConnector()` and `isInHub()`
3. When imported in a test page outside an iframe: `initHubConnector()` returns false, does nothing
4. Types are correct (TypeScript consumers get full type safety)
