import { isTauri } from "@/lib/tauri-bridge";
import { getChromeDevToolsMcpClient } from "@/lib/mcp/chrome-devtools-tools";
import type { ChromeMcpConnectionMode } from "@/lib/settings-store";
import type { PageLoader } from "deep-search-core/search-extract";

const MCP_CALL_TIMEOUT_MS = 30_000;
const NAVIGATE_TIMEOUT_MS = 30_000;

function extractTextFromToolResult(
  result: { content?: Array<{ type: string; text?: string }>; isError?: boolean },
): string | null {
  if (result.isError) return null;
  const textContent = result.content?.find((c) => c.type === "text");
  return textContent?.text ?? null;
}

export function createChromeMcpPageLoader({
  connectionMode,
  browserUrl,
  nodePath,
}: {
  connectionMode?: ChromeMcpConnectionMode;
  browserUrl?: string;
  nodePath?: string;
}): PageLoader {
  return {
    fetchHtml: undefined,

    renderHtml: async (url, _options) => {
      if (!isTauri()) return null;

      const client = await getChromeDevToolsMcpClient({
        connectionMode,
        browserUrl,
        nodePath,
      });

      await client.callTool(
        {
          name: "navigate_page",
          arguments: { type: "url", url, timeout: NAVIGATE_TIMEOUT_MS },
        },
        undefined,
        { timeout: MCP_CALL_TIMEOUT_MS },
      );

      const evalResult = await client.callTool(
        {
          name: "evaluate_script",
          arguments: {
            function: "() => document.documentElement.outerHTML",
          },
        },
        undefined,
        { timeout: MCP_CALL_TIMEOUT_MS },
      );

      return extractTextFromToolResult(
        evalResult as { content?: Array<{ type: string; text?: string }>; isError?: boolean },
      );
    },
  };
}
