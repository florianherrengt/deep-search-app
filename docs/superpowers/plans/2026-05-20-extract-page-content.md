# Extract Page Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add page content extraction to the Tauri app using tabbed child webviews with a fetch-first fallback strategy.

**Architecture:** Rust provides 4 webview lifecycle commands (`open_tab`, `switch_tab`, `close_tab`, `extract_content`). TypeScript owns all business logic: fetch fallback via `@tauri-apps/plugin-http`, Cheerio HTML cleanup, Turndown markdown conversion, LLM summarization. A tab panel UI shows chat and browser tabs.

**Tech Stack:** Tauri v2.11+ (with `unstable` feature), React 18, Vercel AI SDK, Cheerio, Turndown, Vitest

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Install npm packages**

```bash
cd ~/projects/deep-search-app && npm install cheerio turndown && npm install -D @types/turndown vitest
```

- [ ] **Step 2: Add test script to package.json**

Add to the `"scripts"` section:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Update Cargo.toml**

Replace the tauri dependency line in `src-tauri/Cargo.toml`:

```toml
tauri = { version = "2", features = ["unstable"] }
```

This enables `Window::add_child()`, `WebviewBuilder`, and `auto_resize()`.

- [ ] **Step 4: Verify Rust builds**

```bash
cd ~/projects/deep-search-app/src-tauri && cargo check
```

Expected: compiles with no errors (the `unstable` feature should be recognized)

- [ ] **Step 5: Commit**

```bash
cd ~/projects/deep-search-app && git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock && git commit -m "chore: add cheerio, turndown, vitest deps; enable tauri unstable feature"
```

---

### Task 2: Rust webview commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Replace lib.rs with webview commands**

Replace the entire contents of `src-tauri/src/lib.rs` with:

```rust
use std::sync::mpsc;
use std::time::Duration;

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl,
};

const TAB_BAR_HEIGHT: f64 = 40.0;
const PAGE_LOAD_TIMEOUT_SECS: u64 = 30;
const EVAL_RECV_TIMEOUT_SECS: u64 = 5;

#[tauri::command]
async fn open_tab(app: AppHandle, url: String, id: String) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or("no main window")?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let physical = window.inner_size().map_err(|e| e.to_string())?;
    let logical = physical.to_logical::<f64>(scale);

    let wv = WebviewBuilder::new(
        &id,
        WebviewUrl::External(url.parse().map_err(|e| e.to_string())?),
    );

    window
        .add_child(
            wv,
            LogicalPosition::new(0.0, TAB_BAR_HEIGHT),
            LogicalSize::new(logical.width, logical.height - TAB_BAR_HEIGHT),
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn switch_tab(app: AppHandle, id: String) -> Result<(), String> {
    for wv in app.webviews() {
        let _ = wv.set_visible(wv.label() == id);
    }
    Ok(())
}

#[tauri::command]
fn close_tab(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn extract_content(app: AppHandle, id: String) -> Result<String, String> {
    let wv = app.get_webview(&id).ok_or("webview not found")?;

    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(PAGE_LOAD_TIMEOUT_SECS);
    loop {
        let (tx, rx) = mpsc::channel::<String>();
        match wv.eval_with_callback(
            "(function(){return document.readyState})()",
            move |result| {
                let _ = tx.send(result);
            },
        ) {
            Ok(_) => {
                if let Ok(ready) = rx.recv_timeout(Duration::from_secs(EVAL_RECV_TIMEOUT_SECS)) {
                    if ready.contains("complete") {
                        break;
                    }
                }
            }
            Err(_) => {}
        }
        if start.elapsed() > timeout {
            return Err("page load timeout".to_string());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    tokio::time::sleep(Duration::from_secs(2)).await;

    let (tx, rx) = mpsc::channel::<String>();
    wv.eval_with_callback(
        "document.documentElement.innerHTML",
        move |result| {
            let _ = tx.send(result);
        },
    )
    .map_err(|e| e.to_string())?;

    rx.recv_timeout(Duration::from_secs(EVAL_RECV_TIMEOUT_SECS))
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            open_tab,
            switch_tab,
            close_tab,
            extract_content,
        ]);

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_webdriver::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Key details:
- `open_tab` uses `app.get_window("main")` (not `get_webview_window`) because `add_child` is on `Window`, not `WebviewWindow`
- `extract_content` polls `document.readyState` until `"complete"`, waits 2 extra seconds for JS rendering, then extracts `innerHTML`
- Uses `mpsc::channel` to receive `eval_with_callback` results synchronously within the async command
- The `greet` command is removed (it was never called)

- [ ] **Step 2: Verify it compiles**

```bash
cd ~/projects/deep-search-app/src-tauri && cargo check
```

Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
cd ~/projects/deep-search-app && git add src-tauri/src/lib.rs && git commit -m "feat: add webview lifecycle commands for tabbed browsing"
```

