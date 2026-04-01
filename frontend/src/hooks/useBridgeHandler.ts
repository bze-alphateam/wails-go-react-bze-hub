import { useEffect, useCallback } from "react";
import {
  KeplrEnable, KeplrGetKey, KeplrSignAmino, KeplrSignDirect,
  KeplrSuggestChain, KeplrSignArbitrary, GetHandshakeConfig, OpenURL,
} from "../../wailsjs/go/main/App";
import type { SignApprovalRequest } from "../components/ApprovalDialog";

interface UseBridgeHandlerProps {
  onSignRequest: (request: SignApprovalRequest) => void;
}

export function useBridgeHandler({ onSignRequest }: UseBridgeHandlerProps) {
  const handleMessage = useCallback(async (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== "object" || !data.type) return;

    const source = event.source as Window;
    if (!source) return;

    // Handshake from hub-connector
    if (data.type === "bze-hub:handshake") {
      try {
        const config = await GetHandshakeConfig();
        source.postMessage({
          type: "bze-hub:handshake-ack",
          config,
        }, "*");

        // Sync current theme to the dApp immediately after handshake
        const currentTheme = localStorage.getItem("bze-hub-color-mode") || "light";
        source.postMessage({
          type: "bze-hub:theme-changed",
          theme: currentTheme,
        }, "*");

        console.log("[bridge] handshake completed");
      } catch (e) {
        console.error("[bridge] handshake failed:", e);
      }
      return;
    }

    // Open URL request from iframe (for external links, explorer, etc.)
    if (data.type === "bze-hub:open-url" && data.url) {
      OpenURL(data.url);
      return;
    }

    // Bridge request from hub-connector
    if (data.type === "bze-hub:bridge-request") {
      const { id, method, params } = data;
      handleBridgeRequest(id, method, params || [], source, onSignRequest);
      return;
    }
  }, [onSignRequest]);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);
}

async function handleBridgeRequest(
  id: string,
  method: string,
  params: unknown[],
  source: Window,
  onSignRequest: (req: SignApprovalRequest) => void,
) {
  try {
    let result: unknown;

    switch (method) {
      case "enable":
        result = await KeplrEnable(params[0] as string);
        break;

      case "getKey":
        result = await KeplrGetKey(params[0] as string);
        break;

      case "signAmino": {
        const chainId = params[0] as string;
        const signer = params[1] as string;
        const signDocJSON = JSON.stringify(params[2]);

        // Show approval dialog and wait for user decision
        const approved = await waitForApproval(onSignRequest, {
          method: "signAmino",
          chainId,
          signer,
          signDocJSON,
        });

        if (!approved) {
          throw new Error("Transaction rejected by user");
        }

        result = await KeplrSignAmino(chainId, signer, signDocJSON);
        break;
      }

      case "signDirect": {
        const chainId = params[0] as string;
        const signer = params[1] as string;
        const signDocJSON = JSON.stringify(params[2]);

        const approved = await waitForApproval(onSignRequest, {
          method: "signDirect",
          chainId,
          signer,
          signDocJSON,
        });

        if (!approved) {
          throw new Error("Transaction rejected by user");
        }

        result = await KeplrSignDirect(chainId, signer, signDocJSON);
        break;
      }

      case "suggestChain":
        result = await KeplrSuggestChain(JSON.stringify(params[0]));
        break;

      case "signArbitrary":
        result = await KeplrSignArbitrary(
          params[0] as string,
          params[1] as string,
          params[2] as string,
        );
        break;

      default:
        throw new Error(`Unknown bridge method: ${method}`);
    }

    source.postMessage({
      type: "bze-hub:bridge-response",
      id,
      result,
    }, "*");
  } catch (err) {
    source.postMessage({
      type: "bze-hub:bridge-response",
      id,
      error: (err as Error).message,
    }, "*");
  }
}

/** Show the approval dialog and return a promise that resolves when the user decides */
function waitForApproval(
  onSignRequest: (req: SignApprovalRequest) => void,
  params: { method: string; chainId: string; signer: string; signDocJSON: string },
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    onSignRequest({
      id,
      method: params.method,
      chainId: params.chainId,
      signer: params.signer,
      signDocJSON: params.signDocJSON,
      resolve,
    });
  });
}

/** Notify all dApp iframes about an account change */
export function notifyAccountChanged() {
  document.querySelectorAll("iframe").forEach((iframe) => {
    iframe.contentWindow?.postMessage({
      type: "bze-hub:account-changed",
    }, "*");
  });
}

/** Notify all dApp iframes about an endpoint change */
export function notifyEndpointsChanged(proxyRest: number, proxyRpc: number) {
  document.querySelectorAll("iframe").forEach((iframe) => {
    iframe.contentWindow?.postMessage({
      type: "bze-hub:endpoints-changed",
      endpoints: { proxyRest, proxyRpc },
    }, "*");
  });
}

/** Notify all dApp iframes about a theme change */
export function notifyThemeChanged(theme: string) {
  document.querySelectorAll("iframe").forEach((iframe) => {
    iframe.contentWindow?.postMessage({
      type: "bze-hub:theme-changed",
      theme,
    }, "*");
  });
}
