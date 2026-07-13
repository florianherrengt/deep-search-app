import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Tauri security configuration", () => {
  it("allows Tauri's custom IPC protocol without falling back to duplicate commands", () => {
    const config = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "src-tauri/tauri.conf.json"),
        "utf8",
      ),
    ) as { app?: { security?: { csp?: string } } };
    const csp = config.app?.security?.csp ?? "";
    const connectSrc = csp
      .split(";")
      .find((directive) => directive.trim().startsWith("connect-src "));

    expect(connectSrc).toContain("ipc:");
    expect(connectSrc).toContain("http://ipc.localhost");
  });
});
