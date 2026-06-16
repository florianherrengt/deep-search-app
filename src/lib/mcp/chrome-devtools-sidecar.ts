import { resolveResource, createSidecarCommand } from "@/lib/tauri-bridge";
import { validateServiceUrl } from "@/lib/url-validation";
import sidecarMode from "./sidecar-mode.json";

export const CHROME_DEVTOOLS_MCP_SIDECAR = "binaries/node";
export const CHROME_DEVTOOLS_MCP_RESOURCE =
  "mcp/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js";
export const CHROME_DEVTOOLS_AUTO_CONNECT_ARG = "--auto-connect";

export function isCompiledSidecarMode(): boolean {
  return sidecarMode.mode === "compiled";
}

/**
 * Picks how the chrome-devtools-mcp server attaches to Chrome.
 *
 * With no browser URL it auto-connects to a locally running Chrome (the user
 * enables remote debugging from chrome://inspect/#remote-debugging). When a
 * browser URL is given it connects to that already-debuggable instance instead
 * (e.g. a Chrome started with --remote-debugging-port=9222). The two modes are
 * mutually exclusive in chrome-devtools-mcp, so only one flag is emitted.
 */
export function resolveChromeDevToolsConnectionArgs(browserUrl?: string): string[] {
  const trimmed = browserUrl?.trim();
  if (!trimmed) {
    return [CHROME_DEVTOOLS_AUTO_CONNECT_ARG];
  }

  const url = validateServiceUrl(trimmed);
  return [`--browser-url=${url.toString().replace(/\/$/, "")}`];
}

export async function createChromeDevToolsMcpCommand(
  options: { browserUrl?: string } = {},
) {
  const connectionArgs = resolveChromeDevToolsConnectionArgs(options.browserUrl);

  if (isCompiledSidecarMode()) {
    return createSidecarCommand(CHROME_DEVTOOLS_MCP_SIDECAR, connectionArgs);
  }

  const entrypoint = await resolveResource(CHROME_DEVTOOLS_MCP_RESOURCE);
  return createSidecarCommand(CHROME_DEVTOOLS_MCP_SIDECAR, [
    entrypoint,
    ...connectionArgs,
  ]);
}
