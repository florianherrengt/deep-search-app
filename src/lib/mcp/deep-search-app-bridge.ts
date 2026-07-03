import { invoke, isTauri } from "@/lib/tauri-bridge";

const MCP_BRIDGE_REQUEST_EVENT = "deep-search:mcp-request";

export interface DeepSearchMcpBridgeInfo {
  port: number;
  token: string;
  config_path: string;
  proxy_path: string;
}

interface DeepSearchMcpBridgeRequest {
  id: string;
  body: unknown;
}

export async function startDeepSearchMcpBridge(
  handler: (body: unknown) => Promise<unknown>,
): Promise<() => void> {
  if (!isTauri()) return () => {};

  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<DeepSearchMcpBridgeRequest>(
    MCP_BRIDGE_REQUEST_EVENT,
    async (event) => {
      const { id, body } = event.payload;

      try {
        const response = await handler(body);
        await respondDeepSearchMcpBridgeRequest(id, response);
      } catch (error) {
        await respondDeepSearchMcpBridgeRequest(id, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  await invoke<DeepSearchMcpBridgeInfo>("start_mcp_bridge");

  return () => {
    unlisten();
  };
}

export async function getDeepSearchMcpBridgeInfo(): Promise<DeepSearchMcpBridgeInfo | null> {
  if (!isTauri()) return null;
  return invoke<DeepSearchMcpBridgeInfo>("start_mcp_bridge");
}

async function respondDeepSearchMcpBridgeRequest(
  id: string,
  response: unknown,
): Promise<void> {
  await invoke("respond_mcp_bridge_request", { id, response });
}
