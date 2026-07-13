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

  it("redacts credentials from window error messages", async () => {
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
        message: "Authorization: Bearer window-secret-token",
        filename: "app.js",
      }),
    );

    await vi.runOnlyPendingTimersAsync();

    const entries = appendAppLog.mock.calls[0][0];
    const windowError = entries.find((entry) => entry.target === "window.error");
    expect(windowError?.message).not.toContain("window-secret-token");
    expect(windowError?.message).toContain("[REDACTED]");
  });

  it("serializes circular objects and Error values", async () => {
    const { serializeLogArg } = await import("@/lib/app-logger");
    const value: { nested?: unknown } = {};
    value.nested = value;

    expect(serializeLogArg(value)).toContain("[Circular]");
    expect(serializeLogArg(new Error("broken"))).toContain("broken");
  });

  it("redacts sensitive fields and credentials from persisted log text", async () => {
    const { serializeLogArg } = await import("@/lib/app-logger");

    const serialized = serializeLogArg({
      apiKey: "sk-super-secret-key",
      nested: {
        titlePreview: "private research question",
        safeCount: 3,
      },
    });
    const bearer = serializeLogArg("Authorization: Bearer secret-token-value");
    const basic = serializeLogArg("Authorization: Basic dXNlcjpwYXNzd29yZA==");
    const cookie = serializeLogArg("Cookie: session=secret; preference=private");
    const rawJson = serializeLogArg(
      '{"apiKey":"sk-json-secret","authorization":"Basic json-secret","titlePreview":"private preview"}',
    );
    const embeddedJson = serializeLogArg(
      'HTTP 401: {"apiKey":"sk-embedded-secret","authorization":"Basic embedded-secret"}',
    );
    const aliasedFields = serializeLogArg({
      secretAccessKey: "access-key-secret",
      privateKey: "private-key-secret",
      passphrase: "passphrase-secret",
      credentials: "credential-secret",
      authorizationHeader: "Bearer header-secret",
      cookieHeader: "session=cookie-secret",
    });
    const queryCredentials = serializeLogArg(
      "https://api.example.test/data?token=query-token&api_key=query-api-key&safe=true",
    );
    const quotedAssignments = serializeLogArg(
      `request failed; apiKey: "quoted-api-secret" password='quoted-password'`,
    );
    const nestedSerializedJson = serializeLogArg({
      body: '{"apiKey":"nested-json-secret","authorization":"Basic nested-auth-secret"}',
    });

    expect(serialized).toContain('"safeCount":3');
    expect(serialized).not.toContain("sk-super-secret-key");
    expect(serialized).not.toContain("private research question");
    expect(serialized).toContain("[REDACTED]");
    expect(bearer).not.toContain("secret-token-value");
    expect(bearer).toContain("[REDACTED]");
    expect(basic).not.toContain("dXNlcjpwYXNzd29yZA==");
    expect(cookie).not.toContain("session=secret");
    expect(cookie).not.toContain("preference=private");
    expect(rawJson).not.toContain("sk-json-secret");
    expect(rawJson).not.toContain("json-secret");
    expect(rawJson).not.toContain("private preview");
    expect(embeddedJson).not.toContain("sk-embedded-secret");
    expect(embeddedJson).not.toContain("embedded-secret");
    expect(aliasedFields).not.toContain("access-key-secret");
    expect(aliasedFields).not.toContain("private-key-secret");
    expect(aliasedFields).not.toContain("passphrase-secret");
    expect(aliasedFields).not.toContain("credential-secret");
    expect(aliasedFields).not.toContain("header-secret");
    expect(aliasedFields).not.toContain("cookie-secret");
    expect(queryCredentials).not.toContain("query-token");
    expect(queryCredentials).not.toContain("query-api-key");
    expect(queryCredentials).toContain("safe=true");
    expect(quotedAssignments).not.toContain("quoted-api-secret");
    expect(quotedAssignments).not.toContain("quoted-password");
    expect(nestedSerializedJson).not.toContain("nested-json-secret");
    expect(nestedSerializedJson).not.toContain("nested-auth-secret");
  });
});
