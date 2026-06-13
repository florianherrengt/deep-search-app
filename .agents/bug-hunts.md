# Bug Hunt Memory

## Current status

- Last run: 2026-06-13 (run 16)
- Last inspected commit: eefad69 (+ uncommitted fixes)
- Suggested next focus: extract-page-content-tool never indexes to vector search; TOCTOU race in research folder creation; global sub-agent emitter singleton race; rebuildResearchChatIndex bypasses serializedIndexWrite queue

## Recent runs

### Run 16 — 2026-06-13 (commit eefad69, uncommitted fixes)

**Focus areas:**
- Sub-agent emitter per-chat routing (commits d6307d9, c917787) — correctness audit
- research-history.ts partial failure paths (moveResearchChatToFolder, renameResearchFolder, deleteResearchFolder)
- sub-agent-store.tsx state management (184 lines changed recently)
- retrieval-agent.ts changes (102 lines changed recently)

**Bugs fixed (4):**

1. **`getEventFingerprint` crash on malformed `tool-call` event**
   - Root cause: `event.toolCall.toolCallId` throws `TypeError` when `toolCall` is `undefined`/`null`. Consumer at `chat.tsx:320` casts runtime JSON data without validation (`dataPart.data as unknown as SubAgentEvent`).
   - Fix: Added defensive guard `if (!tc || typeof tc !== "object") return null;` in the `tool-call` case of `getEventFingerprint`. Returns `null` (no fingerprint = process without dedup) instead of crashing.
   - Tests: Added 2 regression tests (undefined toolCall, null toolCall).
   - Files: sub-agent-store.tsx, sub-agent-store.test.tsx

2. **`moveResearchChatToFolder` silently duplicates data when source deletion fails**
   - Root cause: `.catch()` on source file deletion swallowed errors. After saving to destination, if source deletion failed, data existed in both locations but caller saw success.
   - Fix: Removed `.catch()` on source deletion. On failure, attempts to delete the destination file (rollback), then throws with diagnostic message. Index cleanup still uses `.catch()` (non-critical, recoverable via rebuild).
   - Tests: Added regression test verifying throw and destination rollback.
   - Files: research-history.ts, research-history.test.ts

3. **`renameResearchFolder` leaves inconsistent state when index rename fails after FS rename**
   - Root cause: Two sequential operations (filesystem rename, then index rename) with no rollback. If index rename failed, folder had new name on disk but search index referenced old name.
   - Fix: On index rename failure, attempts to rename folder back to original name. If rollback also fails, logs both errors. Always throws so caller knows the operation failed.
   - Tests: Added regression test verifying rollback.
   - Files: research-history.ts, research-history.test.ts

4. **`deleteResearchFolder` leaves orphaned search index entries when index deletion fails**
   - Root cause: Folder deleted from disk, then index deletion attempted. If index deletion failed, folder gone but search index entries remained (returning results for non-existent files).
   - Fix: Wrapped index deletion in try/catch. Logs diagnostic on failure. Throws so caller knows the operation didn't complete cleanly.
   - Tests: Added regression test verifying throw after folder deletion.
   - Files: research-history.ts, research-history.test.ts

**Verification:** 850/850 tests pass (61 files)

