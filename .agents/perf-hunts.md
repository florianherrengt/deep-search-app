# Perf Hunt Memory

## Current status

- Last run: 2026-06-14 (run 4)
- Last inspected commit: 8eb9397 (runs 1-4 changes uncommitted; working tree also has pre-existing uncommitted changes in tool-call-requirements/chat-providers/settings-store unrelated to perf)
- Suggested next focus: Message-list virtualization (biggest scaling bottleneck — all messages mount at once) OR Rust search.rs query batching.

## Baselines

- **Frontend unit tests**: 873 passed, 16 skipped, 0 failed (run 4).

- **JSON chat-save serialize** (80-msg / ~2.2MB conversation, 50 iters):
  - Pretty (`null, 2`): 1.30ms mean — **removed** (run 2).
  - Compact: 0.78ms mean (−40% serialize). Script: `BENCH_JSON_WRITE=1 vitest benchmarks/json-write/`.
- **Incremental JSONL append vs full rewrite** (run 3):
  - Full rewrite (80 msgs): 0.755ms serialize, 2.23MB payload.
  - Append (2 new msgs): 0.017ms serialize, 56KB payload.
  - **44.5× faster serialize, 40× smaller write** for incremental saves.
- **Currency guard detection** (run 1): mean 0.266ms, p99 0.39ms.
- **MarkdownContent memoization** (run 2): 0 re-invokes across 10 unchanged parent re-renders.
- **Frontend unit tests**: 862 passed, 16 skipped, 0 failed (run 3).
- **Rust unit tests**: 63 passed, 0 failed (run 1).

## Recent runs

### Run 4 — 2026-06-14 — React render quick wins

Focus: per-event / per-keystroke / per-render React waste.

- **Memoize context provider values** (`use-settings.tsx`, `use-prompt-templates.tsx`, `use-skills.tsx`): all three created a new context value object on every render → all consumers re-rendered on any unrelated provider re-render. Wrapped in `useMemo` (callbacks already `useCallback`-stable, so value stays stable).
- **Split sub-agent state context** (`sub-agent-store.tsx`): `useSubAgentState()` returned `{ runsByChat, selectedRunId }` as one object; every event created a new state object → all consumers re-rendered. Added `SubAgentRunsByChatContext` + `SubAgentSelectedRunIdContext` providing the two slices separately (React skips consumers whose slice ref is unchanged). Migrated `SubAgentRunsPersistence` (chat.tsx) and `SubAgentSidebarAutoOpen` (App.tsx) to granular hooks. `selectRun` no longer re-renders runsByChat consumers; runsByChat changes no longer re-render selectedRunId consumers.
- **ComposerInput rAF dedup** (`thread.tsx`): `refreshOverflow` scheduled a new `requestAnimationFrame` on every `onChange` AND `onHeightChange` (2 per keystroke), each doing a forced `scrollHeight`/`clientHeight` layout read. Added `rafScheduledRef` guard so at most one rAF is pending at a time.
- Skipped: SubAgentEventBridge per-token message iteration — analyzed, the inner loop already short-circuits via `startIdx`; per-message work is property checks only (negligible for <200 messages).

Verification: `vitest --project unit` → 873 passed, 0 failed.

### Run 3 — 2026-06-13 — Incremental JSONL persistence + streaming plain text

Focus (user request: "a LOT of text" + "big JSON files to disk" → both big wins):

- **Incremental JSONL chat persistence** (`research-history.ts`, `app-file-storage.ts`, `tauri-bridge.ts`):
  - Root cause: `saveResearchChatMessages` re-serialized + re-wrote the ENTIRE conversation every stream-finish (O(total) per save). For a 5MB conversation, that's 5MB serialize + 5MB IPC + 5MB disk write every turn.
  - Fix: append-only JSONL format. Each save reads the existing file, computes common message-ID prefix, and APPENDS only new messages (OS-level `writeTextFile({append:true})`) + a fresh metadata line. Falls back to full rewrite on divergence (regeneration) or legacy-format migration. Reader handles both JSONL and legacy single-object JSON.
  - Measured: append 0.017ms / 56KB vs full rewrite 0.755ms / 2.23MB (44.5× serialize, 40× write). The write savings scale with conversation length.
  - Correctness: 4 new tests (append path, divergence→rewrite, legacy read-back, legacy→JSONL migration). Removed dead code (`StoredResearchChatSchema`, `readExistingResearchChatSummary`).

- **Plain text during sub-agent streaming** (`sub-agent-sidebar.tsx`):
  - Root cause: `MarkdownContent` re-parsed the FULL accumulated sub-agent text on every deferred streaming update → O(n²) over a long report.
  - Fix: render raw `<pre>` text while `status === "running"|"streaming"`, switch to `MarkdownContent` on terminal status. Eliminates per-token markdown parsing entirely.
  - Test: raw `# Heading` shown during streaming, parsed `<h1>` on completion.

Verification: frontend `vitest --project unit` → 862 passed, 0 failed. Typecheck clean.

