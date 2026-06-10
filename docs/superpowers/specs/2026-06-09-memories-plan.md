# Memories Feature — Implementation Plan

Date: 2026-06-09
Design: `docs/superpowers/specs/2026-06-09-memories-design.md`

## Phase 1: Memory Agent + Prompt Updates

### Step 1.1: Create extraction prompt

**File:** `src/lib/memory-agent-prompt.md`

Write the memory extraction prompt as specified in the design. Import via `?raw` suffix.

**Verify:** Import resolves without error.

### Step 1.2: Create memory agent module

**File:** `src/lib/memory-agent.ts`

Implement `extractAndStoreMemories()`:

- Accepts: `userMessage: string`, `getResearchFolder: () => Promise<string>`, `model: LanguageModel`, `abortSignal?: AbortSignal`
- Calls `generateText()` with the extraction prompt and the user message
- Parses the JSON array of strings from the response
- Reads existing `memories.md` from the active folder via `readAppFile()`
- Merges: combines existing facts with new facts, deduplicates (exact string match), rewrites
- Writes via `writeAppFile()` (auto-indexes)
- Returns `{ memoriesStored: number }`
- Wraps everything in try/catch — never throws, never blocks the caller

Dependencies: `generateText` from `ai`, `readAppFile`/`writeAppFile` from `app-file-storage.ts`, prompt import.

**Verify:** Unit tests pass (see test plan below).

### Step 1.3: Integrate memory agent into transport

**File:** `src/lib/transport/index.ts`

In `DirectTransport.sendMessages()`:

- After the provisional folder is created (around line 91-126)
- Fire `extractAndStoreMemories()` in parallel with the existing previous-research lookup
- Use `Promise.allSettled()` or fire-and-forget — the result is non-blocking
- Pass the same `abortSignal` so it cancels if the user aborts
- On subsequent messages (not the first), still fire the memory agent — it should extract from every user message, not just the first

Need to pass `model` (LanguageModel) — check how the transport currently gets its model. The transport already has access to the model via the `createTools()` dependencies or it may need to be passed in.

**Verify:** Manual test — send a message mentioning a personal fact, check that `memories.md` appears in the research folder.

### Step 1.4: Update system prompt

**File:** `src/lib/system-prompt.md`

Changes:

1. Add a "Canonical research files" section:
   - `README.md` is the final research report, updated incrementally as the agent learns
   - `summary.md` is a compact search-optimized summary, updated incrementally
   - Define what each should contain (title, answer, findings, evidence, etc.)
2. Remove the example filenames `brave-initial.md`, `tavily-followup.md`, etc.
3. Keep working notes guidance (`notes.md`, `sources.md`, `open-questions.md`)
4. Scan for and fix any old tool name references (`save_research_file`, etc.)

**Verify:** Read through the updated prompt — canonical files are clearly defined, old names removed.

### Step 1.5: Write tests for memory agent

**File:** `src/lib/__tests__/memory-agent.test.ts`

Tests:

| Test | Approach |
|------|----------|
| Extracts facts from explicit statement | Mock `generateText` to return `["User has a dog."]`, verify `writeAppFile` called with merged content |
| Skips task-specific details | Mock `generateText` to return `[]`, verify no write (or write with unchanged content) |
| Merges with existing memories.md | Mock `readAppFile` to return existing content, mock `generateText` to return new fact, verify merged output |
| Deduplicates | Mock existing content containing "User has a dog.", mock extraction returning same fact, verify no duplicate |
| Creates new file when none exists | Mock `readAppFile` to return `null`, verify file created |
| Failure doesn't throw | Mock `generateText` to reject, verify function returns gracefully |

**Verify:** `npm test` passes.

### Step 1.6: Write tests for transport integration

**File:** `src/lib/__tests__/direct-transport.test.ts` (extend existing)

Add tests:

| Test | Approach |
|------|----------|
| Memory agent fires on first message | Verify `extractAndStoreMemories` called with user message text |
| Memory agent fires on subsequent messages | Verify it fires on every message, not just the first |
| Memory agent failure doesn't block | Mock `extractAndStoreMemories` to reject, verify main agent still runs |

**Verify:** `npm test` passes.

---

## Phase 2: Retrieval Sub-Agent

