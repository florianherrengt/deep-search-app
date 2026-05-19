# Settings Modal

> Date: 2026-05-20

## Overview

Add a settings/preferences modal to Deep Search, accessible via `Cmd+,` (macOS) / `Ctrl+,` (Windows/Linux) and a minimal application menu. No new Tauri plugins required.

## Architecture

- **Menu:** `@tauri-apps/api/menu` (built into Tauri v2) — single menu with "Preferences..." item, accelerator `CmdOrCtrl+,`
- **Persistence:** Existing `tauri-plugin-store` (already installed)
- **UI:** Radix Dialog via shadcn `dialog` component — modal overlay on top of chat
- **State:** `useSettings` hook wrapping the store

No new dependencies except shadcn `dialog` (and its `input`/`label` dependencies).

## Components

### `useSettings` hook

Source: `src/hooks/use-settings.ts`

Manages all settings in a single Tauri store (`settings.json`). Returns:

```ts
interface Settings {
  openrouter_api_key: string;
  brave_api_key: string;
  default_model: string;
}
```

API:
- `settings: Settings` — current values
- `loading: boolean` — true while store loads
- `updateSetting(key: keyof Settings, value: string): Promise<void>` — update and persist a single field
- `resetAll(): Promise<void>` — clear store, reset to defaults

Default values:
- `openrouter_api_key`: `""`
- `brave_api_key`: `""`
- `default_model`: `"openrouter/free"`

### `SettingsDialog` component

Source: `src/components/settings-dialog.tsx`

Radix Dialog overlay with:

1. **OpenRouter API Key** — password input, save on blur/enter
2. **Brave Search API Key** — password input, save on blur/enter
3. **Default Model** — select dropdown with predefined model list:
   - `openrouter/free` (Free)
   - `openai/gpt-4.1-mini` (GPT-4.1 Mini)
   - `openai/gpt-4.1` (GPT-4.1)
   - `anthropic/claude-sonnet-4` (Claude Sonnet 4)
   - `google/gemini-2.5-flash` (Gemini 2.5 Flash)
   - `google/gemini-2.5-pro` (Gemini 2.5 Pro)
4. **Danger zone** — "Reset All Settings" destructive button (with confirmation)

Props:
- `open: boolean`
- `onOpenChange: (open: boolean) => void`

### Menu setup

Source: `src/lib/setup-menu.ts`

Called once on app mount. Creates a minimal menu:

**macOS:** App menu named "Deep Search" with:
- Preferences... (Cmd+,)
- Separator
- Quit (Cmd+Q)

**Other platforms:** Single "File" menu with Preferences... and Quit.

The Preferences action sets `dialogOpen = true` via a callback ref passed from the app component.

### `SettingsProvider` context

Source: `src/hooks/use-settings.ts` (exported alongside the hook)

React context that provides:
- `settings` / `updateSetting` / `resetAll` from `useSettings`
- `dialogOpen` / `setDialogOpen` for the modal state

Wrapped around the app in `App.tsx`.

## Data Flow

1. App loads → `SettingsProvider` initializes → `useSettings` reads from store → settings available app-wide
2. User presses Cmd+, → menu action fires → `setDialogOpen(true)` → `SettingsDialog` appears
3. User edits field → `updateSetting()` called → store updated → React state refreshed
4. "Reset All" clicked → confirmation dialog → `resetAll()` → store cleared → app re-evaluates API key state → shows key input screen if keys removed

## Changes to Existing Code

### `App.tsx`

- Remove inline API key forms (the "onboarding" screen when no API key is set)
- Replace with: if `settings.openrouter_api_key` is empty, show a simpler onboarding screen that just prompts for the key (or just open settings dialog automatically)
- Wrap app in `SettingsProvider`
- Call `setupMenu()` in `useEffect`

### `DirectTransport` (in App.tsx)

- Read `default_model` from settings instead of hardcoded `"openrouter/free"`
- Read API keys from settings context instead of component state

### `src-tauri/capabilities/default.json`

Add menu permissions:
```json
"menu:default"
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/hooks/use-settings.ts` | Create — settings hook + context |
| `src/components/settings-dialog.tsx` | Create — modal UI |
| `src/lib/setup-menu.ts` | Create — menu setup |
| `src/App.tsx` | Modify — use settings context, remove inline forms |
| `src-tauri/capabilities/default.json` | Modify — add menu permissions |
| `src/index.css` | Possibly modify — dialog styles if needed |

## Out of Scope

- Dynamic model fetching from OpenRouter API
- Theme toggle (deferred)
- Settings export/import
