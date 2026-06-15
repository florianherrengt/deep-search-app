import { resolveResource, createSidecarCommand } from "@/lib/tauri-bridge";
import sidecarMode from "./sidecar-mode.json";

export const CHROME_DEVTOOLS_MCP_SIDECAR = "binaries/node";
export const CHROME_DEVTOOLS_MCP_RESOURCE =
  "mcp/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js";
export const CHROME_DEVTOOLS_MCP_ARGS = ["--auto-connect"] as const;

export function isCompiledSidecarMode(): boolean {
  return sidecarMode.mode === "compiled";
}

export async function createChromeDevToolsMcpCommand() {
  if (isCompiledSidecarMode()) {
    return createSidecarCommand(CHROME_DEVTOOLS_MCP_SIDECAR, [
      ...CHROME_DEVTOOLS_MCP_ARGS,
    ]);
  }

  const entrypoint = await resolveResource(CHROME_DEVTOOLS_MCP_RESOURCE);
  return createSidecarCommand(CHROME_DEVTOOLS_MCP_SIDECAR, [
    entrypoint,
    ...CHROME_DEVTOOLS_MCP_ARGS,
  ]);
}
