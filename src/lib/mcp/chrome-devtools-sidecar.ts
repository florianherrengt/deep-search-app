import { resolveResource } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";

export const CHROME_DEVTOOLS_MCP_SIDECAR = "binaries/node";
export const CHROME_DEVTOOLS_MCP_RESOURCE =
  "mcp/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js";
export const CHROME_DEVTOOLS_MCP_ARGS = ["--auto-connect"] as const;

export async function createChromeDevToolsMcpCommand() {
  const entrypoint = await resolveResource(CHROME_DEVTOOLS_MCP_RESOURCE);
  return Command.sidecar(CHROME_DEVTOOLS_MCP_SIDECAR, [
    entrypoint,
    ...CHROME_DEVTOOLS_MCP_ARGS,
  ]);
}
