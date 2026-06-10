# Desktop Notifications

## Problem

When a long-running AI research chat finishes in the background, or when the AI needs user input (question, permission) while the user is looking at a different session or tab, there is no way to know without manually checking. Users lose track of background research tasks.

## Solution

Send native OS notifications (macOS Notification Center, Windows Action Center) via `tauri-plugin-notification` when background chat sessions complete or need attention. Clicking a notification navigates to the relevant chat.

## Notification triggers

| Event | Condition | Notification title | Notification body |
|---|---|---|---|
| Research run completes | A session transitions from `isRunning: true` to `isRunning: false` AND the session was not the active session | "Research complete" | `{folderName}` (or "Chat" if no folder) |
| Attention needed | A session transitions to `needsAttention: true` AND the session is not the active session | "Research needs your input" | `{folderName}` (or "Chat" if no folder) |

Notifications are only sent for **non-active background sessions**. If the user is already viewing the session that just completed or needs attention, no notification fires.

## Click behavior

Each notification carries a data payload: `{ sessionId, researchFolder, researchChatId }`. The `onAction` listener from `@tauri-apps/plugin-notification` reads this payload and calls `activateSession` + `switchToTab("main")` to navigate to the relevant chat.

## Permission handling

Permission is requested lazily on the first notification attempt — not on app startup. If permission is denied, notifications are silently skipped.

## Suppression rules

- Don't notify on first render or session creation (avoid spurious notifications on app startup).
- Don't notify if the triggering session is the active session.
- Don't notify if permission hasn't been granted (checked each time, not cached).

## Architecture

### New file: `src/hooks/use-desktop-notifications.ts`

A single hook that observes `ChatSessionRecord[]` and fires notifications on state transitions.

```ts
interface UseDesktopNotificationsOptions {
  sessions: ChatSessionRecord[];
  activeSessionId: string;
  activateSession: (input: CreateChatSessionInput) => void;
  switchToTab: (tabId: string) => void;
}

function useDesktopNotifications(options: UseDesktopNotificationsOptions): void;
```

The hook:
1. Stores previous session states in a `useRef` map (`sessionId -> { isRunning, needsAttention }`).
2. On each render, compares current vs previous states.
3. On a relevant transition (running->stopped or attention newly true), checks if the session is not active, then attempts to send a notification.
4. On notification action, calls `activateSession` and `switchToTab`.
5. Skips notifications on the first render (when previous state map is empty).

### Changes to existing files

1. **`src-tauri/Cargo.toml`** — add `tauri-plugin-notification = "2"` dependency
2. **`src-tauri/src/lib.rs`** — add `.plugin(tauri_plugin_notification::init())` to the builder chain
3. **`src-tauri/capabilities/default.json`** — add `"notification:default"` to the permissions array
4. **`src/App.tsx`** — call `useDesktopNotifications` in `AppInner`, passing sessions, activeSessionId, activateSession, and switchToTab

### No Rust commands needed

All notification logic lives in the frontend. The Rust side only registers the plugin.
