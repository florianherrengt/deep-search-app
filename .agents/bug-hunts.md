# Bug Hunt Memory

## Current status

- Last run: 2026-06-14 (run 17)
- Last inspected commit: a3a0df2 (+ uncommitted fixes)
- Suggested next focus: extract-page-content indexing (architectural); interleaved async folder selection race; global sub-agent emitter singleton; hype_embeddings orphaned after chunk deletion (Rust); TOCTOU in indexing read/write phases

## Recent runs

### Run 17 — 2026-06-14 (commit a3a0df2, uncommitted fixes)

**Focus areas:**
- HIGH priority open risks from run 16
- Sub-agent persistence and event handling (deep dive)
- Tool result parsing and error handling
- Dangerous error-handling patterns sweep (`.catch(() => {})`, `as unknown as`, `JSON.parse`)
- Rust backend audit (indexing, search, schema)
- Frontend edge cases (empty states, concurrent updates, session lifecycle)

**Bugs fixed (9):**

1. **Currency Select deselection sets null** — `settings-fields.tsx:264`. Added `allowDeselect={false}` + null guard.
2. **handleSelectResearchChat unhandled rejection** — `App.tsx:508`. Added try/catch with error logging.
3. **rebuildResearchChatIndex bypassed serializedIndexWrite queue** — `research-history.ts`. Split into `collectResearchChatSummaries` (read-only) + queued write with read-check. Removed dead code.
4. **ensureRun warning logged `eventType: "unknown"`** — `sub-agent-store.tsx:555`. Pass actual event.type from all call sites.
5. **Malformed persistence file silently dropped all runs** — `sub-agent-persistence.ts:25-31`. Added console.warn for corrupted JSON, non-array, dropped runs.
6. **applyEvent missing default case → store corruption** — `sub-agent-store.tsx:534`. Default returns `runs` unchanged with diagnostic.
7. **Silent embedding/index failures in file-tools** — `file-tools.ts:73,149,178,188,213`. Added console.error for non-abort errors via `isAbortError`.
8. **backfill_index silently swallows ALL errors** — `src-tauri/src/lib.rs:730,755`. Track `total_seen`/`total_failed`, error if all fail, log each failure via `eprintln!`.
9. **embedding_dimensions accepts invalid values (0, negative, NaN)** — `settings-store.ts:83`. Schema: `z.number().int().positive()`.

**Tests added:** 7 new tests (currency null guard, index write concurrency, eventType diagnostic, unknown event type, 3x malformed persistence diagnostics).

**Verification:** 880/880 unit tests pass; Rust `cargo check` clean.

**Investigated but not fixed (false positives):**
- `researchChatId` staleness — FALSE: Chat keyed by sessionId
- `isSubAgentStartEvent` drops events — FALSE: all production emitters set `source: "sub-agent"`
- `handleResearchFolderChange` stale closure — FALSE: NOT wrapped in useCallback, recreated every render, ref updated synchronously
- Unguarded `JSON.parse()` — FALSE: all 7 occurrences wrapped in try/catch
- Timer leaks — FALSE: all properly cleaned up

**Investigated but not fixed (real but architectural/complex):**
- extract-page-content-tool: content saved to `raw/{domain}/` which `reindex_folder` doesn't scan; `validate_filename` rejects slashes
- memory-agent: writes memories.md but never calls `indexResearchFile`
- Interleaved async folder selection race — No abort mechanism; stale completion can overwrite state
- hype_embeddings orphaned after chunk deletion (Rust schema lacks cascade)
- Swallowed DELETE_EMBEDDING errors (6 locations in indexing.rs)
- FTS5 phrase query with internal double-quotes produces malformed SQL
- In-progress sub-agent runs never persisted (design choice)

### Run 16 — 2026-06-13
Focus: Sub-agent emitter routing, research-history rollback paths. Bugs fixed: 4.

### Run 15 — 2026-06-12
Focus: moveResearchChatToFolder data loss, extract-page-content-tool, search tools. Bugs fixed: 4.

## Recurring patterns

- `.catch(() => {})` silently hides failures — always log (fixed 10+ instances)
- Read-modify-write without serialization loses data under concurrency
- Index writes must ALL go through the serialization queue
- `as unknown as` casts bypass TypeScript — add runtime validation or defensive defaults
- Exhaustive switches need default cases for untrusted input
- Mantine Select defaults to `allowDeselect: true` — set `allowDeselect={false}` for required fields
- `let _ =` in Rust silently swallows errors — always handle or propagate
- Zod schemas need constraints (`.int()`, `.positive()`, `.min()`) not just type checks

## Recently inspected areas

- **Index write serialization:** run 17, HIGH confidence
- **Sub-agent persistence + event handling:** run 17, HIGH confidence
- **file-tools indexing error handling:** run 17, HIGH confidence
- **backfill_index error handling:** run 17, HIGH confidence
- **settings schema validation:** run 17, HIGH confidence
- **JSON.parse safety:** run 17, HIGH confidence — all guarded
- **Timer cleanup:** run 17, HIGH confidence — all cleaned up
- **DirectTransport researchChatId:** run 17, HIGH confidence — NOT a bug
- **handleResearchFolderChange closure:** run 17, HIGH confidence — NOT a bug
- **Sub-agent emitter routing:** run 16, HIGH confidence
- **Retrieval agent error handling:** run 16, MEDIUM confidence

## Open risks

### HIGH priority

- **extract-page-content-tool content un-indexable** — `src/tools/extract-page-content-tool.ts`
  - Content saved to `raw/{domain}/` subdirectory; `reindex_folder` only scans top-level files
- **memory-agent never indexes memories.md** — `src/lib/memory-agent.ts:135-150`
- **Interleaved async folder selection race** — `src/App.tsx:457-506`
  - No abort mechanism; rapid clicks can display wrong folder's chats
- **hype_embeddings orphaned after chunk deletion** — `src-tauri/src/schema.rs:51-63`
  - No cascade delete from chunks → hype_embeddings; garbage vectors accumulate

### MEDIUM priority

- **Swallowed DELETE_EMBEDDING errors** — `src-tauri/src/research_search/indexing.rs` (6 locations)
- **FTS5 phrase query with internal double-quotes** — `src-tauri/src/research_search/search.rs:643-645`
- **Global sub-agent emitter singleton race** — `src/lib/sub-agent-emitter.ts:11-14`
- **TOCTOU in indexing read/write phases** — `src-tauri/src/research_search/indexing.rs:126-228`
- **No DB schema migration system** — `src-tauri/src/research_search/schema.rs`
- **DNS resolution has no timeout** — `src-tauri/src/lib.rs:211-221`
- **Windows reserved filenames pass validation** — `src/lib/transport/research-folder.ts:5`
- **In-progress sub-agent runs never persisted** — `src/components/chat.tsx:425-428`
- **`switch_tab` failure silently proceeds** — `src/tools/extract-page-content-tool.ts:142`

### LOW priority

- **`processedMemoryMessageIds` Set grows unboundedly** — `src/lib/transport/index.ts:42`
- **`createSubAgentId` collision on clock change or HMR** — `src/lib/sub-agent-types.ts:62-65`
- **cosine_similarity truncates on mismatched dimensions** — `src-tauri/src/research_search/search.rs:1005-1018`
- **Non-UTF8 filenames become empty string in backfill** — `src-tauri/src/lib.rs:745-749`
- **Webview HTML extraction has no size limit** — `src-tauri/src/lib.rs:111-122`