---

### Task 3: Update capabilities

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add permissions**

Replace the entire contents of `src-tauri/capabilities/default.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "store:default",
    "core:menu:default",
    "core:webview:allow-create-webview",
    "core:webview:allow-webview-hide",
    "core:webview:allow-webview-show",
    "core:webview:allow-set-webview-position",
    "core:webview:allow-set-webview-size",
    "core:window:allow-create",
    "core:window:default",
    "fs:default",
    "fs:allow-write-text-file",
    "fs:scope-appdata-recursive",
    {
      "identifier": "http:default",
      "allow": [
        { "url": "https://**" },
        { "url": "http://**" }
      ]
    }
  ]
}
```

Changes:
- Added `core:webview:allow-create-webview`, `core:webview:allow-webview-hide`, `core:webview:allow-webview-show`, `core:webview:allow-set-webview-position`, `core:webview:allow-set-webview-size` for frontend webview control
- Added `core:window:allow-create`, `core:window:default` for window management
- Broadened HTTP scope from specific API domains to `https://**` and `http://**` to allow fetching arbitrary URLs for content extraction

- [ ] **Step 2: Commit**

```bash
cd ~/projects/deep-search-app && git add src-tauri/capabilities/default.json && git commit -m "feat: add webview permissions and broaden HTTP scope for content extraction"
```

---

### Task 4: Content extraction library (TDD)

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/content-extraction.ts`
- Create: `src/lib/__tests__/content-extraction.test.ts`

- [ ] **Step 1: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/__tests__/content-extraction.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  stripNoise,
  htmlToMarkdown,
  extractTitle,
} from "@/lib/content-extraction";

describe("extractTitle", () => {
  it("extracts title from HTML", () => {
    const html =
      "<html><head><title>Test Page</title></head><body></body></html>";
    expect(extractTitle(html)).toBe("Test Page");
  });

  it("returns empty string when no title tag exists", () => {
    const html = "<html><body></body></html>";
    expect(extractTitle(html)).toBe("");
  });

  it("handles whitespace in title", () => {
    const html =
      "<html><head><title>  Spaced Title  </title></head><body></body></html>";
    expect(extractTitle(html)).toBe("Spaced Title");
  });
});

describe("stripNoise", () => {
  it("removes script tags", () => {
    const html =
      "<body><script>alert(1)</script><p>Content</p></body>";
    const result = stripNoise(html);
    expect(result).not.toContain("<script>");
    expect(result).toContain("Content");
  });

  it("removes style tags", () => {
    const html =
      "<body><style>body{}</style><p>Content</p></body>";
    const result = stripNoise(html);
    expect(result).not.toContain("<style>");
    expect(result).toContain("Content");
  });

  it("removes nav, footer, header, aside, noscript, iframe, svg", () => {
    const html =
      "<body><nav>nav</nav><header>hdr</header><aside>side</aside><footer>ftr</footer><noscript>ns</noscript><iframe>if</iframe><svg>s</svg><p>Content</p></body>";
    const result = stripNoise(html);
    expect(result).toContain("Content");
    expect(result).not.toContain("<nav>");
    expect(result).not.toContain("<footer>");
    expect(result).not.toContain("<header>");
    expect(result).not.toContain("<aside>");
  });

  it("extracts article content when article exists", () => {
    const html =
      "<body><nav>Nav</nav><article><p>Article content</p></article></body>";
    const result = stripNoise(html);
    expect(result).toContain("Article content");
    expect(result).not.toContain("Nav");
  });

  it("falls back to main when no article", () => {
    const html =
      "<body><nav>Nav</nav><main><p>Main content</p></main></body>";
    const result = stripNoise(html);
    expect(result).toContain("Main content");
    expect(result).not.toContain("Nav");
  });

  it("falls back to body when no article or main", () => {
    const html =
      "<body><nav>Nav</nav><div><p>Body content</p></div></body>";
    const result = stripNoise(html);
    expect(result).toContain("Body content");
  });
});

describe("htmlToMarkdown", () => {
  it("converts h1 to markdown heading", () => {
    const html = "<h1>Title</h1>";
    expect(htmlToMarkdown(html)).toContain("# Title");
  });

  it("converts h2 to markdown heading", () => {
    const html = "<h2>Subtitle</h2>";
    expect(htmlToMarkdown(html)).toContain("## Subtitle");
  });

  it("converts links", () => {
    const html = '<a href="https://example.com">Link</a>';
    expect(htmlToMarkdown(html)).toContain("[Link](https://example.com)");
  });

  it("converts paragraphs", () => {
    const html = "<p>First</p><p>Second</p>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("First");
    expect(md).toContain("Second");
  });

  it("converts code blocks", () => {
    const html = "<pre><code>const x = 1;</code></pre>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("const x = 1;");
  });

  it("collapses excessive newlines", () => {
    const html = "<p>A</p><p>B</p>";
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("\n\n\n");
  });

  it("trims output", () => {
    const html = "<p>Content</p>";
    const md = htmlToMarkdown(html);
    expect(md).toBe(md.trim());
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd ~/projects/deep-search-app && npx vitest run src/lib/__tests__/content-extraction.test.ts
```

