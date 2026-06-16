import { resolveResource, createSidecarCommand } from "@/lib/tauri-bridge";
import { validateServiceUrl } from "@/lib/url-validation";
import type { ChromeMcpConnectionMode } from "@/lib/settings-store";
import sidecarMode from "./sidecar-mode.json";

export const CHROME_DEVTOOLS_MCP_SIDECAR = "binaries/node";
export const CHROME_DEVTOOLS_MCP_RESOURCE =
  "mcp/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js";
export const CHROME_DEVTOOLS_AUTO_CONNECT_ARG = "--auto-connect";

export function isCompiledSidecarMode(): boolean {
  return sidecarMode.mode === "compiled";
}

/**
 * Picks how the chrome-devtools-mcp server attaches to Chrome. The two modes
 * use different mechanisms and are mutually exclusive, so exactly one flag is
 * emitted:
 *
 * - "auto": --auto-connect attaches to a Chrome whose remote debugging was
 *   enabled from chrome://inspect/#remote-debugging (Chrome 144+), discovered
 *   via the default profile's DevToolsActivePort file. Ignores any browser URL.
 * - "browser-url": connects over CDP to an already-debuggable instance, e.g. a
 *   Chrome started with --remote-debugging-port=9222. Requires a browser URL.
 */
export function resolveChromeDevToolsConnectionArgs(
  options: { mode?: ChromeMcpConnectionMode; browserUrl?: string } = {},
): string[] {
  if (options.mode !== "browser-url") {
    return [CHROME_DEVTOOLS_AUTO_CONNECT_ARG];
  }

  const trimmed = options.browserUrl?.trim();
  if (!trimmed) {
    throw new Error(
      "Chrome DevTools MCP is set to connect by URL, but no browser URL is configured.",
    );
  }

  const url = validateServiceUrl(trimmed);
  return [`--browser-url=${url.toString().replace(/\/$/, "")}`];
}

export async function createChromeDevToolsMcpCommand(
  options: { mode?: ChromeMcpConnectionMode; browserUrl?: string } = {},
) {
  const connectionArgs = resolveChromeDevToolsConnectionArgs(options);

  if (isCompiledSidecarMode()) {
    return createSidecarCommand(CHROME_DEVTOOLS_MCP_SIDECAR, connectionArgs);
  }

  const entrypoint = await resolveResource(CHROME_DEVTOOLS_MCP_RESOURCE);
  return createSidecarCommand(CHROME_DEVTOOLS_MCP_SIDECAR, [
    entrypoint,
    ...connectionArgs,
  ]);
}
