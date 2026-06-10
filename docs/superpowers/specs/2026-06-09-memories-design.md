# Memories Feature Design

Date: 2026-06-09
Status: Approved
Supersedes: `docs/how-memories-work.md` (original spec — this doc reflects the simplified architecture agreed during brainstorming)

## Overview

Deep Search will remember stable personal facts and preferences about the user across research sessions. Memories are extracted by a dedicated memory agent, stored as simple text in per-folder `memories.md` files, and retrieved by a retrieval sub-agent that also handles previous-research lookup.

The system prompt is also updated to define two other canonical living documents — `README.md` and `summary.md` — that the research agent updates incrementally as it learns.

## Architecture

### Components

| Component | Responsibility | Trigger |
|-----------|---------------|---------|
| **Memory agent** | Extracts personal facts from each user message | Every user message, in parallel with main agent |
| **Retrieval sub-agent** | Generates search queries, searches previous research + memories, returns relevant folders and memories | Every new chat (first message) |
| **System prompt** | Updated to define canonical files and remove old tool names | Static (updated in Phase 1) |

### Data Flow

```
User message arrives
├── Provisional folder created (existing flow)
├── Memory agent fires (parallel)
│   ├── Receives user message text only
│   ├── Extracts facts via generateText() → string[]
│   ├── Reads existing memories.md
│   ├── Merges, deduplicates, rewrites memories.md
│   └── File auto-indexed via existing pipeline
│
└── Retrieval sub-agent fires (parallel)
    ├── Receives user message text
    ├── Generates multiple search queries
    ├── Calls searchResearch() with those queries
    ├── Evaluates results
    └── Returns { relevant_folders, relevant_memories }
        ├── relevant_folders → "continue or start fresh?" question (existing behavior)
        └── relevant_memories → injected into system prompt silently
```

---

## Phase 1: Memory Agent + Prompt Updates

### Memory Agent

**New file:** `src/lib/memory-agent.ts`

A lightweight agent that runs on every user message, in parallel with the main research agent.

**Input:** The raw user message text only (not full conversation).

**Process:**

1. Call `generateText()` with a focused extraction prompt
2. Prompt instructs: extract stable personal facts/preferences, be conservative, skip task-specific details, skip sensitive info, skip weak inferences
3. Returns `string[]` of facts — e.g. `["User has a dog.", "User prefers car-free travel."]`
4. Reads existing `memories.md` from the active research folder
5. Merges new facts with existing, deduplicates, rewrites the whole file
6. File gets auto-indexed via existing `writeAppFile()` + `indexResearchFile()` pipeline

**Timing:** Runs after the provisional folder is created. Non-blocking — if extraction fails, the main agent continues unaffected.

**memories.md format:**

```md
# Memories

- User has a dog.
- User prefers car-free travel options.
- User uses macOS.
```

Simple list. No IDs, no categories, no metadata. Just the facts.

**Integration point:** `src/lib/transport/index.ts` — in `DirectTransport.sendMessages()`, after the provisional folder is created (around line 91-126), fire the memory agent alongside the existing previous-research lookup.

**Extraction prompt** (lives in `src/lib/memory-agent-prompt.md`, imported via `?raw`):

```text
You are a memory extraction agent. Your job is to read a user message and extract
stable, reusable personal facts and preferences about the user.

Rules:
- Only extract facts that are likely to remain true beyond this session.
- Only extract things about the user, not about the topic being researched.
- Skip task-specific details ("User is researching backpacks").
- Skip weak inferences ("User probably likes camping").
- Skip conversational details ("User said hello").
- Skip sensitive information (API keys, passwords, medical details, financial info).
- When uncertain, do not extract.
- Return a JSON array of strings, each being one atomic fact.

Examples:
- "I have a dog" → ["User has a dog."]
- "I'm on macOS, please use EUR" → ["User uses macOS.", "User prefers prices in EUR."]
- "Find me a good tent" → []
- "Thanks, that's helpful" → []
```

### System Prompt Updates

**File:** `src/lib/system-prompt.md`

Changes:

1. **Add canonical files section** — define `README.md` and `summary.md` as living documents the agent updates incrementally as research progresses (not dumped at the end)
2. **Remove** example filenames like `brave-initial.md`, `tavily-followup.md`
3. **Keep** working notes guidance (`notes.md`, `sources.md`, `open-questions.md`, etc.)
4. **Fix** any old tool name references (check for `save_research_file`, `read_research_file`, `list_research_files`)

**README.md expectations** (in prompt):
- Title, answer/recommendation, key findings, evidence with URLs, confidence, open questions, last updated
- Updated incrementally as the agent learns, not just at the end
- No credentials or API keys

**summary.md expectations** (in prompt):
- Research scope, final answer, search keywords, key decisions, source quality, reuse guidance
- Updated incrementally alongside README.md

---

## Phase 2: Retrieval Sub-Agent

Replaces the current upfront search + separate relevance evaluator with a single, smarter retrieval sub-agent.

**New files:**
- `src/lib/retrieval-agent.ts` — the sub-agent
- `src/lib/retrieval-agent-prompt.md` — its prompt (imported via `?raw`)

**Trigger:** On every new chat (first message), replaces the existing previous-research lookup in `DirectTransport.sendMessages()`.

**Process:**

