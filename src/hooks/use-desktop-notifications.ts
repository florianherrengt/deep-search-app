import { useEffect, useRef } from "react";
import {
  isNotificationPermissionGranted as isPermissionGranted,
  onNotificationAction,
  requestNotificationPermission as requestPermission,
  sendNotification,
} from "@/lib/tauri-bridge";
import type { ChatSessionRecord } from "@/App";

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

interface NotificationPayload {
  sessionId: string;
  researchFolder: string;
  researchChatId: string;
}

function toExtra(payload: NotificationPayload): Record<string, unknown> {
  return {
    sessionId: payload.sessionId,
    researchFolder: payload.researchFolder,
    researchChatId: payload.researchChatId,
  };
}

function fromExtra(extra: Record<string, unknown> | undefined): NotificationPayload | null {
  if (!extra?.sessionId || !extra?.researchChatId) return null;
  return {
    sessionId: String(extra.sessionId),
    researchFolder: String(extra.researchFolder ?? ""),
    researchChatId: String(extra.researchChatId),
  };
}

async function trySendNotification(title: string, body: string, payload: NotificationPayload) {
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
  const activated = useRef(false);
  const activateSessionRef = useRef(activateSession);
  activateSessionRef.current = activateSession;
  const switchToTabRef = useRef(switchToTab);
  switchToTabRef.current = switchToTab;

  useEffect(() => {
    if (activated.current) return;
    activated.current = true;

    let cancelled = false;
    onNotificationAction((notification) => {
      if (cancelled) return;
      const payload = fromExtra(notification.extra);
      if (!payload) return;

      activateSessionRef.current({
        researchChatId: payload.researchChatId,
        researchFolder: payload.researchFolder || null,
      });
      switchToTabRef.current("main");
    });

    return () => {
      cancelled = true;
    };
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