Expected: FAIL — module `@/lib/content-extraction` not found

- [ ] **Step 4: Implement content-extraction.ts**

Create `src/lib/content-extraction.ts`:

```typescript
import * as cheerio from "cheerio";
import TurndownService from "turndown";

const NOISE =
  "script,style,nav,footer,header,aside,noscript,iframe,svg";
const MAIN_SELECTORS = ["article", "main", "[role='main']", "body"];

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim() ?? "";
}

export function stripNoise(html: string): string {
  const $ = cheerio.load(html);
  $(NOISE).remove();
  for (const sel of MAIN_SELECTORS) {
    const el = $(sel);
    if (el.length) return el.first().html() ?? "";
  }
  return html;
}

export function htmlToMarkdown(html: string): string {
  return turndown
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd ~/projects/deep-search-app && npx vitest run src/lib/__tests__/content-extraction.test.ts
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd ~/projects/deep-search-app && git add vitest.config.ts src/lib/content-extraction.ts src/lib/__tests__/content-extraction.test.ts && git commit -m "feat: add content extraction library with cheerio and turndown"
```

---

### Task 5: Extract page content tool

**Files:**
- Create: `src/tools/extract-page-content-tool.ts`
- Modify: `src/lib/transport.ts`
- Modify: `src/tools/index.ts`

- [ ] **Step 1: Create the tool**

Create `src/tools/extract-page-content-tool.ts`:

```typescript
import { tool, zodSchema, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { fetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import {
  stripNoise,
  htmlToMarkdown,
  extractTitle,
} from "@/lib/content-extraction";

const MIN_CONTENT_LENGTH = 200;
const FETCH_TIMEOUT_MS = 10_000;

const ExtractResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  content: z.string(),
  strategy: z.enum(["fetch", "webview"]),
});

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (response.status >= 400) return null;
    const ct = response.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml"))
      return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function summarizeContent(
  model: LanguageModel,
  markdown: string,
  query?: string,
): Promise<string> {
  if (!markdown.trim()) return "";
  const { text } = await generateText({
    model,
    system:
      "You are a research assistant. Extract and summarize the key information from this page content. Be concise but thorough. Preserve factual details, names, dates, and numbers.",
    prompt: `${markdown}${query ? `\n\nFocus on information related to: ${query}` : ""}`,
  });
  return text;
}

function processHtml(html: string): string {
  return htmlToMarkdown(stripNoise(html));
}

async function extractViaWebview(url: string): Promise<string | null> {
  const id = `tab-${Date.now()}`;
  try {
    await invoke("open_tab", { url, id });
    const html: string = await invoke("extract_content", { id });
    return html;
  } catch {
    return null;
  } finally {
    try {
      await invoke("close_tab", { id });
    } catch {}
  }
}

export function createExtractPageContentTool(model: LanguageModel) {
  return tool({
    description:
      "Extract and summarize the text content of a web page. Use this to read the full content of a URL found during research.",
    strict: true,
    inputSchema: zodSchema(
      z.object({
        url: z.string().url().describe("URL to extract content from"),
        query: z
          .string()
          .optional()
          .describe("What to look for on the page (focuses the summary)"),
        summarize: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Summarize the content before returning it. Set to false if you need the full page information.",
          ),
      }),
    ),
    outputSchema: zodSchema(ExtractResultSchema),
    execute: async ({ url, query, summarize: doSummarize }) => {
      let html = await fetchHtml(url);
      let strategy: "fetch" | "webview" = "fetch";

      let markdown = html ? processHtml(html) : "";

      if (markdown.length < MIN_CONTENT_LENGTH) {
        html = await extractViaWebview(url);
        strategy = "webview";
        markdown = html ? processHtml(html) : "";
      }

      const title = html ? extractTitle(html) : "";
      let content = markdown;

      if (doSummarize !== false && markdown.trim()) {
        try {
          content = await summarizeContent(model, markdown, query);
        } catch {}
      }

      return { url, title, content, strategy };
    },
  });
}
```

