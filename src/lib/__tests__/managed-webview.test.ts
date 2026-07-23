// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));

const tabEventMocks = vi.hoisted(() => ({
  opened: vi.fn(),
  closed: vi.fn(),
  required: vi.fn(),
  cleared: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => ({
  invoke: bridgeMocks.invoke,
  isNotificationPermissionGranted: bridgeMocks.isGranted,
  requestNotificationPermission: bridgeMocks.requestPermission,
  sendNotification: bridgeMocks.sendNotification,
}));

vi.mock("@/lib/browser-tab-events", () => ({
  emitBrowserTabOpened: tabEventMocks.opened,
  emitBrowserTabClosed: tabEventMocks.closed,
  emitBrowserTabVerificationRequired: tabEventMocks.required,
  emitBrowserTabVerificationCleared: tabEventMocks.cleared,
}));

import {
  renderWithManagedWebview,
  runExclusiveWebviewOperation,
} from "@/lib/managed-webview";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("managed WebView operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes operations and removes an aborted queued operation", async () => {
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const order: string[] = [];

    const first = runExclusiveWebviewOperation(async () => {
      order.push("first:start");
      firstStarted.resolve();
      await releaseFirst.promise;
      order.push("first:end");
    });
    await firstStarted.promise;

    const controller = new AbortController();
    const second = runExclusiveWebviewOperation(async () => {
      order.push("second");
    }, controller.signal);
    const third = runExclusiveWebviewOperation(async () => {
      order.push("third");
    });
    controller.abort();
    releaseFirst.resolve();

    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    await Promise.all([first, third]);
    expect(order).toEqual(["first:start", "first:end", "third"]);
  });

  it("keeps the tab open, marks attention once, then resumes after verification", async () => {
    vi.useFakeTimers();
    let extractionCount = 0;
    bridgeMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "extract_content") {
        extractionCount += 1;
        if (extractionCount === 1) {
          return "<html><body><form id='challenge-form'></form></body></html>";
        }
        return "<html><body><main>Google results</main></body></html>";
      }
      return undefined;
    });
    const onHumanVerification = vi.fn();

    const rendering = renderWithManagedWebview("https://www.google.com/search?q=test", {
      onHumanVerification,
    });
    await vi.runAllTimersAsync();

    await expect(rendering).resolves.toContain("Google results");
    expect(tabEventMocks.required).toHaveBeenCalledTimes(1);
    expect(tabEventMocks.cleared).toHaveBeenCalledTimes(1);
    expect(onHumanVerification).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(tabEventMocks.closed).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.invoke).toHaveBeenCalledWith("close_tab", {
      id: expect.any(String),
    });
  });

  it("waits for a dispatched native open before abort cleanup", async () => {
    const openStarted = deferred();
    const releaseOpen = deferred();
    bridgeMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "open_tab") {
        openStarted.resolve();
        await releaseOpen.promise;
      }
      return undefined;
    });
    const controller = new AbortController();

    const rendering = renderWithManagedWebview("https://example.com", {
      signal: controller.signal,
      throwOnError: true,
    });
    await openStarted.promise;
    controller.abort();

    expect(
      bridgeMocks.invoke.mock.calls.some(([command]) => command === "close_tab"),
    ).toBe(false);
    releaseOpen.resolve();

    await expect(rendering).rejects.toMatchObject({ name: "AbortError" });
    expect(bridgeMocks.invoke).toHaveBeenCalledWith("close_tab", {
      id: expect.any(String),
    });
  });

  it("can surface navigation errors for standalone browser tools", async () => {
    bridgeMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "open_tab") throw new Error("WebView navigation failed");
      return undefined;
    });

    await expect(
      renderWithManagedWebview("https://www.google.com/search?q=test", {
        throwOnError: true,
      }),
    ).rejects.toThrow("WebView navigation failed");
    expect(tabEventMocks.closed).toHaveBeenCalledTimes(1);
  });
});
