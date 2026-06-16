import { describe, expect, it } from "vitest";
import { resolveChromeDevToolsConnectionArgs } from "@/lib/mcp/chrome-devtools-sidecar";

describe("resolveChromeDevToolsConnectionArgs", () => {
  it("auto-connects when no browser URL is given", () => {
    expect(resolveChromeDevToolsConnectionArgs()).toEqual(["--auto-connect"]);
    expect(resolveChromeDevToolsConnectionArgs("")).toEqual(["--auto-connect"]);
    expect(resolveChromeDevToolsConnectionArgs("   ")).toEqual(["--auto-connect"]);
  });

  it("connects to a configured browser URL with host and port", () => {
    expect(resolveChromeDevToolsConnectionArgs("http://127.0.0.1:9222")).toEqual([
      "--browser-url=http://127.0.0.1:9222",
    ]);
    expect(resolveChromeDevToolsConnectionArgs("http://localhost:9222")).toEqual([
      "--browser-url=http://localhost:9222",
    ]);
  });

  it("trims surrounding whitespace and a trailing slash", () => {
    expect(resolveChromeDevToolsConnectionArgs("  http://127.0.0.1:9222/  ")).toEqual([
      "--browser-url=http://127.0.0.1:9222",
    ]);
  });

  it("rejects malformed URLs and blocked schemes", () => {
    expect(() => resolveChromeDevToolsConnectionArgs("not a url")).toThrow();
    expect(() => resolveChromeDevToolsConnectionArgs("file:///etc/passwd")).toThrow();
    expect(() => resolveChromeDevToolsConnectionArgs("ftp://127.0.0.1:9222")).toThrow();
  });
});