Key design points:
- Factory function `createExtractPageContentTool(model)` takes the LLM model for summarization
- Fetch-first strategy using `@tauri-apps/plugin-http`
- Falls back to webview extraction when fetch content is insufficient (< 200 chars)
- Webview extraction: open tab → wait for load + extract → close tab
- Cheerio/Turndown processing reused from `content-extraction.ts`
- Summarization via `generateText()` with the same prompt as the Mastra reference

- [ ] **Step 2: Register the tool in transport.ts**

In `src/lib/transport.ts`, add the import at the top:

```typescript
import { createExtractPageContentTool } from "@/tools/extract-page-content-tool";
```

Inside the `sendMessages` method, right before the `const result = streamText({` line, add:

```typescript
const extractModel = openrouter(this.getModel());
```

And in the `tools` object, add:

```typescript
extract_page_content: createExtractPageContentTool(extractModel),
```

- [ ] **Step 3: Export from tools/index.ts**

Add to `src/tools/index.ts`:

```typescript
export { createExtractPageContentTool } from "./extract-page-content-tool";
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd ~/projects/deep-search-app && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
cd ~/projects/deep-search-app && git add src/tools/extract-page-content-tool.ts src/tools/index.ts src/lib/transport.ts && git commit -m "feat: add extract-page-content tool with fetch+webview fallback"
```

---

### Task 6: Browser tabs hook

**Files:**
- Create: `src/hooks/use-browser-tabs.tsx`

- [ ] **Step 1: Create the hook**

Create `src/hooks/use-browser-tabs.tsx`:

```typescript
import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

export function useBrowserTabs() {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("main");
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const addTab = useCallback(
    (tab: BrowserTab) => {
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    },
    [],
  );

  const removeTab = useCallback(
    (id: string) => {
      setTabs((prev) => prev.filter((t) => t.id !== id));
      if (activeTabId === id) {
        setActiveTabId("main");
        invoke("switch_tab", { id: "main" }).catch(() => {});
      }
    },
    [activeTabId],
  );

  const switchToTab = useCallback((id: string) => {
    setActiveTabId(id);
    invoke("switch_tab", { id }).catch(() => {});
  }, []);

  const openAndExtract = useCallback(
    async (url: string): Promise<string> => {
      const id = `tab-${Date.now()}`;
      const hostname = (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return url;
        }
      })();

      addTab({ id, url, title: hostname });
      await invoke("switch_tab", { id });

      let html = "";
      try {
        html = await invoke<string>("extract_content", { id });
      } catch {}

      removeTab(id);
      return html;
    },
    [addTab, removeTab],
  );

  const closeTab = useCallback(
    (id: string) => {
      invoke("close_tab", { id }).catch(() => {});
      removeTab(id);
    },
    [removeTab],
  );

  return {
    tabs,
    activeTabId,
    switchToTab,
    closeTab,
    openAndExtract,
  };
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/projects/deep-search-app && git add src/hooks/use-browser-tabs.tsx && git commit -m "feat: add useBrowserTabs hook for webview tab management"
```

---

### Task 7: Tab panel component

**Files:**
- Create: `src/components/tab-panel.tsx`

- [ ] **Step 1: Create the TabPanel component**

Create `src/components/tab-panel.tsx`:

```typescript
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { BrowserTab } from "@/hooks/use-browser-tabs";

const TAB_BAR_HEIGHT = 40;

interface TabPanelProps {
  chatPanel: ReactNode;
  tabs: BrowserTab[];
  activeTabId: string;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabPanel({
  chatPanel,
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
}: TabPanelProps) {
  return (
    <div className="h-screen flex flex-col">
      <div
        className="flex items-center gap-1 border-b bg-background px-2"
        style={{ height: TAB_BAR_HEIGHT }}
      >
        <Button
          variant={activeTabId === "main" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={() => onSwitchTab("main")}
        >
          Chat
        </Button>
        {tabs.map((tab) => (
          <div key={tab.id} className="flex items-center">
            <Button
              variant={activeTabId === tab.id ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs gap-1"
              onClick={() => onSwitchTab(tab.id)}
            >
              <span className="max-w-[120px] truncate">{tab.title}</span>
              <span
                className="ml-1 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                ✕
              </span>
            </Button>
          </div>
        ))}
      </div>
      <div className="flex-1 relative">{chatPanel}</div>
    </div>
  );
}
```

