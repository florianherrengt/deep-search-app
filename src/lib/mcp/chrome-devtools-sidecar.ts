import { resolveResource, createSystemCommand, resolveNodePath } from "@/lib/tauri-bridge";
import { validateServiceUrl } from "@/lib/url-validation";
import type { ChromeMcpConnectionMode } from "@/lib/settings-store";

export const SYSTEM_NODE_ALIAS = "system-node";
export const CHROME_DEVTOOLS_MCP_RESOURCE =
  "mcp/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js";
export const CHROME_DEVTOOLS_AUTO_CONNECT_ARG = "--auto-connect";

/**
 * Required Node version range for chrome-devtools-mcp.
 * Matches the engines.node field from chrome-devtools-mcp/package.json.
 */
export const REQUIRED_NODE_RANGE = "^20.19.0 || ^22.12.0 || >=23";

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parses semver strings like "v22.12.0" or "22.12.0".
 * Returns null if the string cannot be parsed.
 */
export function parseNodeVersion(raw: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Checks whether a parsed Semver satisfies the required Node range.
 * Range: ^20.19.0 (20.x, >=20.19.0), ^22.12.0 (22.x, >=22.12.0), >=23 (23+).
 */
export function checkNodeVersion(version: Semver): boolean {
  const { major, minor } = version;
  return (
    (major === 20 && minor >= 19) ||
    (major === 22 && minor >= 12) ||
    major >= 23
  );
}

/**
 * Resolves the Node binary to launch the chrome-devtools-mcp sidecar with, via
 * the Rust `resolve_node_path` command. A GUI app's PATH usually does not
 * include Homebrew or version-manager directories, so the resolver probes the
 * login shell and common locations (or honors a user-supplied override) and
 * returns a `PATH` env var that makes a bare `node` resolve. The result is
 * cached per override key.
 */
let nodeEnvPromise: Promise<{ envPath: string; version: string }> | null = null;
let nodeEnvKey: string | null = null;

function getNodeEnvironment(
  nodePath: string | undefined,
): Promise<{ envPath: string; version: string }> {
  const key = nodePath?.trim() || "auto";
  if (nodeEnvPromise && nodeEnvKey === key) return nodeEnvPromise;
  nodeEnvKey = key;
  nodeEnvPromise = (async () => {
    const resolved = await resolveNodePath(nodePath);
    const parsed = parseNodeVersion(resolved.version);
    if (!parsed || !checkNodeVersion(parsed)) {
      throw new Error(
        `Node ${resolved.version} is not supported. Deep Search requires Node ${REQUIRED_NODE_RANGE}.`,
      );
    }
    return { envPath: resolved.envPath, version: resolved.version };
  })().catch((error) => {
    nodeEnvPromise = null;
    nodeEnvKey = null;
    throw error instanceof Error ? error : new Error(String(error));
  });
  return nodeEnvPromise;
}

/** Clears the cached Node resolution. Call when the override setting changes. */
export function resetNodeEnvironmentCache(): void {
  nodeEnvPromise = null;
  nodeEnvKey = null;
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
  options: { mode?: ChromeMcpConnectionMode; browserUrl?: string; nodePath?: string } = {},
) {
  const { envPath } = await getNodeEnvironment(options.nodePath);
  const connectionArgs = resolveChromeDevToolsConnectionArgs(options);
  const entrypoint = await resolveResource(CHROME_DEVTOOLS_MCP_RESOURCE);
  return createSystemCommand(SYSTEM_NODE_ALIAS, [entrypoint, ...connectionArgs], {
    PATH: envPath,
  });
}
