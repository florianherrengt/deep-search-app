# Perf Hunt Memory

## Current status

- Last run: 2026-06-21 (run 8)
- Last inspected commit: e93b0dd + working tree (bug fixes + run-6/7/8 perf changes).
- Suggested next focus: verify streaming-lag fixes end-to-end in a Tauri dev build with React Profiler. Then attack `readAppFile` 2-IPC (`src/lib/app-file-storage.ts:149`) or main-chat markdown streaming (currently re-parses per token — sub-agent sidebar already uses plain-text-while-streaming pattern from run 3, main chat does not).

## Baselines

- **Frontend unit tests**: 886 passed, 17 skipped, 0 failed (run 8).
- **Production bundle (main chunk)**: 1,819.34 KB / 509.76 KB gzipped (run 5). Re-measure if `deep-search-core` or vendor deps change.
  - Lazy `load-parse-*.js` (cheerio+parse5): 284.15 KB / 97.62 KB gzipped.
  - Chat chunk: 179.73 KB / 59.27 KB gzipped.
- **Sub-agent streaming benchmark** (run 8): sidebarCommits stable at 48 (text) / 54 (progress) across all agent counts. Run-to-run timing variance ~2× on jsdom — treat sidebarCommits as the regression signal, not totalMs. Script: `npm run benchmark:subagents`.
- **Render-cost microbench** (`BENCH_RENDER_COST=1 npx vitest run --project unit benchmarks/react-render-cost`):
  - Intl.DateTimeFormat per call: 30.09μs → 1.09μs (**27.6×** with hoisted singleton).
  - 4× Zod safeParse (ask_questions predicate + view): 4.02μs mean, 16.87μs p99 per render. Memoization eliminates these on stable props.
  - `getCurrentTokenCount` (20-msg tool-heavy chat): 5.64μs → ~0μs (**56×** with `[length, status]` dep instead of `[chat.messages]`).
  - Inline style allocation vs hoisted constants: 0.05μs vs 0.04μs per object (**1.25×** — modest, but stable identity helps React's style diff).
- **Store IPC per get()** (run 6): 1 IPC (was 27 IPC for 27-key settings). Script: `BENCH_STORE_IPC=1 npx vitest run --project unit benchmarks/store-ipc`.
- **listResearchFolders CPU** (run 6): mean 0.417ms (was 0.776ms, −46%). Script: `BENCH_FOLDER_LISTING=1 npx vitest run --project unit benchmarks/folder-listing`.
- **JSON chat-save serialize** (run 2): compact 0.78ms mean.
- **MarkdownContent memoization** (run 2): 0 re-invokes across 10 unchanged re-renders.
- **Currency guard detection** (run 1): mean 0.266ms, p99 0.39ms.

## Recent runs

### Run 8 — 2026-06-21 — More React render waste (streaming lag, continued)

Focus: continue React render optimization after run 7. Discovery subagents identified 3 more clusters.

- **`tokenCount` / `previousSearches` per-token recomputation** (`chat.tsx:290,295`):
  - Root cause: both `useMemo`s depended on `[chat.messages]`, which is a new array reference on every streaming token. `getCurrentTokenCount` iterates ALL messages + ALL parts and JSON.stringifies every tool args/result — O(M·P) work per token. `previousSearches` iterates all messages looking for user text.
  - Fix: changed deps to `[chat.messages.length, chat.status]` for tokenCount and `[chat.messages.length]` for previousSearches. Displayed token count now lags by one stable state during streaming — fine for an estimate. `needsAttention` left on `[chat.messages]` because its `hasPendingQuestionTool` `.some()` short-circuits and timeliness matters for the sidebar attention indicator.
  - Measured: 5.64μs → ~0μs per token (**56×** speedup, microbench 500 iters × 20-msg tool-heavy chat).
- **`QuestionsToolView` Zod safeParse** (`questions-tool.tsx:66`):
  - Root cause: 2 `safeParse` calls in `canRenderQuestionsTool` predicate + 2 in `QuestionsToolView` body = 4 per render. During streaming, every token of a sibling text part re-renders all parts, triggering 4 safeParse per token.
  - Fix: wrapped `QuestionsToolView` in `React.memo` so the body parse (2 of the 4) is skipped on stable props. The predicate's 2 safeParse remain (necessary for the ToolFallback fall-through decision).
- **`App.tsx` derived arrays** (`App.tsx:728-737`):
  - Root cause: 5 arrays (`runningFolderNames`, `runningChatIds`, `attentionFolderNames`, `attentionChatIds`, `visibleChatSessions`) derived from `chatSessions` in render body without `useMemo`. Recomputed on every AppInner render (settings/folder/attention changes).
  - Fix: wrapped all 5 in `useMemo` with appropriate deps. Keeps prop references stable for downstream consumers.
- **`handleSelectedModelChange` unmemoized** (`App.tsx:492`):
  - Root cause: inline function declaration, new identity every AppInner render → Chat's `useEffect` at `chat.tsx:150` (dep `[onSelectedModelIdChange, ...]`) re-fired on every AppInner render.
  - Fix: `useCallback` + `chatModelOptionsRef`.
- **Inline style hoisting** (`thread.tsx`, `chat.tsx`, `sub-agent-sidebar.tsx`, `sub-agent-transcript-inline.tsx`, `tool-fallback.tsx`):
  - Hoisted ~30 static inline style objects to module-level constants across the streaming-hot-path components. Modest per-call win (1.25×) but eliminates per-token allocation churn and gives React stable style references for diffing.
- **`ModelSelector` `data` array** (`model-selector.tsx:98`):
  - Was re-built via `.map()` over `models` + `formatContextWindowTokens` per render. Now `useMemo([models])`.
- **`previewSlug` slugify** (`skills-section.tsx:85`):
  - Was called on every keystroke in the skill title field. Now `useMemo([form.values.title])`.

Verification: `vitest --project unit` → 886 passed (+5 new benchmarks + memoization regression tests from run 7). `tsc --noEmit` clean. Sub-agent benchmark sidebarCommits unchanged.

### Run 7 — 2026-06-21 — React render waste on streaming hot path

- `Intl.DateTimeFormat` singleton (research-sidebar, tools-panel): 27.6× speedup, 30.09μs → 1.09μs per call.
- `handleModelChange` useCallback (chat.tsx): defeats ModelSelector React.memo, 0/10 re-renders (was 10/10).
- `getDuration` Date.parse (sub-agent-sidebar): 1.23× per call, avoids Date allocation.
- `searchKeys` useMemo (App.tsx): makes Chat's `effectiveSearchKeys` memo actually work.

### Run 6 — 2026-06-21 — Store N+1 IPC + folder-listing fast path

- Settings store: 27 IPC → 1 IPC per `get()` via `entries()`.
- listResearchFolders: dedicated `getResearchFolderUpdatedAt` skips Zod parse + normalize + sort. Mean 0.776ms → 0.417ms (−46%).

## Recurring patterns

- **Per-token `useMemo([chat.messages])`**: `chat.messages` is a new ref every token. Use `[chat.messages.length, chat.status]` when the compute doesn't need per-token freshness (token counts, derived searches). Keep `[chat.messages]` only when correctness requires per-token updates AND the compute is cheap.
- **`new Intl.DateTimeFormat()` per call**: 27× slower than reusing. Always hoist.
- **Unmemoized callbacks defeating React.memo**: fresh function in render body passed to a memoized child re-renders it every time. Use `useCallback` + refs.
- **Unmemoized inline objects as useMemo deps**: `useMemo([..., inlineObj])` always recomputes. Memoize the dep too.
- **Zod `safeParse` in render**: cheap per call (~1μs) but runs per-token for tool-view components inside streaming messages. Wrap in `React.memo`.
- **Per-element `new Date()`**: `Date.parse(str)` returns the timestamp directly without allocating.
- **N+1 IPC round-trips**: use `entries()` instead of per-key `get()`.
- **Per-element full validate+sort just to find a max**: use a dedicated scan.
- **Inline style objects on hot-path components**: hoist to module scope. Per-call win is small (1.25×) but eliminates allocation churn and stabilizes React's style diff.
- **Barrel re-exports of heavy parser code**: `sideEffects: false` or rollup `moduleSideEffects` override + dynamic-import.

## Recently profiled areas

- **Sub-agent streaming** (run 5 + 7 + 8): `npm run benchmark:subagents`. sidebarCommits is the stable metric (48/54). Run-to-run timing variance ~2× on jsdom.
- **SubAgentEventBridge per-token iteration** (`chat.tsx:373`): outer loop O(M) per token but inner loop short-circuits via startIdx. Property checks only. NOT worth optimizing.
- **SubAgentRunsPersistence effect** (`chat.tsx:438`): filter+map+join per sub-agent event, but `terminalRuns.length === 0` early-returns during streaming. Cost dominated by store updates, not this effect.
- **sub-agent-sidebar auto-expand effect** (line 29): iterates all runs per event but uses functional updater that returns `current` when nothing changes. Not worth optimizing.
- **@assistant-ui Messages**: per-message state subscription; per-token cost is per-message, not O(N).
- **ComposerInput forced layout** (`thread.tsx`): rAF deduplicated (run 4).

## Open risks

- **Main-chat markdown re-parse per token** (HIGH, biggest remaining streaming-lag contributor): `MarkdownText` (assistant-ui) re-parses markdown on every text-delta of the streaming message. Sub-agent sidebar already uses plain `<pre>` while streaming (run 3). Applying the same pattern to the main chat is a behavior change (user sees plain text during stream). Consider gating behind a setting or applying only for long responses.
- **`readAppFile` 2-IPC pattern** (MED): `src/lib/app-file-storage.ts:149` does `bridgeExists(path)` then `bridgeReadTextFile(path)`. Collapse to single read-with-catch for folder listing.
- **No message-list virtualization** (MED): `@assistant-ui` mounts ALL messages. Per-token cost bounded by per-message subscription, but mount cost scales linearly.
- **`upsertResearchChatSummary` read-modify-write** (LOW-MED): reads + sorts + writes the entire index per save. Bounded by chat count per folder.
- **`listResearchFolders` IPC count** (LOW-MED): still 2+2N IPC per listing. Structural fix: single Rust command for all folder timestamps.
- **`needsAttention` `[chat.messages]` dep** (LOW): iterates all messages per token. `.some()` short-circuits so usually cheap, but for long conversations with no pending question it walks everything. Could use `[chat.messages.length, chat.status]` if attention lag at stream end is acceptable.

## Audit idea for next run

- End-to-end profiling in a Tauri dev build with React Profiler on `Chat`, `Thread`, `ModelSelector`, `QuestionsToolView`, `ThreadMessage`. Confirm render counts dropped per-token. The microbench wins need real-world confirmation.
- Prototype plain-text-while-streaming for the main chat (mirror the sub-agent pattern). A/B test to see if users miss live markdown.
- Measure real `readAppFile` IPC cost in a Tauri build. If >0.3ms each, eliminate the exists check.