### Run 2 — 2026-06-13 — Compact JSON writes + MarkdownContent memo

- Removed `null, 2` pretty-printing from 4 machine-read disk-write sites (`research-history.ts`, `sub-agent-persistence.ts`). Serialize −40%, bytes −1.8%.
- Memoized `MarkdownContent` (sub-agent transcript renderer). 0 re-invokes on unchanged text.

### Run 1 — 2026-06-13 — Guardrail hot path + Rust research_search

- Currency regex precompute (`agent-guards.ts`): ~200 regexes/call → module init. mean −24%, p99 −32%.
- hype_questions.chunk_id index (`schema.rs`): full scan → covering index (EXPLAIN confirmed).
- get_fts_snippet parameterize (`search.rs`): interpolated SQL (15 prepares + injection) → constant SQL + `prepare_cached` (1 prepare) + bound params.

## Recurring patterns

- **Pretty-printing machine-read data**: 4 disk-write sites had `null, 2` for JSON.parse-read data. ~40% serialize-CPU waste. Always compact for machine-read.
- **Re-writing growing collections in full every time**: chat saves re-wrote the whole conversation. Use append-only formats (JSONL) with divergence detection + full-rewrite fallback.
- **Re-parsing growing text on every update**: markdown re-parse during streaming is O(n²). Render plain text while streaming, parse once on completion.
- **Static regex/object construction inside per-call functions**: hoist to module scope.
- **String-interpolated SQL in loops**: constant SQL + bound params + `prepare_cached`.
- **Missing indexes on FK columns**: SQLite FK ≠ index.
- **Unmemoized text renderers**: memo markdown components that take a `text` prop.
- **Unmemoized context provider values**: always `useMemo` the value object; callbacks should be `useCallback`-stable.
- **Single state context for unrelated slices**: split into per-slice contexts so React can skip consumers whose slice ref is unchanged.

## Recently profiled areas

- **Sub-agent streaming** (sub-agent-store, emitter): optimized in commits 0df2cb5/635a1ac/8eb9397 + run 4 context split. Has `npm run benchmark:subagents`. Revisit after new changes.
- **token-usage.ts extractPartText JSON.stringify**: fallback path only (no provider usage). Low priority.
- **SubAgentEventBridge per-token iteration** (chat.tsx:355): inner loop short-circuits via startIdx; per-message work is property checks only. Not worth optimizing for <200 messages.
- **ComposerInput forced layout** (thread.tsx): rAF now deduplicated (run 4). Residual cost is one layout read per frame during typing — acceptable.

## Open risks

- **No message-list virtualization** (HIGH, scales with conversation length): `@assistant-ui` `ThreadPrimitive.Messages` renders ALL messages via `Array.from({ length })`. For 100+ messages, all ThreadMessage components mount simultaneously. Biggest scaling bottleneck. Fix requires wrapping/forking the library primitive or windowing with IntersectionObserver.
- **Multiple Chat instances mounted** (MED-HIGH, per-session): App.tsx:640 mounts all visible sessions (active + running + attention) with `hidden`, each with full `useChat` hooks + event bridges. Memory + render cost during multi-session research.
- **Rust search.rs N+1 per-result queries** (HIGH, per-query): `get_chunk_info` (search.rs:332) + `get_adjacent_chunks` re-prepare per result (~24 prepares/search). Batch `WHERE id IN (...)`.
- **Rust MMR dedup** (HIGH, per-query): per-candidate `get_chunk_embedding` re-prepare (~60) + Rust cosine sim O(N·M·D). Push into sqlite-vec or batch.
- **React SubAgentRunsPersistence** (MED): filter+dedup-key over all runs on every store change (every 100ms during streaming). Guard to only compute when a run transitions to terminal.
- **ResearchSidebar closures + Set recreation** (MED): inline closures in .map(), Sets recreated every render, ResearchChatList not memoized.
- **Rust filter_by_folder/filenames** (MED): per-candidate `get_chunk_info` fetches full content when only folder_id/filename needed.
- **Rust embedding deletes unbatched** (MED, per-reindex): one-by-one DELETE in loop.
- **Transport getActiveToolNamesForMessages O(T·M)** (LOW-MED): recompute each guard-retry.
- **app-file-storage exists+op N+1** (LOW-MED): every read/delete/rename = 2 Tauri IPC.
- **token-usage.ts JSON.stringify in extractPartText** (LOW, fallback path only).
- **SearchResult serializes full content + adjacent chunks** (LOW-MED, per result).
- **sub-agent-profiler.ts getPayloadBytes** (LOW, dormant): JSON.stringify+Blob per event when profiling enabled.
- **Chat JSONL meta lines accumulate** (LOW): one tiny meta line per save; pruned on full rewrite (divergence). Negligible.

## Audit idea for next run

- Audit ALL FK columns for missing indexes: `chunks.folder_id`, `chunks.filename`. Run `EXPLAIN QUERY PLAN` over every `schema.rs` constant vs populated DB; flag `SCAN`.