1. Receives the user's message text
2. Generates multiple search queries (not just passes the raw text)
3. Calls `searchResearch()` with those queries
4. Evaluates results — decides which folders are relevant and which memories are relevant
5. Returns structured output:

```ts
{
  relevant_folders: Array<{ folder_name: string }>;
  relevant_memories: Array<{ memory: string }>;
}
```

**Has scoped tools:**
- Scoped `searchResearch()` — the agent generates queries and searches
- Optionally scoped `list_files`/`read_file` to peek into candidate folders (same pattern as existing relevance evaluator)

**Has its own prompt** defining:
- How to generate good search queries from a user message
- What makes previous research relevant
- What makes a memory relevant: "Would this memory materially improve the answer?"
- Memory relevance rule: semantic similarity is not enough; the memory must affect the answer

**Output handling:**

| Output | Where it goes |
|--------|--------------|
| `relevant_folders` | Triggers the existing "continue or start fresh?" question |
| `relevant_memories` | Injected into system prompt via new section in `buildSystemPrompt()` |

**System prompt injection format:**

```md
## Relevant user memories

The following stored memories may help answer this request. Use them only if they remain relevant after reading the user's latest message. Current user instructions override these memories.

- User has a dog.
- User prefers car-free travel options.
```

**Key rule:** Memory matches never trigger the "continue previous research?" question. That's only for research folder matches.

**Integration point:** `src/lib/transport/guarded-stream.ts` — add a `relevantMemories` parameter to `buildSystemPrompt()`, similar to how `upfrontSearchResults` is handled.

**Replaces:** The existing `evaluateResearchRelevance()` function and `src/lib/research-relevance-evaluator/` — the retrieval sub-agent handles both research relevance and memory relevance.

---

## Phase 3: Filename Filter in Rust Backend

Optional optimization — allows the retrieval sub-agent to pass `filenames: ["memories.md"]` for memory-only searches, improving recall by not crowding Top-K results with research notes.

**Changes:**

| File | Change |
|------|--------|
| `src/lib/research-search.ts` | Add `filenames?: string[]` to options and invoke payload |
| `src-tauri/src/lib.rs` | Add `filenames: Option<Vec<String>>` to `search_research` command |
| `src-tauri/src/research_search/search.rs` | Filter candidates by filename after KNN/FTS retrieval and before MMR/rerank |

**Benefit:** The retrieval sub-agent can issue a focused memory search alongside the broader research search, getting better recall for memories without mixing in working notes.

---

## Phase 4: Re-Index Button

A manual "re-index" button in the research folder context menu that re-indexes all files in a folder, including `memories.md`.

**Why:** If memories.md files were written before the memory agent existed, or if indexing failed, users need a way to trigger re-indexing manually rather than automatic migration.

**Scope:**

| Task | Details |
|------|---------|
| Add re-index button to folder context menu | UI button in the research library |
| Implement re-index action | Re-chunk, re-embed, and re-index all files in the selected folder |
| Wire up to existing indexing pipeline | Reuse `indexResearchFile()` for each file in the folder |

---

## What Changed From the Original Spec

| Original Spec | This Design | Why |
|---------------|-------------|-----|
| `finalize_research` tool | No new tool — existing file tools + prompt | Simpler; model already has write/update tools |
| Main agent extracts memories at finalization | Dedicated memory agent runs on every message | Separation of concerns; real-time capture |
| Structured memories (category, source, confidence, etc.) | Simple `string[]` of facts | Trust the model; keep storage simple |
| Per-folder `memories.md` with metadata | Per-folder `memories.md` as plain list | Same storage, simpler format |
| Global memory DB (Phase 4) | Re-index button instead | Manual migration; less complexity |
| Separate memory relevance evaluator | Combined retrieval sub-agent handles both | One agent, one LLM call, both outputs |
| Safety filter on memories (regex for secrets) | Prompt-guided only | Simpler; extraction prompt handles it |

---

## Test Plan

### Phase 1 Tests

| Test | Expected |
|------|----------|
| Memory agent extracts facts from explicit statement | Returns `["User has a dog."]` for "I have a dog" |
| Memory agent skips task-specific details | Returns `[]` for "Find me a good tent" |
| Memory agent skips sensitive info | Returns `[]` for message containing API key |
| memories.md created when folder has none | New file with extracted facts |
| memories.md merged when file exists | New facts appended, duplicates removed |
| Memory agent failure doesn't block main agent | Main agent continues if extraction fails |

### Phase 2 Tests

| Stored Memory | Query | Expected |
|---------------|-------|----------|
| `User has a dog.` | `Find dog-friendly hikes` | Inject memory |
| `User has a dog.` | `Compare USB-C docks` | Do not inject |
| `User uses macOS.` | `Set up this tool locally` | Inject memory |
| `User prefers EUR.` | `Compare prices` | Inject memory |
| `User prefers EUR.` | `Explain attention mechanism` | Do not inject |
| Memory only match | No research folder match | No "continue folder?" question |
| Search fails | Any query | Main agent continues normally |

### Phase 3 Tests

| Test | Expected |
|------|----------|
| `filenames: ["memories.md"]` filter | Only memories.md chunks returned |
| `filenames: ["summary.md", "README.md"]` | Only those files returned |
| No filenames filter | All files searched (backward compat) |

### Phase 4 Tests

| Test | Expected |
|------|----------|
| Re-index button triggers indexing | All files in folder re-indexed |
| Re-index updates search results | Memories become searchable after re-index |
