// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLogEntry } from "@/lib/tauri-bridge";

let disposeLogger: (() => void) | null = null;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
});

afterEach(() => {
  disposeLogger?.();
  disposeLogger = null;
  delete (window as Window & { __deepSearchBridgeMock?: unknown })
    .__deepSearchBridgeMock;
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("app logger", () => {
  it("writes console messages to the app log sink", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const appendAppLog = vi.fn<(entries: AppLogEntry[]) => Promise<string | null>>(
      async () => "/tmp/deep-search.log",
    );
    const { setBridgeMock } = await import("@/lib/tauri-bridge");
    setBridgeMock({ appendAppLog });
    const { disposeAppLoggerForTests, initializeAppLogger } = await import(
      "@/lib/app-logger"
    );
    disposeLogger = disposeAppLoggerForTests;

    initializeAppLogger();
    console.log("plain log");
    console.error("failed", new Error("model exploded"));

    await vi.runOnlyPendingTimersAsync();

    expect(consoleLog).toHaveBeenCalledWith("plain log");
    expect(consoleError).toHaveBeenCalledWith("failed", expect.any(Error));
    expect(appendAppLog).toHaveBeenCalledTimes(1);
    const entries = appendAppLog.mock.calls[0][0];
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          target: "logger",
          message: "App file logging initialized.",
        }),
        expect.objectContaining({
          level: "log",
          target: "console",
          message: "plain log",
        }),
        expect.objectContaining({
          level: "error",
          target: "console",
          message: expect.stringContaining("model exploded"),
        }),
      ]),
    );
  });

  it("captures window error events", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const appendAppLog = vi.fn<(entries: AppLogEntry[]) => Promise<string | null>>(
      async () => "/tmp/deep-search.log",
    );
    const { setBridgeMock } = await import("@/lib/tauri-bridge");
    setBridgeMock({ appendAppLog });
    const { disposeAppLoggerForTests, initializeAppLogger } = await import(
      "@/lib/app-logger"
    );
    disposeLogger = disposeAppLoggerForTests;

    initializeAppLogger();
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "render failed",
        filename: "app.js",
        lineno: 12,
        colno: 8,
        error: new Error("render failed"),
      }),
    );

    await vi.runOnlyPendingTimersAsync();

    const entries = appendAppLog.mock.calls[0][0];
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          target: "window.error",
          message: expect.stringContaining("app.js:12:8"),
        }),
      ]),
    );
  });

  it("serializes circular objects and Error values", async () => {
    const { serializeLogArg } = await import("@/lib/app-logger");
    const value: { nested?: unknown } = {};
    value.nested = value;

    expect(serializeLogArg(value)).toContain("[Circular]");
    expect(serializeLogArg(new Error("broken"))).toContain("broken");
  });
});
