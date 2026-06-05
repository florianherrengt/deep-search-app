# Research Folder Lifecycle Rework

Design spec for fixing the double-creation bug and restructuring the research folder creation flow.

## Problem

`DirectTransport.sendMessages()` eagerly creates a research folder on the first user message, before checking for existing research. When the AI later runs `search_research`, it finds the folder that was just created and treats it as "previous research" — a false positive. This causes the AI to ask "switch to existing?" every session.

The current flow is:

```
User sends message → folder created immediately → AI starts → AI searches → finds folder just created → false "existing research" hit
```

## New Flow

```
User sends first message
  │
  ▼
DirectTransport.sendMessages()
  │
  ├─ 1. Run semantic search (Rust backend) using raw user query
  │     Returns matching folders with scores
  │
  ├─ 2. Pass results as context to the AI stream
  │     │
  │     ├─ If results found: AI asks user via tool
  │     │   "Found existing research: X. Continue or start fresh?"
  │     │   ├─ "Continue" → switch_research_folder → done, no new folder
  │     │   └─ "Fresh" → fall through to step 3
  │     │
  │     └─ If no results: fall through to step 3
  │
  ├─ 3. LLM generates folder name (existing generateResearchFolder logic)
  │     Check disk for name collision
  │     If collision → append date: <name>-YYYY-MM-DD
  │     If still collision → append counter: <name>-YYYY-MM-DD-2
  │
  ├─ 4. Create folder (write README, register in SQLite, index)
  │
  └─ 5. AI proceeds with tools as normal
```

## Changes

### A. Remove eager folder creation from `DirectTransport.sendMessages()`

**File:** `src/lib/transport/index.ts`

Remove the `generateResearchFolder()` call from `sendMessages()` (lines 52-60). The folder should not be created until a tool actually needs it.

Keep the `saveResearchChatMessages()` call but defer it — chat messages can only be saved once a folder exists. If no folder exists yet, skip the save. The chat will be saved later when the folder is created (via the `onResearchFolderChange` callback or in the chat `onFinish` handler).

### B. Add upfront search in `DirectTransport.sendMessages()`

**File:** `src/lib/transport/index.ts`

Before starting the AI stream, call `searchResearch()` (the existing wrapper around the Rust `search_research` command) with the user's first message text. Pass the results into the stream as part of the initial context so the AI can see them and ask the user.

This uses the existing full semantic search pipeline (embeddings + FTS5 + RRF + reranking) already implemented in the Rust backend.

The search results are injected as a system message or tool result in the conversation context before the AI starts, so the AI can decide whether to ask the user about continuing existing research.

### C. Add date-on-collision to `generateResearchFolder()`

**File:** `src/lib/transport/research-folder.ts`

After the LLM generates the folder name, check the filesystem for name collisions using `listAppSubfolders("search-results")`. If the name already exists:

1. Append today's date: `<name>-YYYY-MM-DD`
2. If that also exists, append a counter: `<name>-YYYY-MM-DD-2`, `-3`, etc.

The LLM naming and folder creation logic otherwise stays the same.

### D. Keep lazy `getResearchFolder` in `guarded-stream.ts`

**File:** `src/lib/transport/guarded-stream.ts`

The existing lazy `getResearchFolder` callback (lines 66-85) stays as-is. It calls `generateResearchFolder()` only when a tool first needs a folder (e.g., `save_research_file`). By this point:

- The upfront search has already run
- The AI has already had a chance to ask the user and switch to an existing folder
- If the AI didn't switch, a new folder gets created with collision-safe naming

### E. Update system prompt

**File:** `src/lib/transport/system-prompt.md`

Add instructions telling the AI that search results for existing research are provided in the initial context. If matches are found, the AI should ask the user whether to continue that research or start fresh before saving any files.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/transport/index.ts` | Remove eager `generateResearchFolder()`, add upfront `searchResearch()` call |
| `src/lib/transport/research-folder.ts` | Add date-on-collision logic after LLM naming |
| `src/lib/transport/system-prompt.md` | Add instructions about upfront search results |
| `src/lib/transport/guarded-stream.ts` | No structural changes (lazy creation stays) |

## Unchanged

- Rust backend (search pipeline, indexing, folder registration)
- `search_research` tool definition
- `switch_research_folder` tool definition
- `save_research_file` tool definition
- `extract_page_content` tool definition
- Research history (`research-history.ts`)
- UI components
