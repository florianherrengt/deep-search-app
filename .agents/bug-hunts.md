# Bug Hunt Memory

## Current status

- Last run: 2026-06-12 (run 15)
- Last inspected commit: 35a22e4 (uncommitted changes)
- Suggested next focus: extract-page-content-tool never indexes saved content to vector search; TOCTOU race in research folder creation; global sub-agent emitter race (architecture); `moveResearchChatToFolder` partial failure duplication

## Recent runs

### Run 15 — 2026-06-12 (commit 35a22e4, uncommitted changes)

**Focus areas:**
- Uncommitted changes deep scan (~50 modified files)
- `moveResearchChatToFolder` data loss (CRITICAL folder deletion bug)
- `extract-page-content-tool` save failures
- Brave/Exa search tool error handling

**Bugs fixed (4):**

1. **`moveResearchChatToFolder` deletes ENTIRE source folder — destroys all other chats**
   - Root cause: After saving chat to destination and deleting the individual chat file from source, the code deleted the entire source folder recursively (`deleteAppSubfolder`) and its search index (`deleteResearchFolderIndex`). If the source folder contained other chats, they were all destroyed.
   - Fix: Replaced destructive folder/index deletion with `removeResearchChatSummary()` — removes only the moved chat's entry from the source folder's index. Source folder and other chats are preserved.
   - Tests: Fixed 3 misleading tests that asserted the buggy folder-deletion behavior. Tests now verify only the chat file is deleted, not the folder.
   - Files: research-history.ts, research-history.test.ts, direct-transport.test.ts

2. **`currentChatId` never cleared in transport cleanup — cross-chat event routing**
   - Root cause: `setActiveSubAgentEmitter(null, null)` in the `finally` block passes only 2 args; `chatId` parameter is `undefined`, so `currentChatId` is never cleared. After a transport completes, stale `currentChatId` causes sub-agent events from fire-and-forget operations (e.g., memory extraction) to route to the wrong chat's handler.
   - Fix: Changed to `setActiveSubAgentEmitter(null, null, null)` — explicitly passes `null` to clear `currentChatId`.
   - Files: transport/index.ts

3. **`extract-page-content-tool` save failures silently eaten — content never persisted**
   - Root cause: Both `saveExtractedContent` and `saveSummaryContent` errors are caught and logged to `console.error` only. The tool returns extracted content as if saving succeeded. The user and AI agent have no indication that persistence failed. Future retrieval queries won't find the content.
   - Fix: Added `saveFailed` flag. When save fails, appends `[Warning: Failed to save this content to the research folder...]` to the returned content so the AI agent knows and can inform the user.
   - Files: extract-page-content-tool.ts

4. **`create-search-tool.ts` discards Zod error details — generic error hides root cause**
   - Root cause: When `throwOnParseError` is true and Zod validation fails, the error thrown is `"X search response did not match the expected format."` — no field names, expected types, or actual values. Makes debugging API contract mismatches nearly impossible.
   - Fix: Included `result.error.message` in the thrown error string.
   - Tests: Updated 2 tests (tavily, serper) to match new error format.
   - Files: create-search-tool.ts, tavily-search-tool.test.ts, serper-search-tool.test.ts

**Verification:** 829/829 tests pass (61 files)

**Investigated but not fixed:**
- **extract-page-content-tool never indexes to vector search**: Even when saved, files go to `raw/{domain}/` which `reindex_folder` and `backfill_index` never scan. No `indexResearchFile` call after saving. Fix requires passing `embeddingConfig` to the tool and calling indexing after write.
- **Tests that pass while product is broken**: 3 tests asserted the destructive folder-deletion behavior. Fixed in this run.

### Run 14 — 2026-06-12 (commit 35a22e4, uncommitted changes)
Focus: Shopify extractor type safety, guarded-stream abort handling, sub-agent store stub runs
Bugs fixed: 3

### Run 13 — 2026-06-12 (commit 35a22e4)
Focus: Sub-agent store events, persistence, retrieval agent tools, research plan tool, research history
Bugs fixed: 6

## Recurring patterns

- Module-level singletons create cross-chat routing risks — always scope by chatId
- `as` type casts without runtime validation accept corrupt data silently — external API data MUST be validated
- `.catch(() => {})` silently converts rejection to fulfillment — hide failures (fixed 4+ instances)
- Read-modify-write without serialization loses data under concurrency
- Event ordering cannot be assumed — create stubs for out-of-order arrivals
- LLM tools that silently return empty data degrade research quality invisibly
- `Math.min(...array)` / `Math.max(...array)` produce NaN/Infinity from malformed data — guard inputs
- `.filter(Boolean)` does NOT filter non-string values from `string[]` — use type-narrowing filter
- Abort error handling must not require specific error types — any error during abort should be swallowed
- Tests asserting destructive/buggy behavior are dangerous — they prevent fixing the bug later
- Error messages that discard diagnostic details (Zod errors, API responses) make debugging impossible
- `undefined` vs `null` in optional params matters for `if (x !== undefined)` guards