The tab bar is 40px tall (matching `TAB_BAR_HEIGHT` in Rust). Child webviews are positioned below it by the `open_tab` command. When a browser tab is active, the child webview covers this content area. When Chat is active, webviews are hidden and the React chat content is visible.

- [ ] **Step 2: Commit**

```bash
cd ~/projects/deep-search-app && git add src/components/tab-panel.tsx && git commit -m "feat: add TabPanel component for chat/browser tab switching"
```

---

### Task 8: Integration

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/lib/transport.ts` (add `invoke` import to extract tool — already done in Task 5)

- [ ] **Step 1: Update App.tsx to use TabPanel**

Replace the contents of `src/App.tsx` with:

```typescript
import { useState, useEffect } from "react";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { setupMenu } from "@/lib/setup-menu";
import {
  setBraveApiKey,
  setExaApiKey,
  setSerperApiKey,
  setTavilyApiKey,
  setSearXNGBaseUrl,
} from "@/lib/transport";
import { Chat } from "@/components/chat";
import { SettingsDialog } from "@/components/settings-dialog";
import { TabPanel } from "@/components/tab-panel";
import { useBrowserTabs } from "@/hooks/use-browser-tabs";

declare global {
  interface Window {
    __mockQuestions?: boolean;
    __logs?: Array<Record<string, unknown>>;
  }
}

function AppInner() {
  const { settings, loading } = useSettings();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { tabs, activeTabId, switchToTab, closeTab } = useBrowserTabs();

  useEffect(() => {
    setupMenu(() => setDialogOpen(true));
  }, []);

  useEffect(() => {
    if (settings.brave_api_key) setBraveApiKey(settings.brave_api_key);
    if (settings.exa_api_key) setExaApiKey(settings.exa_api_key);
    if (settings.serper_api_key) setSerperApiKey(settings.serper_api_key);
    if (settings.tavily_api_key) setTavilyApiKey(settings.tavily_api_key);
    if (settings.searxng_url) setSearXNGBaseUrl(settings.searxng_url);
  }, [settings]);

  if (loading) return null;

  if (!settings.openrouter_api_key) {
    return (
      <>
        <main className="flex flex-col items-center justify-center pt-[10vh] text-center">
          <h1 className="text-2xl font-bold">Deep Search</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Press{" "}
            <kbd className="rounded border px-1.5 py-0.5 text-xs">
              Cmd+,
            </kbd>{" "}
            to open settings and add your OpenRouter API key.
          </p>
        </main>
        <SettingsDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    );
  }

  return (
    <TabPanel
      chatPanel={
        <Chat
          apiKey={settings.openrouter_api_key}
          defaultModel={settings.default_model}
        />
      }
      tabs={tabs}
      activeTabId={activeTabId}
      onSwitchTab={switchToTab}
      onCloseTab={closeTab}
    />
  );
}

function App() {
  return (
    <SettingsProvider>
      <AppInner />
    </SettingsProvider>
  );
}

export default App;
```

Changes from the original:
- Imports `TabPanel` and `useBrowserTabs`
- Wraps the main content in `<TabPanel>` with the chat as the chat panel
- Passes browser tab state and handlers to TabPanel
- The no-API-key screen remains unchanged (no tab bar needed)

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd ~/projects/deep-search-app && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd ~/projects/deep-search-app && git add src/App.tsx && git commit -m "feat: integrate TabPanel into App with browser tab state"
```

---

### Task 9: Build and verify

- [ ] **Step 1: Run TypeScript check**

```bash
cd ~/projects/deep-search-app && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 2: Run unit tests**

```bash
cd ~/projects/deep-search-app && npx vitest run
```

Expected: all tests pass

- [ ] **Step 3: Build the Tauri app**

```bash
cd ~/projects/deep-search-app && npm run build
```

Then:

```bash
cd ~/projects/deep-search-app/src-tauri && cargo build
```

Expected: both compile successfully

- [ ] **Step 4: Run the dev app and smoke-test**

```bash
cd ~/projects/deep-search-app && npm run tauri dev
```

Manually verify:
1. App opens with a "Chat" tab visible at the top
2. Chat functionality works as before
3. Ask the AI a research question that requires reading a web page
4. The AI should call `extract_page_content` — a browser tab briefly appears, content is extracted, tab auto-closes
5. Settings dialog still opens with Cmd+,

- [ ] **Step 5: Final commit**

```bash
cd ~/projects/deep-search-app && git add -A && git commit -m "feat: complete page content extraction via tabbed webviews"
```
