import { useEffect, useRef } from "react";
import {
  isNotificationPermissionGranted as isPermissionGranted,
  onNotificationAction,
  requestNotificationPermission as requestPermission,
  sendNotification,
} from "@/lib/tauri-bridge";
import type { ChatSessionRecord } from "@/lib/chat-sessions";

interface UseDesktopNotificationsOptions {
  sessions: ChatSessionRecord[];
  activeSessionId: string;
  activateSession: (input: { researchChatId: string; researchFolder: string | null; forceNew?: boolean }) => void;
  switchToTab: (tabId: string) => void;
}

interface SessionState {
  isRunning: boolean;
  needsAttention: boolean;
}

interface SessionNotificationPayload {
  kind: "session";
  sessionId: string;
  researchFolder: string;
  researchChatId: string;
}

interface BrowserTabNotificationPayload {
  kind: "browser-tab";
  browserTabId: string;
}

type NotificationPayload =
  | SessionNotificationPayload
  | BrowserTabNotificationPayload;

function toExtra(
  payload: Omit<SessionNotificationPayload, "kind">,
): Record<string, unknown> {
  return {
    sessionId: payload.sessionId,
    researchFolder: payload.researchFolder,
    researchChatId: payload.researchChatId,
  };
}

function fromExtra(extra: Record<string, unknown> | undefined): NotificationPayload | null {
  if (typeof extra?.browserTabId === "string" && extra.browserTabId.trim()) {
    return {
      kind: "browser-tab",
      browserTabId: extra.browserTabId,
    };
  }
  if (!extra?.sessionId || !extra?.researchChatId) return null;
  return {
    kind: "session",
    sessionId: String(extra.sessionId),
    researchFolder: String(extra.researchFolder ?? ""),
    researchChatId: String(extra.researchChatId),
  };
}

async function trySendNotification(
  title: string,
  body: string,
  payload: Omit<SessionNotificationPayload, "kind">,
) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
    if (!granted) return;

    sendNotification({
      title,
      body,
      extra: toExtra(payload),
    });
  } catch {
    // Notification plugin may not be available in all environments
  }
}

export function useDesktopNotifications({
  sessions,
  activeSessionId,
  activateSession,
  switchToTab,
}: UseDesktopNotificationsOptions) {
  const prevStates = useRef<Map<string, SessionState>>(new Map());
  const activateSessionRef = useRef(activateSession);
  activateSessionRef.current = activateSession;
  const switchToTabRef = useRef(switchToTab);
  switchToTabRef.current = switchToTab;

  useEffect(() => {
    return onNotificationAction((notification) => {
      const payload = fromExtra(notification.extra);
      if (!payload) return;

      if (payload.kind === "browser-tab") {
        switchToTabRef.current(payload.browserTabId);
        return;
      }

      activateSessionRef.current({
        researchChatId: payload.researchChatId,
        researchFolder: payload.researchFolder || null,
      });
      switchToTabRef.current("main");
    });
  }, []);

  useEffect(() => {
    const prev = prevStates.current;
    const isFirstRun = prev.size === 0;

    for (const session of sessions) {
      const previous = prev.get(session.sessionId);

      if (!previous) {
        prev.set(session.sessionId, {
          isRunning: session.isRunning,
          needsAttention: session.needsAttention,
        });
        continue;
      }

      const isActive = session.sessionId === activeSessionId;

      if (
        previous.isRunning &&
        !session.isRunning &&
        !isActive &&
        !isFirstRun &&
        session.researchFolder
      ) {
        trySendNotification(
          "Research complete",
          session.researchFolder,
          {
            sessionId: session.sessionId,
            researchFolder: session.researchFolder,
            researchChatId: session.researchChatId,
          },
        );
      }

      if (
        !previous.needsAttention &&
        session.needsAttention &&
        !isActive &&
        !isFirstRun
      ) {
        trySendNotification(
          "Research needs your input",
          session.researchFolder ?? "Chat",
          {
            sessionId: session.sessionId,
            researchFolder: session.researchFolder ?? "",
            researchChatId: session.researchChatId,
          },
        );
      }

      prev.set(session.sessionId, {
        isRunning: session.isRunning,
        needsAttention: session.needsAttention,
      });
    }

    for (const id of prev.keys()) {
      if (!sessions.some((s) => s.sessionId === id)) {
        prev.delete(id);
      }
    }
  }, [sessions, activeSessionId]);
}
