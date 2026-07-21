# Bug Hunt Memory

## Current status

- Last run: 2026-07-21 (run 19)
- Last inspected commit: caf9cd5 (+ uncommitted abort-gap fixes)
- Suggested next focus: Tools panel missing descriptors (`execute-tool.ts`); originalQuestion prompt-only enforcement; chat-history-search cache overwrite on transient empty load (build overwrites in-memory + persisted cache with current records only — recovered automatically but wastes work); `closeWebviewTab` swallows errors silently (UI lies about tab closure); `relevant_memories` semantic vs folder-level mismatch in search-research-tool

## Recent runs

### Run 19 — 2026-07-21 (commit caf9cd5, uncommitted fixes)

**Focus areas:**
- Folder-scoped research memory and recall (NEW feature, ~3000 LOC) — `research-memory.ts`, `research-recall.ts`, `research-folder-context.ts`, `memory-agent.ts`
- Chat history semantic search (NEW) — `chat-history-search-service.ts`, `chat-history-search-index.ts`, `chat-history-search-corpus.ts`, `chat-history-embedding-client.ts`, worker
- Extraction renderer fallback fix (recent) — `extract-page-content-tool.ts`, `chrome-mcp-page-loader.ts`
- App lifecycle / persistence — `research-history.ts`, `use-research-workspace.ts`, `transport/index.ts` (memory candidate pipeline)

**Bugs fixed (2):**

1. **`extractPageContent` did not re-check abort between extractPage return and save/summarize** — `src/tools/extract-page-content-tool.ts:563`. If abort fired after `core.extractPage` returned (or after `getResearchFolder`, or after `saveExtractedContent`), the code continued: saved to the research folder and returned a summary the user had cancelled. Fixed by adding `throwIfAborted(options.abortSignal)` at entry, after extractPage, after getResearchFolder, and after save. Also added `abortSignal?.aborted` to `extractViaWebview`'s catch (was only checking `isAbortError`).
2. **`extractAndStoreMemories` did not re-check abort after LLM stream completed** — `src/lib/memory-agent.ts:155`. If abort fired between `result.text` resolving and `writeAppFile`, memories were persisted despite cancellation. Fixed by adding `throwIfAborted(abortSignal)` immediately before the write.

**Tests added:** 3 (post-extraction abort; pre-work abort; post-stream pre-write abort). Both fixes verified by reverting and re-running — reverting produced the exact "promise resolved with stored content" failure.

**Verification:** 1077/1077 unit pass; lint clean; build clean.

**Investigated but NOT bugs (verified):**
- `chat-history-search-service.buildSemanticIndex` overwriting cache with current records only — intentional (dropped records are stale); invalidation is lazy but correct
- `chat-history-search-service` `perQueryLimit` mismatch between primary (max(limit,10)) and fallback (raw limit) — intentional, hybrid search over-fetches then truncates
- `mergeResearchMemories` returning 0 while still writing legacy prose — misleading but unused by callers; legacy prose preservation is documented
- Memory queue `pendingMemoryCandidates` unbounded growth — bounded by `MAX_PENDING_MEMORY_CANDIDATES=50`, oldest dropped
- `parseResearchMemoryBullet` skipping metadata-like prefixes — LLM is instructed to start facts with "User", so safe in canonical path
- `extractViaWebview`'s module-level queue — drains correctly via finally; only an issue if task never settles (no product fix)
- `closeWebviewTab` silent error swallow — UX issue, not correctness (Tauri may auto-close); logged separately as risk
- Folder context load races — `folderContext` loaded once per turn; stale on folder switch is acceptable
- Memory agent holds lock for entire LLM call — slow but correct; folder switch waits for lock

### Run 18 — 2026-07-07
Focus: Stop cancellation, currency toggle, checkpoint retry framing, shared core refactor fallout. Bugs fixed: 2.

### Run 17 — 2026-06-14
Focus: HIGH priority risks, sub-agent persistence, error-handling sweep. Bugs fixed: 9.

## Recurring patterns