## Recently inspected areas

- **moveResearchChatToFolder:** 2026-06-12 run 15, HIGH confidence. Fixed destructive folder deletion; now only removes individual chat file and index entry.
- **currentChatId cleanup:** 2026-06-12 run 15, HIGH confidence. Now cleared in transport `finally` block.
- **extract-page-content-tool save errors:** 2026-06-12 run 15, HIGH confidence. Warning now surfaced in tool output.
- **create-search-tool error details:** 2026-06-12 run 15, HIGH confidence. Zod error message now included.
- **Brave/Exa search tools:** 2026-06-12 run 15, MEDIUM confidence. No crash bugs found. Error handling could be richer but is functional.
- **TOCTOU in research folder creation:** 2026-06-12 run 14, MEDIUM confidence. Race confirmed real but only exploitable under concurrent sessions.
- **Global sub-agent emitter race:** 2026-06-12 run 14, MEDIUM confidence. Race confirmed real. Architecture change needed.

## Open risks

### HIGH priority

- **extract-page-content-tool never indexes saved content** — `src/tools/extract-page-content-tool.ts`, `src/lib/transport/tool-registry.ts:65`
  - No `indexResearchFile` call after saving; `embeddingConfig` not passed to tool
  - Files saved to `raw/{domain}/` which `reindex_folder`/`backfill_index` never scan
  - Even when save succeeds, retrieval agent can never find extracted content
  - Fix: pass `embeddingConfig` to tool, call `indexResearchFile` after write, or save files at folder root level

- **Global sub-agent emitter race** — `src/lib/sub-agent-emitter.ts:5-8`
  - `currentEmitter` module-level singleton overwritten by concurrent sessions
  - Partially mitigated by `directHandlers` Map but `currentEmitter` still at risk
  - Impact: sub-agent events appear in wrong chat panel

- **TOCTOU race in research folder creation** — `src/lib/transport/research-folder.ts:66-70`
  - Read (list existing) and write (mkdir) are separate async ops spanning seconds
  - Concurrent calls can produce duplicate folder names

- **No re-entry guard on `DirectTransport.sendMessages()`** — `src/lib/transport/index.ts:92-203`
  - Two concurrent calls can create duplicate folders, corrupt sub-agent event routing

- **`moveResearchChatToFolder` partial failure duplication** — `src/lib/research-history.ts`
  - Save to destination succeeds but source chat file deletion fails → duplicated data
  - No rollback mechanism; `.catch()` swallows errors silently

### MEDIUM priority

- **DNS resolution has no timeout** — `src-tauri/src/lib.rs:211-221`
- **Webview HTML extraction has no size guard** — `src-tauri/src/lib.rs:111-121`
- **Windows reserved filenames pass validation** — `src/lib/transport/research-folder.ts:5`
- **Memory extraction failures invisible to user** — `src/lib/transport/index.ts:149`
- **`stripMarkdownJsonFence` fails on nested backticks** — `src/lib/memory-agent.ts:48-52`
- **Guard retry pollutes `isResearchLikeRequest`** — `src/lib/agent-guards.ts:457-461`

### LOW priority

- **`processedMemoryMessageIds` Set grows unboundedly** — `src/lib/transport/index.ts:39`
- **`resolveUniqueFolderNameFromExisting` uses `.parse()` not `.safeParse()`** — latent crash risk
- **Deterministic fallback hardcodes sub-agent ID format** — `src/lib/transport/folder-namer.ts:113-130`
- **Dead `ModelSelectorContext`** — `src/components/assistant-ui/model-selector.tsx:21-48`
- **`SafePathSegmentSchema.parse` in subAgentsFilePath can throw synchronously** — `src/lib/sub-agent-persistence.ts:15-16`
- **`extractFirstJsonObject` fails on braces inside JSON strings** — `src/lib/retrieval-agent.ts:210-222`
- **Exa search tool defines own schema instead of reusing `searchResultSchema`** — `src/tools/exa-search-tool.ts:8-16`
- **`embedding_dimensions: 0` passes through `??` but was blocked by `||`** — `src/lib/settings-store.ts:132`