### Step 2.1: Create retrieval agent prompt

**File:** `src/lib/retrieval-agent-prompt.md`

Prompt that instructs the agent to:

- Analyze the user's message
- Generate 3-5 search queries that cover different aspects (topic, entities, intent)
- Call `searchResearch()` with those queries
- Evaluate results: which folders are relevant? which memories are relevant?
- For memories: "Would this memory materially improve the answer?"
- Return structured output with `relevant_folders` and `relevant_memories`

### Step 2.2: Create retrieval agent module

**File:** `src/lib/retrieval-agent.ts`

Implement `runRetrievalAgent()`:

- Accepts: `userMessage: string`, `searchResearch`, `model: LanguageModel`, `abortSignal?: AbortSignal`
- Creates scoped tools: a `search_research` tool that calls the real `searchResearch()`, optionally scoped `list_files`/`read_file` for folder investigation
- Calls `generateText()` with the retrieval prompt, user message, and scoped tools
- Uses `stopWhen: stepCountIs(5)` to bound agentic loops
- Parses the output into `{ relevant_folders, relevant_memories }`
- Returns the structured result, or empty defaults on failure

**Verify:** Unit tests pass.

### Step 2.3: Integrate retrieval agent into transport

**File:** `src/lib/transport/index.ts`

Replace the existing previous-research lookup (lines ~91-126) with the retrieval sub-agent:

- Instead of calling `searchResearch()` + `evaluateResearchRelevance()` directly, call `runRetrievalAgent()`
- Use the `relevant_folders` output for the existing "continue or start fresh?" flow
- Pass `relevant_memories` to `createGuardedStream()` as a new parameter

**File:** `src/lib/transport/guarded-stream.ts`

- Add `relevantMemories?: string[]` parameter to `createGuardedStream()`
- In `buildSystemPrompt()`, add a `## Relevant user memories` section when `relevantMemories` is non-empty

**Verify:** Manual test — store a memory in one session, start a new session with a relevant query, check that the memory appears in the agent's context.

### Step 2.4: Remove old relevance evaluator

Once the retrieval agent is working:

- Remove `src/lib/research-relevance-evaluator/index.ts`
- Remove `src/lib/research-relevance-evaluator/prompt.md`
- Remove `src/tools/search-research-tool.ts` (the tool that wraps search + evaluation) or refactor it to use the new retrieval agent
- Update any imports

**Verify:** `npm test` passes, `npm run build` passes.

### Step 2.5: Write tests for retrieval agent

**File:** `src/lib/__tests__/retrieval-agent.test.ts`

Tests:

| Test | Approach |
|------|----------|
| Agent generates multiple queries | Mock `searchResearch`, verify it was called with multiple different queries |
| Returns relevant folders | Mock search results from a hiking folder, mock model to evaluate it as relevant, verify folder returned |
| Returns relevant memories | Mock search results containing memories.md chunks, verify memories returned |
| Ignores irrelevant memories | Mock "User has a dog" memory for "Compare USB-C docks" query, verify it's not returned |
| Memory-only match doesn't trigger folder question | Only memories are relevant, no folders — verify empty `relevant_folders` |
| Failure returns empty defaults | Mock agent to reject, verify function returns `{ relevant_folders: [], relevant_memories: [] }` |

### Step 2.6: Write tests for prompt injection

**File:** `src/lib/__tests__/transport-guardrails.test.ts` (extend existing)

| Test | Approach |
|------|----------|
| Memories injected into system prompt | Call `buildSystemPrompt` with `relevantMemories`, verify "## Relevant user memories" section present |
| No memories section when empty | Call with empty array, verify no memories section |
| Memories placed after base prompt | Verify section ordering in the built prompt |

**Verify:** `npm test` passes.

---

## Phase 3: Filename Filter in Rust Backend

### Step 3.1: Add filename filter to Rust search

**File:** `src-tauri/src/research_search/search.rs`

- Add `filename: Option<&str>` parameter to `search()`, `search_inner()`, `collect_rerank_candidates()`, and `search_multi()`
- After the existing folder filter (around line 701), add a similar filter checking `info.filename`
- Or add a `WHERE filename = ?` clause to chunk retrieval SQL for more efficient filtering

