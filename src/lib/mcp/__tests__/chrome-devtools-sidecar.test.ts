import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.mock is hoisted above all imports, so mock refs must be hoisted too.
const { mockCreateSystemCommand, mockResolveResource, mockResolveNodePath } = vi.hoisted(() => ({
  mockCreateSystemCommand: vi.fn(),
  mockResolveResource: vi.fn(),
  mockResolveNodePath: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => ({
  createSystemCommand: mockCreateSystemCommand,
  resolveResource: mockResolveResource,
  resolveNodePath: mockResolveNodePath,
  createSidecarCommand: vi.fn(),
  isTauri: () => true,
}));

import {
  resolveChromeDevToolsConnectionArgs,
  parseNodeVersion,
  checkNodeVersion,
  createChromeDevToolsMcpCommand,
  resetNodeEnvironmentCache,
  SYSTEM_NODE_ALIAS,
} from "@/lib/mcp/chrome-devtools-sidecar";

interface ShellScope {
  name: string;
  args: Array<{ validator: string }>;
}

interface TauriPermission {
  identifier: string;
  allow?: ShellScope[];
}

describe("resolveChromeDevToolsConnectionArgs", () => {
  it("auto-connects by default and in auto mode, ignoring any browser URL", () => {
    expect(resolveChromeDevToolsConnectionArgs()).toEqual(["--auto-connect"]);
    expect(resolveChromeDevToolsConnectionArgs({ mode: "auto" })).toEqual(["--auto-connect"]);
    expect(
      resolveChromeDevToolsConnectionArgs({ mode: "auto", browserUrl: "http://127.0.0.1:9222" }),
    ).toEqual(["--auto-connect"]);
  });

  it("connects to the configured browser URL with host and port in browser-url mode", () => {
    expect(
      resolveChromeDevToolsConnectionArgs({ mode: "browser-url", browserUrl: "http://127.0.0.1:9222" }),
    ).toEqual(["--browser-url=http://127.0.0.1:9222"]);
    expect(
      resolveChromeDevToolsConnectionArgs({ mode: "browser-url", browserUrl: "http://localhost:9222" }),
    ).toEqual(["--browser-url=http://localhost:9222"]);
  });

  it("trims surrounding whitespace and a trailing slash", () => {
    expect(
      resolveChromeDevToolsConnectionArgs({ mode: "browser-url", browserUrl: "  http://127.0.0.1:9222/  " }),
    ).toEqual(["--browser-url=http://127.0.0.1:9222"]);
  });

  it("fails fast in browser-url mode when no URL is configured", () => {
    expect(() => resolveChromeDevToolsConnectionArgs({ mode: "browser-url" })).toThrow();
    expect(() => resolveChromeDevToolsConnectionArgs({ mode: "browser-url", browserUrl: "  " })).toThrow();
  });

  it("rejects malformed URLs and blocked schemes", () => {
    expect(() =>
      resolveChromeDevToolsConnectionArgs({ mode: "browser-url", browserUrl: "not a url" }),
    ).toThrow();
    expect(() =>
      resolveChromeDevToolsConnectionArgs({ mode: "browser-url", browserUrl: "file:///etc/passwd" }),
    ).toThrow();
    expect(() =>
      resolveChromeDevToolsConnectionArgs({ mode: "browser-url", browserUrl: "ftp://127.0.0.1:9222" }),
    ).toThrow();
  });
});

describe("parseNodeVersion", () => {
  it("parses version with v prefix", () => {
    expect(parseNodeVersion("v22.12.0")).toEqual({ major: 22, minor: 12, patch: 0 });
  });

  it("parses version without v prefix", () => {
    expect(parseNodeVersion("20.19.0")).toEqual({ major: 20, minor: 19, patch: 0 });
  });

  it("parses version with trailing newline", () => {
    expect(parseNodeVersion("v23.1.0\n")).toEqual({ major: 23, minor: 1, patch: 0 });
  });

  it("parses version with leading/trailing whitespace", () => {
    expect(parseNodeVersion("  v20.19.0  ")).toEqual({ major: 20, minor: 19, patch: 0 });
  });

  it("returns null for invalid input", () => {
    expect(parseNodeVersion("")).toBeNull();
    expect(parseNodeVersion("not a version")).toBeNull();
    expect(parseNodeVersion("v12")).toBeNull();
    expect(parseNodeVersion("v12.0")).toBeNull();
    expect(parseNodeVersion("v22.12.0foo")).toBeNull();
    expect(parseNodeVersion("20.19.0-beta")).toBeNull();
  });
});

describe("checkNodeVersion", () => {
  it("accepts supported versions", () => {
    expect(checkNodeVersion({ major: 20, minor: 19, patch: 0 })).toBe(true);
    expect(checkNodeVersion({ major: 20, minor: 20, patch: 1 })).toBe(true);
    expect(checkNodeVersion({ major: 22, minor: 12, patch: 0 })).toBe(true);
    expect(checkNodeVersion({ major: 22, minor: 20, patch: 5 })).toBe(true);
    expect(checkNodeVersion({ major: 23, minor: 0, patch: 0 })).toBe(true);
    expect(checkNodeVersion({ major: 24, minor: 0, patch: 0 })).toBe(true);
  });

  it("rejects unsupported versions", () => {
    expect(checkNodeVersion({ major: 20, minor: 18, patch: 0 })).toBe(false);
    expect(checkNodeVersion({ major: 22, minor: 11, patch: 0 })).toBe(false);
    expect(checkNodeVersion({ major: 19, minor: 0, patch: 0 })).toBe(false);
    expect(checkNodeVersion({ major: 18, minor: 20, patch: 0 })).toBe(false);
  });
});

describe("createChromeDevToolsMcpCommand", () => {
  const resolvedEntrypoint =
    "/resolved/mcp/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js";
  const resolvedNode = {
    path: "/opt/homebrew/bin/node",
    dir: "/opt/homebrew/bin",
    version: "v22.12.0",
    envPath: "/opt/homebrew/bin:/usr/bin:/bin",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetNodeEnvironmentCache();
    mockResolveNodePath.mockResolvedValue(resolvedNode);
    mockCreateSystemCommand.mockResolvedValue("mock-command");
    mockResolveResource.mockResolvedValue(resolvedEntrypoint);
  });

  it("resolves Node then spawns the MCP server with the resolved PATH env", async () => {
    const result = await createChromeDevToolsMcpCommand();
    expect(mockResolveNodePath).toHaveBeenCalledWith(undefined);
    expect(mockCreateSystemCommand).toHaveBeenCalledTimes(1);
    expect(mockCreateSystemCommand).toHaveBeenCalledWith(
      SYSTEM_NODE_ALIAS,
      [
        resolvedEntrypoint,
        "--experimentalStructuredContent",
        "--auto-connect",
      ],
      { PATH: resolvedNode.envPath },
    );
    expect(result).toBe("mock-command");
  });

  it("passes the override node path through to the resolver", async () => {
    await createChromeDevToolsMcpCommand({ nodePath: "/custom/node" });
    expect(mockResolveNodePath).toHaveBeenCalledWith("/custom/node");
  });

  it("passes connection args through to the system command", async () => {
    await createChromeDevToolsMcpCommand({
      mode: "browser-url",
      browserUrl: "http://127.0.0.1:9222",
    });
    expect(mockCreateSystemCommand).toHaveBeenCalledWith(
      SYSTEM_NODE_ALIAS,
      [
        resolvedEntrypoint,
        "--experimentalStructuredContent",
        "--browser-url=http://127.0.0.1:9222",
      ],
      { PATH: resolvedNode.envPath },
    );
  });

  it.each([
    ["auto-connect", {}],
    [
      "browser URL",
      {
        mode: "browser-url" as const,
        browserUrl: "http://127.0.0.1:9222",
      },
    ],
  ])("matches every managed Tauri shell scope in %s mode", async (_name, options) => {
    await createChromeDevToolsMcpCommand(options);
    const [alias, commandArgs] = mockCreateSystemCommand.mock.calls[0] as [
      string,
      string[],
    ];
    const capability = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "src-tauri/capabilities/default.json"),
        "utf8",
      ),
    ) as { permissions?: Array<string | TauriPermission> };

    expect(alias).toBe(SYSTEM_NODE_ALIAS);
    for (const identifier of [
      "shell:allow-spawn",
      "shell:allow-stdin-write",
      "shell:allow-kill",
    ]) {
      const permission = capability.permissions?.find(
        (entry): entry is TauriPermission =>
          typeof entry !== "string" && entry.identifier === identifier,
      );
      const scope = permission?.allow?.find(({ name }) => name === alias);

      expect(scope, `${identifier} ${alias} scope`).toBeDefined();
      expect(scope?.args, `${identifier} argument count`).toHaveLength(
        commandArgs.length,
      );
      for (const [index, value] of commandArgs.entries()) {
        expect(
          new RegExp(scope?.args[index]?.validator ?? "(?!)").test(value),
          `${identifier} argument ${index}: ${value}`,
        ).toBe(true);
      }
    }
  });

  it("caches the resolved Node environment across calls", async () => {
    await createChromeDevToolsMcpCommand();
    await createChromeDevToolsMcpCommand();
    expect(mockResolveNodePath).toHaveBeenCalledTimes(1);
  });

  it("re-resolves after the cache is reset", async () => {
    await createChromeDevToolsMcpCommand();
    resetNodeEnvironmentCache();
    await createChromeDevToolsMcpCommand();
    expect(mockResolveNodePath).toHaveBeenCalledTimes(2);
  });

  it("throws when the resolved Node version is unsupported", async () => {
    mockResolveNodePath.mockResolvedValueOnce({ ...resolvedNode, version: "v18.20.0" });
    await expect(createChromeDevToolsMcpCommand()).rejects.toThrow(/not supported/);
  });

  it("propagates resolver failures", async () => {
    mockResolveNodePath.mockRejectedValueOnce(new Error("Node.js was not found."));
    await expect(createChromeDevToolsMcpCommand()).rejects.toThrow(/not found/);
  });
});
