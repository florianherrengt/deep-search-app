import { resolveResource, createSystemCommand } from "@/lib/tauri-bridge";
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
 * Runs `node --version` via the Tauri shell plugin and validates the result
 * against the required Node range. Returns the version string on success.
 * Throws with a descriptive message if Node is missing, unsupported, or the
 * output cannot be parsed.
 */
export async function validateSystemNode(): Promise<string> {
  const cmd = await createSystemCommand(SYSTEM_NODE_ALIAS, ["--version"]);
  const result = await cmd.execute();

  if (result.code !== 0) {
    const detail = result.stderr?.trim() || `exit code ${result.code}`;
    throw new Error(
      `Node.js is not installed or not accessible from PATH (${detail}). ` +
        `Deep Search requires Node ${REQUIRED_NODE_RANGE}. Install Node from https://nodejs.org and ensure it is on your PATH.`,
    );
  }

  const raw = (result.stdout || "").trim();
  const version = parseNodeVersion(raw);
  if (!version) {
    throw new Error(
      `Failed to parse Node version from output: "${raw}". ` +
        `Deep Search requires Node ${REQUIRED_NODE_RANGE}.`,
    );
  }

  if (!checkNodeVersion(version)) {
    throw new Error(
      `Node ${version.major}.${version.minor}.${version.patch} is not supported. ` +
        `Deep Search requires Node ${REQUIRED_NODE_RANGE}. ` +
        `Please upgrade Node from https://nodejs.org.`,
    );
  }

  return raw;
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
  await validateSystemNode();
  const connectionArgs = resolveChromeDevToolsConnectionArgs(options);
  const entrypoint = await resolveResource(CHROME_DEVTOOLS_MCP_RESOURCE);
  return createSystemCommand(SYSTEM_NODE_ALIAS, [entrypoint, ...connectionArgs]);
}
