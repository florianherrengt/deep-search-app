// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notificationMocks = vi.hoisted(() => {
  const state: {
    action:
      | ((notification: { extra?: Record<string, unknown> }) => void)
      | null;
  } = { action: null };
  return {
    state,
    onNotificationAction: vi.fn(
      (callback: (notification: { extra?: Record<string, unknown> }) => void) => {
        state.action = callback;
        return () => {
          state.action = null;
        };
      },
    ),
    sendNotification: vi.fn(),
  };
});

vi.mock("@/lib/tauri-bridge", () => ({
  isNotificationPermissionGranted: vi.fn(async () => true),
  onNotificationAction: notificationMocks.onNotificationAction,
  requestNotificationPermission: vi.fn(async () => "granted"),
  sendNotification: notificationMocks.sendNotification,
}));

import { useDesktopNotifications } from "@/hooks/use-desktop-notifications";

beforeEach(() => {
  notificationMocks.state.action = null;
  notificationMocks.onNotificationAction.mockClear();
  notificationMocks.sendNotification.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("useDesktopNotifications click routing", () => {
  it("switches directly to a browser tab from a browser notification", () => {
    const activateSession = vi.fn();
    const switchToTab = vi.fn();
    const { unmount } = renderHook(() =>
      useDesktopNotifications({
        sessions: [],
        activeSessionId: "active-session",
        activateSession,
        switchToTab,
      }),
      { wrapper: StrictMode },
    );

    notificationMocks.state.action?.({
      extra: { browserTabId: "verification-tab" },
    });

    expect(switchToTab).toHaveBeenCalledWith("verification-tab");
    expect(activateSession).not.toHaveBeenCalled();
    expect(notificationMocks.state.action).not.toBeNull();

    unmount();
    expect(notificationMocks.state.action).toBeNull();
  });

  it("continues to activate research sessions from session notifications", () => {
    const activateSession = vi.fn();
    const switchToTab = vi.fn();
    renderHook(() =>
      useDesktopNotifications({
        sessions: [],
        activeSessionId: "active-session",
        activateSession,
        switchToTab,
      }),
    );

    notificationMocks.state.action?.({
      extra: {
        sessionId: "session-2",
        researchChatId: "chat-2",
        researchFolder: "folder-2",
      },
    });

    expect(activateSession).toHaveBeenCalledWith({
      researchChatId: "chat-2",
      researchFolder: "folder-2",
    });
    expect(switchToTab).toHaveBeenCalledWith("main");
  });
});
