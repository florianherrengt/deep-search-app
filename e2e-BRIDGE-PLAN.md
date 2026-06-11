# Tauri Bridge Refactor Plan

## Goal

Centralize all Tauri API calls behind a single `src/lib/tauri-bridge.ts` module so the entire app can run and be tested in a plain browser (no Tauri runtime). This eliminates the need for `tauri-plugin-playwright` and makes Playwright browser-only e2e tests work for the full chat flow.

## Current Problem

Tauri imports are scattered across ~20 files. Some have ad-hoc `window.__deepSearch*Mock` hooks (6 different ones), others have no mocking at all. The `__TAURI_INTERNALS__` mock in `e2e/fixtures.ts` is incomplete — `invoke` returns `undefined`, crashing callers that destructure results.

## Architecture

### Before (scattered)

```
research-search.ts ──── invoke() from @tauri-apps/api/core
chat-providers.ts ───── fetch() from @tauri-apps/plugin-http
serper-search-tool.ts ── fetch() from @tauri-apps/plugin-http
app-file-storage.ts ──── writeTextFile() from @tauri-apps/plugin-fs
store.ts ─────────────── load() from @tauri-apps/plugin-store
setup-menu.ts ────────── MenuItem.new() from @tauri-apps/api/menu
markdown-text.tsx ────── openUrl() from @tauri-apps/plugin-opener
use-browser-tabs.tsx ─── invoke() from @tauri-apps/api/core
... etc (20+ files)
```

### After (bridge)

```
All files ──▶ src/lib/tauri-bridge.ts ──▶ @tauri-apps/* (in Tauri)
                                         ──▶ mock implementations (in browser/tests)
```

## New Module: `src/lib/tauri-bridge.ts`

One file that re-exports every Tauri API the app uses. Each export is either:
- The real Tauri API (when running in Tauri)
- A no-op / stub (when running in browser/tests)

```ts
// src/lib/tauri-bridge.ts

// ─── Detection ───
export function isTauri(): boolean { ... }

// ─── Core: invoke ───
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>

// ─── HTTP fetch ───
export async function fetch(input, init?): Promise<Response>

// ─── File system ───
export async function writeTextFile(path, content): Promise<void>
export async function readTextFile(path): Promise<string>
export async function exists(path): Promise<boolean>
export async function readDir(path): Promise<DirEntry[]>
export async function remove(path, opts?): Promise<void>
export async function rename(oldPath, newPath): Promise<void>
export async function mkdir(path): Promise<void>

// ─── Store ───
export async function loadStore(filename, defaults?): Promise<{ get, set, save }>

// ─── Path ───
export async function appDataDir(): Promise<string>
export async function join(...paths): Promise<string>
export async function resolveResource(path): Promise<string>

// ─── Opener ───
export async function openUrl(url): Promise<void>
export async function openPath(path): Promise<void>

// ─── Menu ───
export async function setupAppMenu(): Promise<void>

// ─── Notifications ───
export async function isNotificationPermissionGranted(): Promise<boolean>
export async function requestNotificationPermission(): Promise<string>
export function sendNotification(opts): void
export function onNotificationAction(cb): () => void

// ─── Shell ───
export async function createSidecarCommand(name, args): Promise<SidecarProcess>

// ─── Updater ───
export async function checkForUpdate(opts?): Promise<Update | null>
export async function relaunchApp(): Promise<void>
```

### Mock mode

The bridge checks `isTauri()` once at import time. When false, every function is replaced with a stub or reads from `window.__deepSearchBridgeMock` (a single mock object for tests).

```ts
// Test override — single hook instead of 6 different ones
window.__deepSearchBridgeMock = {
  invoke: async (cmd, args) => { ... },
  fetch: async (input, init) => { ... },
  writeAppFile: async (path, content) => { ... },
  // ... only mock what the test needs
};
```

## Files Changed

### 1. New files

