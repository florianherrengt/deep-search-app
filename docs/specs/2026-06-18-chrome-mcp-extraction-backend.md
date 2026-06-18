# Chrome MCP Web Extraction Backend

## Summary

Add Chrome MCP as an optional backend for web content extraction, replacing the Tauri webview `renderHtml` path when enabled. The `PageLoader` interface in `@deep-search/search-extract` is the injection point — Chrome MCP becomes a drop-in `renderHtml` implementation.

## Settings

Add `web_extraction_backend` to `settingsSchema`:

```ts
web_extraction_backend: z.enum(["tauri-webview", "chrome-mcp"]).default("tauri-webview")
```

No fallback toggle. If `chrome-mcp` is selected and MCP is unavailable, the error is surfaced.

## Architecture

```
Settings.web_extraction_backend
  → App.tsx → searchKeys
    → createTools → createExtractPageContentTool(config)
      → getEngine(config) picks PageLoader:
        "tauri-webview" → existing TauriPageLoader (default, unchanged)
        "chrome-mcp"    → ChromeMcpPageLoader (new)
          → reuses shared MCP client from chrome-devtools-tools.ts
          → navigate_page → evaluate_script(outerHTML) → return HTML
      → SearchExtractEngine.extract() (unchanged)
```

## New Files

| File | Purpose |
|------|---------|
| `src/tools/chrome-mcp-page-loader.ts` | Implements `renderHtml` via Chrome MCP tools |
| `src/tools/__tests__/chrome-mcp-page-loader.test.ts` | Unit tests |

## Modified Files

| File | Change |
|------|--------|
| `src/lib/settings-store.ts` | Add `web_extraction_backend` field |
| `src/lib/transport/tool-registry.ts` | Add to `SearchToolKeys`, pass to tool factory |
| `src/lib/mcp/chrome-devtools-tools.ts` | Export `getChromeDevToolsMcpClient` |
| `src/tools/extraction-page-loader.ts` | Re-export from new module |
| `src/tools/extract-page-content-tool.ts` | Accept config, create engine with correct PageLoader |
| `src/tools/__tests__/extract-page-content-tool.test.ts` | Add Chrome MCP path tests |
| `src/components/settings-fields.tsx` | Add extraction backend Select (disabled unless MCP on) |
| `src/App.tsx` | Pass `web_extraction_backend` through `searchKeys` |

## Error Behavior

| Scenario | Result |
|----------|--------|
| Backend = `tauri-webview` | Existing behavior |
| Backend = `chrome-mcp`, MCP connected | Extract via Chrome |
| Backend = `chrome-mcp`, MCP not connected | Error surfaced to user |
| Backend = `chrome-mcp`, navigate/evaluate fails | Error with MCP failure message |

## UI

In Chrome DevTools MCP settings section:
- `Select` for extraction backend, disabled (greyed out, "Tauri webview") when MCP is off
- When MCP is enabled, dropdown shows "Tauri webview" / "Chrome MCP"

## Tests

- Default Tauri extraction path works unchanged
- Chrome MCP path calls correct MCP tools, returns HTML
- MCP unavailable → error surfaced
- Both backends produce same `ExtractResult` shape

## Non-goals

- Do not change the `@deep-search/search-extract` package
- Do not change the `fetchHtml` (HTTP fetch) path
- Do not change the extraction result format
- Do not add a fallback toggle