**Investigated but not fixed:**
- Sub-agent emitter: directHandlers cleanup works correctly; arg count correct at all call sites; `currentEmitter` singleton still a cross-chat risk (known, architecture-level)
- Sub-agent store: setState after unmount in `loadRunsFromDisk` (MEDIUM, React 18 no-op); text-delta fingerprint includes delta content (LOW, dedup tradeoff — duplicate deltas extremely rare in practice)
- Retrieval agent: no timeout on `streamText` (design choice, abortSignal is the escape hatch); all error paths return identical empty result (design choice, caller can't distinguish failure from no-results); `list_files` returns array not string (LOW, AI SDK handles serialization); `onChunk` errors caught by outer try/catch (not a separate bug)

### Run 15 — 2026-06-12 (commit 35a22e4)
Focus: Uncommitted changes, moveResearchChatToFolder data loss, extract-page-content-tool, search tool error handling
Bugs fixed: 4 (folder deletion bug, currentChatId cleanup, extract-page-content save warnings, Zod error details)

### Run 14 — 2026-06-12 (commit 35a22e4)
Focus: Shopify extractor, guarded-stream abort, sub-agent store stub runs
Bugs fixed: 3

## Recurring patterns

- Module-level singletons create cross-chat routing risks — always scope by chatId
- `as` type casts without runtime validation accept corrupt data silently — external API data MUST be validated
- `.catch(() => {})` silently converts rejection to fulfillment — hide failures (fixed 5+ instances across runs)
- Read-modify-write without serialization loses data under concurrency
- Event ordering cannot be assumed — create stubs for out-of-order arrivals
- LLM tools that silently return empty data degrade research quality invisibly
- Tests asserting destructive/buggy behavior prevent fixing the bug later
- Error messages that discard diagnostic details (Zod errors, API responses) make debugging impossible
- Sequential async operations without rollback leave inconsistent state (renameResearchFolder, deleteResearchFolder)
- Fingerprinting without unique event identifiers forces tradeoffs (text-delta dedup)

## Recently inspected areas

- **Sub-agent emitter routing:** 2026-06-13 run 16, HIGH confidence. directHandlers Map cleanup correct; currentEmitter singleton still a known cross-chat risk.
- **moveResearchChatToFolder:** 2026-06-13 run 16, HIGH confidence. Now throws on source deletion failure with destination rollback.
- **renameResearchFolder:** 2026-06-13 run 16, HIGH confidence. Now rolls back filesystem rename on index rename failure.
- **deleteResearchFolder:** 2026-06-13 run 16, HIGH confidence. Now throws on index deletion failure.
- **sub-agent-store getEventFingerprint:** 2026-06-13 run 16, HIGH confidence. Now guards against missing toolCall.
- **Retrieval agent error handling:** 2026-06-13 run 16, MEDIUM confidence. All error paths return empty result (design choice). No crash bugs found.
- **Brave/Exa search tools:** 2026-06-12 run 15, MEDIUM confidence. No crash bugs found.

## Open risks

### HIGH priority

- **extract-page-content-tool never indexes saved content** — `src/tools/extract-page-content-tool.ts`, `src/lib/transport/tool-registry.ts:65`
  - No `indexResearchFile` call after saving; `embeddingConfig` not passed to tool
  - Even when save succeeds, retrieval agent can never find extracted content

- **Global sub-agent emitter race** — `src/lib/sub-agent-emitter.ts:5-8`
  - `currentEmitter` module-level singleton overwritten by concurrent sessions
  - Architecture-level fix needed; directHandlers Map mitigates most user-visible impact

- **TOCTOU race in research folder creation** — `src/lib/transport/research-folder.ts:66-70`
  - Read (list existing) and write (mkdir) are separate async ops spanning seconds

- **No re-entry guard on `DirectTransport.sendMessages()`** — `src/lib/transport/index.ts:92-203`
  - Two concurrent calls can create duplicate folders, corrupt sub-agent event routing

- **`rebuildResearchChatIndex` bypasses `serializedIndexWrite` queue** — `src/lib/research-history.ts:201`
  - Direct `writeResearchChatIndex` call can race with concurrent saves through serialized queue
  - Fix: route rebuild writes through `serializedIndexWrite` or add locking

### MEDIUM priority

- **DNS resolution has no timeout** — `src-tauri/src/lib.rs:211-221`
- **Webview HTML extraction has no size guard** — `src-tauri/src/lib.rs:111-121`
- **Windows reserved filenames pass validation** — `src/lib/transport/research-folder.ts:5`
- **Memory extraction failures invisible to user** — `src/lib/transport/index.ts:149`
- **`stripMarkdownJsonFence` fails on nested backticks** — `src/lib/memory-agent.ts:48-52`
- **Guard retry pollutes `isResearchLikeRequest`** — `src/lib/agent-guards.ts:457-461`
- **setState after unmount in `loadRunsFromDisk`** — `src/lib/sub-agent-store.tsx:64-88`
- **All retrieval-agent error paths return identical empty result** — `src/lib/retrieval-agent.ts:81-305`
- **`list_files` tool returns array not string** — `src/lib/retrieval-agent.ts:114`

### LOW priority

- **`processedMemoryMessageIds` Set grows unboundedly** — `src/lib/transport/index.ts:39`
- **`resolveUniqueFolderNameFromExisting` uses `.parse()` not `.safeParse()`** — latent crash risk
- **Deterministic fallback hardcodes sub-agent ID format** — `src/lib/transport/folder-namer.ts:113-130`
- **Dead `ModelSelectorContext`** — `src/components/assistant-ui/model-selector.tsx:21-48`
- **`SafePathSegmentSchema.parse` in subAgentsFilePath can throw synchronously** — `src/lib/sub-agent-persistence.ts:15-16`
- **`extractFirstJsonObject` fails on `\u` unicode escapes** — `src/lib/retrieval-agent.ts:240-243`
- **Exa search tool defines own schema instead of reusing `searchResultSchema`** — `src/tools/exa-search-tool.ts:8-16`
- **`embedding_dimensions: 0` passes through `??` but was blocked by `||`** — `src/lib/settings-store.ts:132`