| File | Purpose |
|------|---------|
| `src/lib/tauri-bridge.ts` | The bridge module — all Tauri API calls go through here |
| `src/lib/__tests__/tauri-bridge.test.ts` | Unit tests for the bridge itself |

### 2. Files that swap imports (mechanical)

Each file changes `from "@tauri-apps/..."` → `from "@/lib/tauri-bridge"`.

| File | Current imports | What changes |
|------|----------------|--------------|
| `src/lib/research-search.ts` | `invoke` from core | `invoke` from bridge |
| `src/hooks/use-browser-tabs.tsx` | `invoke` from core | `invoke` from bridge |
| `src/tools/searxng-search-tool.ts` | `invoke` from core | `invoke` from bridge |
| `src/tools/extract-page-content-tool.ts` | `invoke` from core | `invoke` from bridge |
| `src/lib/chat-providers.ts` | `fetch` from plugin-http, `isTauriRuntime()` | `fetch`, `isTauri` from bridge; remove `isTauriRuntime()` |
| `src/tools/serper-search-tool.ts` | `fetch` from plugin-http | `fetch` from bridge |
| `src/tools/brave-search-tool.ts` | `fetch` from plugin-http | `fetch` from bridge |
| `src/tools/exa-search-tool.ts` | `fetch` from plugin-http | `fetch` from bridge |
| `src/tools/tavily-search-tool.ts` | `fetch` from plugin-http | `fetch` from bridge |
| `src/tools/currency-conversion-tool.ts` | `fetch` from plugin-http | `fetch` from bridge |
| `src/tools/disambiguate-tool.ts` | `fetch` from plugin-http | `fetch` from bridge |
| `src/lib/app-file-storage.ts` | plugin-fs (7 functions) | file system functions from bridge |
| `src/lib/store.ts` | `load` from plugin-store | `loadStore` from bridge |
| `src/lib/setup-menu.ts` | menu API | `setupAppMenu` from bridge |
| `src/components/assistant-ui/markdown-text.tsx` | `openUrl` from plugin-opener | `openUrl` from bridge |
| `src/components/research-sidebar.tsx` | `appDataDir`, `join`, `openPath` | path + opener from bridge |
| `src/hooks/use-app-update.ts` | `isTauri`, `relaunch`, updater | updater functions from bridge |
| `src/hooks/use-desktop-notifications.ts` | notification API | notification functions from bridge |
| `src/lib/mcp/chrome-devtools-tools.ts` | `isTauri` from core | `isTauri` from bridge |
| `src/lib/mcp/chrome-devtools-sidecar.ts` | `resolveResource`, `Command` | shell functions from bridge |
| `src/lib/mcp/tauri-stdio-transport.ts` | `Command`, `Child` types | shell types from bridge |

### 3. Remove per-file mock hooks

Delete `__deepSearch*Mock` from all files and replace with unified bridge mock:

| Existing mock hook | File | Replaced by |
|---------------------|------|-------------|
| `__deepSearchProviderFetchMock` | `chat-providers.ts` | `bridgeMock.fetch` |
| `__deepSearchAppFileStorageMock` | `app-file-storage.ts` | `bridgeMock.writeAppFile` etc. |
| `__deepSearchResearchSearchMock` | `research-search.ts` | `bridgeMock.invoke` |
| `__deepSearchWebviewExtractionMock` | `extract-page-content-tool.ts` | `bridgeMock.invoke` |
| `__deepSearchFetchHtmlMock` | `extract-page-content-tool.ts` | `bridgeMock.invoke` |
| `__deepSearchDisambiguateMock` | `disambiguate-tool.ts` | `bridgeMock.fetch` or direct mock |
| `__deepSearchCurrencyMock` | `currency-conversion-tool.ts` | `bridgeMock.fetch` or direct mock |

### 4. Test files updated