**File:** `src-tauri/src/lib.rs`

- Add `filenames: Option<Vec<String>>` to the `search_research` Tauri command (around line 539)
- Pass through to the search function

### Step 3.2: Add filename filter to TypeScript API

**File:** `src/lib/research-search.ts`

- Add `filenames?: string[]` to the `searchResearch()` options type
- Include in the `invoke()` payload

### Step 3.3: Update retrieval agent to use filename filter

**File:** `src/lib/retrieval-agent.ts`

- The retrieval agent can now issue a focused memory search with `filenames: ["memories.md"]` alongside the broader research search
- This improves memory recall without crowding results with working notes

### Step 3.4: Write tests

**File:** `src/lib/__tests__/research-search.test.ts` (new or extend existing)

| Test | Approach |
|------|----------|
| Filename filter passed through | Call `searchResearch` with `filenames`, verify invoke payload includes it |
| No filter is backward compatible | Call without `filenames`, verify no filter in payload |

**Rust tests** (inline in `search.rs`):

| Test | Approach |
|------|----------|
| Filter by single filename | Search with `filename: "memories.md"`, verify only memories.md results |
| Filter by multiple filenames | Search with `["summary.md", "README.md"]` |
| No filter returns all | Search without filter, verify mixed results |

**Verify:** `npm test` passes, `cargo test` passes.

---

## Phase 4: Re-Index Button

### Step 4.1: Add re-index Tauri command

**File:** `src-tauri/src/lib.rs`

Add a `reindex_folder` command that:

- Accepts a folder name
- Lists all files in the folder
- Re-indexes each file via the existing indexing pipeline (delete old chunks, re-chunk, re-embed, store)

### Step 4.2: Add re-index function to TypeScript

**File:** `src/lib/research-search.ts` (or a new file)

- `reindexFolder(folderName: string)` — calls the Tauri command
- Returns progress/result

### Step 4.3: Add re-index button to UI

Find the research folder context menu component and add a "Re-index" button:

- Calls `reindexFolder()` when clicked
- Shows a loading state while indexing
- Shows success/failure feedback

### Step 4.4: Write tests

| Test | Approach |
|------|----------|
| Re-index command calls indexing for each file | Mock Rust command, verify all files indexed |
| Re-index button in UI | Component test verifying button renders and calls function |

**Verify:** `npm test` passes, `cargo test` passes, manual test with the desktop app.

---

## File Summary

### New Files

| File | Phase | Purpose |
|------|-------|---------|
| `src/lib/memory-agent-prompt.md` | 1 | Extraction prompt for the memory agent |
| `src/lib/memory-agent.ts` | 1 | Memory extraction + storage logic |
| `src/lib/retrieval-agent-prompt.md` | 2 | Prompt for the retrieval sub-agent |
| `src/lib/retrieval-agent.ts` | 2 | Retrieval sub-agent (search + evaluation) |
| `src/lib/__tests__/memory-agent.test.ts` | 1 | Memory agent tests |
| `src/lib/__tests__/retrieval-agent.test.ts` | 2 | Retrieval agent tests |

### Modified Files

| File | Phase | Changes |
|------|-------|---------|
| `src/lib/system-prompt.md` | 1 | Add canonical files, remove old names |
| `src/lib/transport/index.ts` | 1, 2 | Integrate memory agent + retrieval agent |
| `src/lib/transport/guarded-stream.ts` | 2 | Add memories to `buildSystemPrompt()` |
| `src/lib/research-search.ts` | 3 | Add `filenames` option |
| `src-tauri/src/research_search/search.rs` | 3 | Add filename filter |
| `src-tauri/src/lib.rs` | 3, 4 | Add filenames param + reindex command |
| `src/lib/__tests__/direct-transport.test.ts` | 1 | Memory agent integration tests |
| `src/lib/__tests__/transport-guardrails.test.ts` | 2 | Memory injection tests |

### Removed Files

| File | Phase | Reason |
|------|-------|--------|
| `src/lib/research-relevance-evaluator/index.ts` | 2 | Replaced by retrieval sub-agent |
| `src/lib/research-relevance-evaluator/prompt.md` | 2 | Replaced by retrieval sub-agent prompt |
