# Bug Hunt Memory

## Current status

- Last run: 2026-06-12
- Last inspected commit: 14505e7
- Suggested next focus: Guarded-stream abort error handling and unhandled rejections

## Recent runs

### Run 1 — 2026-06-12 (commit 14505e7)

**Focus areas:**
- Sub-agent persistence and event handling
- Sub-agent store state management
- Research folder operations and folder-namer
- Transport/guarded-stream async and cancellation

**Bugs fixed (3):**

1. **Tool-result missing status on error** — `sub-agent-tool-wrapper.ts:80`
   - Root cause: Error path emitted `tool-result` without `status`, store defaulted to "complete"
   - Fix: Added `status: "error"` to the error path
   - Test: `sub-agent-tool-wrapper.test.ts` — new test "tool-result event has status error when execute throws"

2. **Cannot collapse selected sub-agent run** — `sub-agent-sidebar.tsx:93-110`
   - Root cause: `store.selectRun(run.id)` called unconditionally on toggle; auto-expand effect re-expanded selected run
   - Fix: Only select on expand, deselect on collapse
   - Test: `sub-agent-sidebar.test.tsx` — new test "allows collapsing the currently selected run"

3. **updateRun cross-contamination by chatId** — `sub-agent-store.tsx:179,272`
   - Root cause: `run.id === id || run.chatId === id` could match wrong runs
   - Fix: Changed to `run.id === id` only (events dispatched by run ID)
   - Test: `sub-agent-store.test.tsx` — new tests for tool-result error status and updateRun isolation

**Verification:** 721/721 tests pass, tsc --noEmit clean

**Remaining risks documented below.**

## Recurring patterns

- Sub-agent event system has multiple dedup/fingerprint edge cases (text-delta collision with identical content, tool-result collision with missing IDs)
- Transport catch blocks can mask root causes when `controller.enqueue` throws
- Persistence error paths are untested (writeSubAgentRuns failures, concurrent writes)
- UI components using Collapse from Mantine keep content in DOM — tests must use `toBeVisible()` not `toBeInTheDocument()`

## Recently inspected areas

- **Sub-agent store (sub-agent-store.tsx):** 2026-06-12, HIGH confidence. All event types, updateRun, dedup logic inspected.
- **Sub-agent tool wrapper (sub-agent-tool-wrapper.ts):** 2026-06-12, HIGH confidence. Start/tool-call/tool-result/complete/error paths all verified.
- **Sub-agent sidebar (sub-agent-sidebar.tsx):** 2026-06-12, HIGH confidence. Toggle, auto-expand, collapse all verified.
- **Sub-agent persistence (sub-agent-persistence.ts):** 2026-06-12, HIGH confidence. Read/write/normalize paths all inspected.
- **Guarded-stream (guarded-stream.ts):** 2026-06-12, MEDIUM confidence. Reviewed abort paths and error masking. Risks noted but not fixed.
- **Folder-namer (folder-namer.ts):** 2026-06-12, MEDIUM confidence. TOCTOU race and code-fence fragility noted.
- **Extract page content (extract-page-content-tool.ts):** 2026-06-12, MEDIUM confidence. Error propagation and slug edge cases noted.

## Open risks

### HIGH priority

- **Unhandled promise rejections on abort** — `guarded-stream.ts:219-220`
  - `result.finishReason` and `result.totalUsage` reject silently when `pipeUIMessageStream` throws on abort
  - No `.catch()` or cleanup; unhandled rejection in strict mode
  - Fix: wrap in try/catch or use `.catch(() => {})` for both promises

- **Error masking in guarded-stream catch** — `guarded-stream.ts:157-167`
  - If `controller.enqueue` throws inside catch block, original error is lost
  - Makes debugging production failures very difficult
  - Fix: wrap `controller.enqueue` in try/catch, log original error before attempting enqueue

### MEDIUM priority

- **Concurrent writeSubAgentRuns race** — `chat.tsx:332-361`
  - Two terminal runs completing quickly can interleave async writes; last-write-wins may lose data
  - Fix: serialize writes with a queue or mutex

- **Silent persistence failure** — `chat.tsx:360`
  - `void persistSubAgentRuns(...)` swallows errors; user never knows persistence failed
  - Fix: catch and surface error (toast or log)

- **Text-delta fingerprint collision** — `sub-agent-store.tsx:281-282`
  - `td:${run.id}:${run.delta}` — identical delta content for same run is deduped as re-delivery
  - Low probability with LLM streaming but architecturally wrong
  - Fix: include sequence counter or chunk index

- **tool-result fingerprint collision** — `sub-agent-store.tsx:287`
  - Two tool-results for same run with no `toolCallIndex` and no `toolCallId` produce same fingerprint
  - Second result silently dropped
  - Fix: include result content hash or require at least one identifier

- **Events before start silently dropped** — `sub-agent-store.tsx:266-274`
  - If text-delta/tool-call arrives before start event, `updateRun` is a no-op (run doesn't exist yet)
  - Fix: buffer out-of-order events or log a warning

### LOW priority

- **TOCTOU race in folder name uniqueness** — `research-folder.ts:66-71`
  - Check (list) and write (mkdir) are not atomic
  - Two sessions could resolve to the same name simultaneously

- **writeAppFile leaves empty directories** — `app-file-storage.ts:103-119`
  - If `bridgeWriteTextFile` fails after `bridgeMkdir`, empty directory remains

- **processMemoryMessageIds unbounded growth** — `transport/index.ts:39`
  - Set grows linearly with message count, never pruned
