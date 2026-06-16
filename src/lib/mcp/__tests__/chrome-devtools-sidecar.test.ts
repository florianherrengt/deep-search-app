import { describe, expect, it } from "vitest";
import { resolveChromeDevToolsConnectionArgs } from "@/lib/mcp/chrome-devtools-sidecar";

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
