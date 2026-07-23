// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const eventMocks = vi.hoisted(() => {
  const state: {
    handler: ((event: { payload: unknown }) => void) | null;
  } = { handler: null };
  const unlisten = vi.fn();
  return {
    state,
    unlisten,
    listen: vi.fn(
      async (_eventName: string, handler: (event: { payload: unknown }) => void) => {
        state.handler = handler;
        return unlisten;
      },
    ),
  };
});

const pluginNotificationMocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: pluginNotificationMocks.sendNotification,
}));

const invokeMock = vi.fn(async () => undefined);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  eventMocks.state.handler = null;
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  window.__deepSearchBridgeMock = { invoke: invokeMock };
});

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
  delete window.__deepSearchBridgeMock;
});

describe("Tauri notification bridge", () => {
  it("sends notifications through the native click-capable command", async () => {
    const { sendNotification } = await import("@/lib/tauri-bridge");

    sendNotification({
      title: "Browser verification required",
      body: "Solve the challenge in the browser tab.",
      extra: { browserTabId: "tab-7" },
    });

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("send_browser_tab_notification", {
        title: "Browser verification required",
        body: "Solve the challenge in the browser tab.",
        browserTabId: "tab-7",
      });
    });
  });

  it("routes native action events and unregisters the listener", async () => {
    const { onNotificationAction } = await import("@/lib/tauri-bridge");
    const callback = vi.fn();

    const dispose = onNotificationAction(callback);
    await vi.waitFor(() => {
      expect(eventMocks.listen).toHaveBeenCalledWith(
        "deep-search:browser-tab-notification-action",
        expect.any(Function),
      );
    });

    eventMocks.state.handler?.({
      payload: { browserTabId: "tab-7" },
    });
    expect(callback).toHaveBeenCalledWith({
      extra: { browserTabId: "tab-7" },
    });

    dispose();
    await vi.waitFor(() => {
      expect(eventMocks.unlisten).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps notifications without a WebView tab ID on the display-only plugin path", async () => {
    const { sendNotification } = await import("@/lib/tauri-bridge");
    const options = {
      title: "Research complete",
      body: "Research folder",
      extra: { sessionId: "session-2", researchChatId: "chat-2" },
    };

    sendNotification(options);

    await vi.waitFor(() => {
      expect(pluginNotificationMocks.sendNotification).toHaveBeenCalledWith(
        options,
      );
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "send_browser_tab_notification",
      expect.anything(),
    );
  });
});