- `.catch(() => {})` silently hides failures — always log (fixed 10+ instances)
- Read-modify-write without serialization loses data under concurrency
- Index writes must ALL go through the serialization queue
- `as unknown as` casts bypass TypeScript — add runtime validation or defensive defaults
- Exhaustive switches need default cases for untrusted input
- Mantine Select defaults to `allowDeselect: true` — set `allowDeselect={false}` for required fields
- `let _ =` in Rust silently swallows errors — always handle or propagate
- Zod schemas need constraints (`.int()`, `.positive()`, `.min()`) not just type checks
- Tools panel descriptors (`execute-tool.ts`) drift out of sync with runtime registry (`tool-registry.ts`); verify parity when adding tools
- Guard logic keyed on "latest user message" must skip text-less messages (attachments) and synthetic app-injected messages
- Verify scout claims about framework internals before acting — subagents misread ai SDK abort flow
- **NEW**: Abort signals must be re-checked after every async boundary in multi-step flows (extract → save → summarize); the underlying primitive propagating abort is not sufficient if work continues after the await resolves
- **NEW**: `isAbortError(error) || abortSignal?.aborted` is the safe catch pattern — Tauri invoke doesn't always translate aborted commands into AbortError

## Recently inspected areas

- **Folder-scoped research memory and recall:** run 19, HIGH confidence — locks serialize correctly, deduplication sound, legacy prose preservation correct, return-value quirk documented
- **Chat history semantic search:** run 19, HIGH confidence — index/cache/worker lifecycle sound, abort handling present, schema validation strict
- **Extraction renderer fallback:** run 19, HIGH confidence — Chrome→Tauri fallback verified for null/empty/error cases; abort propagation verified
- **Memory candidate pipeline (`transport/index.ts`):** run 19, HIGH confidence — dedup via processed/abandoned Sets correct, bounded queue, attempt tracking correct
- **Stop/auto-continue suppression:** run 18, HIGH confidence
- **Sub-agent persistence + event handling:** run 17, HIGH confidence

## Open risks

### HIGH priority

- **Tools panel missing descriptors** — `src/lib/execute-tool.ts`. `ask_questions`, `load_skill`, `currency_conversion`, chrome-devtools-mcp tools are registered at runtime but absent from the manual Tools panel. Display-only gap; runtime unaffected.
- **`closeWebviewTab` swallows close errors** — `src/tools/extract-page-content-tool.ts:346`. UI emits `emitBrowserTabClosed` unconditionally; orphan webview tabs if close fails.
- **`relevant_memories` semantic** — `src/tools/search-research-tool.ts:74`. Attaches ALL same-folder memories to each chat match, not memories specifically relevant to the chat. Schema name suggests per-chat relevance.

### MEDIUM priority

- **chat-history-search cache overwrite on transient empty load** — if `loadChatHistorySearchRecords` returns few records due to a transient error, cache entries for unseen records are dropped. Self-heals on next successful load but wastes embedding work.
- **originalQuestion prompt-only enforcement** — `agent-guards.ts` retry framing relies on model obeying natural-language guidance; no schema check.
- **Memory timestamp uses folder's chat updatedAt, not memories.md mtime** — `src/lib/chat-history-search-corpus.ts:227`. Memories appear older than they are in search results.
- **Swallowed DELETE_embedding errors** — `src-tauri/src/research_search/indexing.rs` (6 locations).
- **FTS5 phrase query with internal double-quotes** — `src-tauri/src/research_search/search.rs:643`.
- **Global sub-agent emitter singleton race** — `src/lib/sub-agent-emitter.ts:11-14`.
- **TOCTOU in indexing read/write phases** — `src-tauri/src/research_search/indexing.rs`.
- **DNS resolution has no timeout** — `src-tauri/src/lib.rs:211`.

### LOW priority

- **`processedMemoryMessageIds`/`abandonedMemoryMessageIds` Sets grow unboundedly** — `src/lib/transport/index.ts:175`. One per message, never pruned.
- **`parseServiceUrl` weaker than core validator** — `src/lib/url-validation.ts:10`.
- **cosine_similarity truncates on mismatched dimensions** — `src-tauri/src/research_search/search.rs:1005`.