| File | Change |
|------|--------|
| `e2e/fixtures.ts` | Replace `__TAURI_INTERNALS__` + per-mock setup with `window.__deepSearchBridgeMock` |
| `e2e/tests/chat-mock.spec.ts` | Use bridge mock instead of scattered mocks |
| `src/lib/__tests__/app-file-storage.test.ts` | Mock bridge module instead of `@tauri-apps/plugin-fs` |
| `src/lib/__tests__/research-history.test.ts` | Same |
| `src/tools/__tests__/extract-page-content-tool.test.ts` | Mock bridge instead of `invoke` |
| `src/components/research-sidebar.stories.tsx` | Use bridge mock |
| `src/lib/__tests__/transport-guardrails.test.ts` | Update `isTauri` mock |

## Implementation Order

### Phase 1: Create the bridge (no behavior change)

1. Create `src/lib/tauri-bridge.ts` with all exports, initially just re-exporting from `@tauri-apps/*` (pass-through mode)
2. Write unit tests for the bridge module itself
3. Verify existing tests still pass

### Phase 2: Swap imports one domain at a time

Migrate in this order (simpler/less risky first):

4. **Fetch** — swap 7 search tools + chat-providers (biggest win, most files)
5. **Invoke** — swap research-search, use-browser-tabs, searxng, extract-page-content
6. **File system** — swap app-file-storage
7. **Store** — swap store.ts
8. **Path + Opener** — swap research-sidebar, markdown-text
9. **Detection** — swap isTauri() in chrome-devtools-tools, use-app-update
10. **Notifications** — swap use-desktop-notifications
11. **Menu** — swap setup-menu
12. **Shell** — swap chrome-devtools-sidecar, tauri-stdio-transport
13. **Updater** — swap use-app-update

Each step: swap imports → run tests → commit.

### Phase 3: Remove old mocks

14. Delete all `__deepSearch*Mock` hooks from source files
15. Delete `isTauriRuntime()` from chat-providers.ts
16. Remove `__TAURI_INTERNALS__` mock from e2e/fixtures.ts

### Phase 4: Browser stubs

17. Add stub implementations for browser mode (when `isTauri()` is false)
18. `fetch` → `globalThis.fetch` (works in browser)
19. `invoke` → throws or returns from bridge mock
20. File system → no-op or localStorage-backed
21. Store → localStorage-backed
22. Menu, notifications, shell, updater → no-ops

### Phase 5: Fix e2e tests

23. Update `e2e/fixtures.ts` to use `window.__deepSearchBridgeMock`
24. Fix `e2e/tests/chat-mock.spec.ts` — should now pass
25. Add more chat flow tests (multi-turn, tool use, etc.)

## Risks & Considerations

- **Shell/MCP types** — `Command` and `Child` from `@tauri-apps/plugin-shell` have complex event-based APIs. The bridge should export a simplified interface rather than trying to re-export the full type. The MCP transport and sidecar are Tauri-only features and can just throw outside Tauri.
- **Menu setup** — deeply coupled to Tauri's menu builder API. The bridge should wrap the entire menu setup into a single function (`setupAppMenu()`) rather than re-exporting individual menu primitives.
- **Store** — The Tauri `Store` class has methods. The bridge should return a simple interface (`{ get, set, save }`) instead of exposing the class.
- **Currency/Disambiguate tools** — these currently mock at the tool level (not fetch level). The bridge simplifies this: just mock `fetch` and the tools work.
- **Storybook** — The bridge makes Storybook work without any `window.__deepSearch*Mock` per-component setup. Stories can set `window.__deepSearchBridgeMock` once globally.

## What This Unlocks

- **Playwright browser-only e2e** for the full chat flow — no Tauri binary needed
- **Single mock point** — one object instead of 7 scattered `__deepSearch*Mock` hooks
- **Storybook works natively** — components render without Tauri runtime
- **Future-proof** — could swap Tauri for Electron or a web-only build with zero changes to app code
- **Unit tests are simpler** — mock one module instead of 5 different `@tauri-apps/*` packages
