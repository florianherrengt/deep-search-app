import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.mock is hoisted above all imports, so mock refs must be hoisted too.
const { mockCreateSystemCommand, mockResolveResource } = vi.hoisted(() => ({
  mockCreateSystemCommand: vi.fn(),
  mockResolveResource: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => ({
  createSystemCommand: mockCreateSystemCommand,
  resolveResource: mockResolveResource,
  createSidecarCommand: vi.fn(),
  isTauri: () => true,
}));

import {
  resolveChromeDevToolsConnectionArgs,
  parseNodeVersion,
  checkNodeVersion,
  validateSystemNode,
  createChromeDevToolsMcpCommand,
  SYSTEM_NODE_ALIAS,
} from "@/lib/mcp/chrome-devtools-sidecar";

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

describe("validateSystemNode", () => {
  function mockNodeVersion(stdout: string, code = 0) {
    const cmd = {
      execute: vi.fn().mockResolvedValue({ code, signal: null, stdout, stderr: "" }),
    };
    mockCreateSystemCommand.mockResolvedValue(cmd);
  }

  function mockNodeMissing(stderr: string, code = 1) {
    const cmd = {
      execute: vi.fn().mockResolvedValue({ code, signal: null, stdout: "", stderr }),
    };
    mockCreateSystemCommand.mockResolvedValue(cmd);
  }

  beforeEach(() => {
    mockCreateSystemCommand.mockReset();
  });

  it("calls createSystemCommand with the system-node alias and --version", async () => {
    mockNodeVersion("v22.12.0\n");
    await validateSystemNode();
    expect(mockCreateSystemCommand).toHaveBeenCalledWith(SYSTEM_NODE_ALIAS, ["--version"]);
  });

  it("accepts valid Node version v22.12.0", async () => {
    mockNodeVersion("v22.12.0\n");
    const version = await validateSystemNode();
    expect(version).toBe("v22.12.0");
  });

  it("accepts valid Node version v20.19.0", async () => {
    mockNodeVersion("v20.19.0\n");
    const version = await validateSystemNode();
    expect(version).toBe("v20.19.0");
  });

  it("accepts valid Node version v23.0.0", async () => {
    mockNodeVersion("v23.0.0\n");
    const version = await validateSystemNode();
    expect(version).toBe("v23.0.0");
  });

  it("rejects Node when command exits nonzero", async () => {
    mockNodeMissing("command not found", 127);
    await expect(validateSystemNode()).rejects.toThrow(
      /not installed|not accessible from PATH/,
    );
  });

  it("rejects Node when version output is unparseable", async () => {
    mockNodeVersion("garbage");
    await expect(validateSystemNode()).rejects.toThrow(
      /Failed to parse Node version/,
    );
  });

  it("rejects unsupported Node version v20.18.0", async () => {
    mockNodeVersion("v20.18.0\n");
    await expect(validateSystemNode()).rejects.toThrow(
      /not supported/,
    );
  });

  it("rejects unsupported Node version v22.11.0", async () => {
    mockNodeVersion("v22.11.0\n");
    await expect(validateSystemNode()).rejects.toThrow(
      /not supported/,
    );
  });

  it("rejects unsupported Node version v18.20.0", async () => {
    mockNodeVersion("v18.20.0\n");
    await expect(validateSystemNode()).rejects.toThrow(
      /not supported/,
    );
  });
});

describe("createChromeDevToolsMcpCommand", () => {
  let sharedCmd: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    sharedCmd = {
      execute: vi.fn().mockResolvedValue({ code: 0, signal: null, stdout: "v22.12.0\n", stderr: "" }),
    };
    mockCreateSystemCommand.mockResolvedValue(sharedCmd);
    mockResolveResource.mockResolvedValue("/resolved/chrome-devtools-mcp.js");
  });

  it("validates Node before returning the MCP command", async () => {
    const result = await createChromeDevToolsMcpCommand();
    expect(mockCreateSystemCommand).toHaveBeenCalledTimes(2);
    expect(mockCreateSystemCommand).toHaveBeenNthCalledWith(1, SYSTEM_NODE_ALIAS, ["--version"]);
    expect(mockCreateSystemCommand).toHaveBeenNthCalledWith(
      2,
      SYSTEM_NODE_ALIAS,
      ["/resolved/chrome-devtools-mcp.js", "--auto-connect"],
    );
    expect(result).toBe(sharedCmd);
  });

  it("passes connection args through to the system command", async () => {
    await createChromeDevToolsMcpCommand({
      mode: "browser-url",
      browserUrl: "http://127.0.0.1:9222",
    });
    expect(mockCreateSystemCommand).toHaveBeenCalledTimes(2);
    expect(mockCreateSystemCommand).toHaveBeenNthCalledWith(
      2,
      SYSTEM_NODE_ALIAS,
      ["/resolved/chrome-devtools-mcp.js", "--browser-url=http://127.0.0.1:9222"],
    );
  });
});
