# Extract Page Content via Tabbed Webviews

## Summary

Add a page content extraction tool to the deep-search-app Tauri v2 application. The AI agent uses this tool to fetch and summarize web pages. The feature uses a two-strategy fallback: plain HTTP fetch first, then a visible child webview for JavaScript-rendered pages. A tabbed panel UI lets users see pages as they load.

## Architecture

Approach A: Minimal Rust surface + TypeScript-driven pipeline.

- Rust provides 4 webview lifecycle commands only
- TypeScript owns all business logic: fetch fallback, HTML cleanup, markdown conversion, LLM summarization
- React provides a tab panel UI for chat and browser panels

### Data flow

```
AI calls extract_page_content tool
  → TypeScript tries @tauri-apps/plugin-http fetch
  → if content < 200 chars: invoke('open_tab') → wait for load → invoke('extract_content') → invoke('close_tab')
  → Cheerio stripNoise() → Turndown htmlToMarkdown()
  → generateText() for summary
  → return { url, title, rawMarkdown, summary, strategy }
```

### New/modified files

| Layer | File | Purpose |
|-------|------|---------|
| Rust | `src-tauri/src/lib.rs` | Add `open_tab`, `switch_tab`, `close_tab`, `extract_content`. Remove unused `greet`. |
| Rust | `src-tauri/Cargo.toml` | Enable `"unstable"` feature on tauri. Ensure version >= 2.11.0. |
| Rust | `src-tauri/capabilities/default.json` | Add webview permissions. Broaden HTTP scope for arbitrary URL fetch. |
| TS lib | `src/lib/content-extraction.ts` | Shared extraction pipeline (stripNoise, htmlToMarkdown, extractTitle, summarize) |
| TS tool | `src/tools/extract-page-content-tool.ts` | AI SDK tool definition with fetch → webview fallback |
| TS component | `src/components/tab-panel.tsx` | Tab bar UI + panel switching (Chat / Browser tabs) |
| TS hook | `src/hooks/use-browser-tabs.tsx` | React state for open browser tabs, manages invoke() calls |
| Existing | `src/App.tsx` | Wrap content with TabPanel |
| Existing | `src/lib/transport.ts` | Register `extract_page_content` tool |
| Existing | `src/tools/index.ts` | Export the new tool |

## Rust commands

Four commands in `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
fn open_tab(app: AppHandle, url: String, id: String) -> Result<(), String>
```
- Gets main window, creates child webview with `WebviewBuilder` + `WebviewUrl::External`
- Uses `add_child()` to attach to main window
- Child webview is created hidden by default

```rust
#[tauri::command]
fn switch_tab(app: AppHandle, id: String) -> Result<(), String>
```
- Iterates all webviews, sets visible only the matching one
- `id == "main"` hides all child webviews (shows the app UI)

```rust
#[tauri::command]
fn close_tab(app: AppHandle, id: String) -> Result<(), String>
```
- Finds webview by label, closes it
- No-ops if not found

```rust
#[tauri::command]
fn extract_content(app: AppHandle, id: String, tx: tauri::ipc::Channel<String>) -> Result<(), String>
```
- Gets webview by label
- Calls `eval_with_callback("document.documentElement.innerHTML", callback)`
- Sends result through the Channel

### Cargo.toml changes

- Add `"unstable"` feature to tauri dependency for `add_child()`
- Ensure tauri version >= 2.11.0 for `eval_with_callback()`

### Capabilities changes

- Add `webview:allow-create-webview-window` permission
- Broaden HTTP scope to allow fetching arbitrary URLs for content extraction

## TypeScript content extraction

### `src/lib/content-extraction.ts`

Ported from the Mastra reference implementation:

- **`stripNoise(html: string): string`** — Uses Cheerio to remove `script,style,nav,footer,header,aside,noscript,iframe,svg`. Finds main content via ordered selectors: `article > main > [role='main'] > body`.
- **`htmlToMarkdown(html: string): string`** — TurndownService with ATX headings and fenced code blocks. Collapses excessive newlines.
- **`extractTitle(html: string): string`** — Regex on `<title>` tag.
- **`summarize(model, markdown, query?): Promise<string>`** — Calls `generateText()` with the research assistant system prompt. Focuses on the query if provided.
- **`MIN_CONTENT_LENGTH = 200`** — Minimum character count to accept a fetch result before falling back to webview.

### `src/tools/extract-page-content-tool.ts`

AI SDK `tool()` definition using Vercel AI SDK patterns matching the existing search tools.

**Input schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | `string` | yes | URL to extract content from |
| `query` | `string` | no | Focuses the summary on specific information |
| `summarize` | `boolean` | no | Default `true`. Set false to skip LLM summarization. |

**Execute flow:**

1. **Fetch strategy** — Use `@tauri-apps/plugin-http` fetch (already available, bypasses CORS). Check content-type is HTML. Extract HTML body.
2. **Process fetch result** — Run `stripNoise` then `htmlToMarkdown`. If result >= 200 chars, skip to step 4.
3. **Webview strategy** — Generate a unique tab ID (`tab-{Date.now()}`). Call `invoke('open_tab', { url, id })`. Use `extract_content` with a `document.readyState === "complete"` JS snippet to poll until the page finishes loading (with 30s timeout). Then call `extract_content` again with `document.documentElement.innerHTML` to get the full HTML. Call `invoke('close_tab', { id })`. Process with `stripNoise` + `htmlToMarkdown`.
4. **Post-process** — Extract title. Run summarization if enabled.
5. **Return** `{ url, title, rawMarkdown, summary, strategy: "fetch" | "webview" }`.

**New npm dependencies:** `cheerio`, `turndown`, `@types/turndown`

The tool is registered in `transport.ts` as `extract_page_content` alongside existing search tools.

## Tab panel UI

### Layout

A horizontal tab bar at the top of the window. "Chat" is always present. Browser tabs appear when webviews are opened.

```
[ Chat ]  [ example.com ✕ ]  [ another.com ✕ ]
─────────────────────────────────────────────────
|                                               |
|         Active panel content                  |
|                                               |
─────────────────────────────────────────────────
```

### Tab bar behavior

- "Chat" tab has no close button — permanent
- Browser tabs show the page hostname plus an ✕ to close
- Clicking a tab calls `invoke('switch_tab', { id })` to show that webview
- Clicking "Chat" calls `invoke('switch_tab', { id: 'main' })` to hide all child webviews
- ✕ calls `invoke('close_tab', { id })` and removes the tab from React state

### State management (`src/hooks/use-browser-tabs.tsx`)

- Maintains a list of `{ id: string, url: string, title: string }` for open browser tabs
- Exposes `openAndExtract(url)` — opens tab, waits for load, extracts HTML, closes tab, returns content
- Auto-removes tabs when extraction completes (tabs auto-close)
- During extraction the browser tab briefly appears so the user sees the page loading

### App.tsx changes

- Wrap `AppInner`'s return with `<TabPanel>` component
- Pass the existing `<Chat>` as the chat panel content
- `TabPanel` renders the tab bar and manages which panel is active

## Error handling

### Fetch failures

- Network errors, non-HTML content types, HTTP errors silently fall through to webview strategy
- No error shown to the user for fetch failures — it's an internal optimization

### Webview failures

- `open_tab` fails (e.g. invalid URL) — tool returns an error result with empty fields
- Page load timeout (30s) — close tab, return empty result
- `extract_content` returns empty HTML — close tab, return empty result

### Tab management

- If user switches away from a browser tab during extraction, extraction continues in the background
- Multiple parallel extractions each get a unique tab ID
- Closing a tab mid-extraction — extraction resolves with whatever was captured or errors gracefully

### Content processing

- Empty or very short markdown after cleanup — returned as-is with the strategy indicator
- Summarization failure (LLM error) — raw markdown used as both `rawMarkdown` and `summary`
