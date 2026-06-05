# Research Relevance Evaluator

## Problem

When the model searches previous research — either via the automatic upfront search or the `search_research` tool — it cannot properly evaluate whether the results are relevant to the current query. Two symptoms:

1. **Upfront search** injects minimal data (folder name + score + 200-char snippet) into the system prompt. The model sees noisy, low-relevance results and either continues irrelevant research or gets confused.
2. **`search_research` tool** returns only deduplicated folder names with no scores, snippets, or content. The model has nothing to evaluate relevance with.

The Rust backend already has a 5-stage relevance pipeline (KNN vector search, FTS5, adaptive RRF, MMR dedup, Cohere reranker with a 0.5 threshold). But this pipeline matches on chunk-level content similarity — it cannot determine whether an entire research folder's *topic and scope* aligns with the user's current question.

## Solution

A multi-step LLM sub-agent that explores candidate research folders and filters out irrelevant ones before the main model sees them. The evaluator follows a cascading exploration strategy per folder — reading the minimum needed to decide relevance — and returns only the folder names that are genuinely relevant.

## Architecture

```
User query
  → searchResearch() → raw SearchResult[]
  → group by folder_name → candidate folders
  → Relevance Evaluator sub-agent:
      For each candidate folder:
        1. Read summary.md (if exists) — usually enough
        2. Read README.md (if needed) — research plan/overview
        3. Use chunk snippets from search results (if needed)
        4. Read 1-2 key research files (if still uncertain)
        → Decide: relevant or not
  → Return filtered folder names
  → Upfront: inject only relevant folders into system prompt
  → Tool: return only relevant folders to model
```

## Components

### 1. Evaluator Prompt — `src/lib/research-relevance-evaluator/prompt.md`

Dedicated system prompt for the evaluator sub-agent, stored as a separate file for independent tuning. Imported via `?raw` suffix (same pattern as `system-prompt.md?raw`).

The prompt instructs the evaluator to:
- Evaluate whether each candidate research folder is relevant to the user's query
- For each folder, read the minimum needed to decide, following the cascade: `summary.md` → `README.md` → chunk snippets → other files
- Return only the folder names that are relevant, one per line, as plain text
- If none are relevant, return empty output
- Be conservative: keep folders that might be useful, drop only clearly unrelated ones

### 2. Evaluator Module — `src/lib/research-relevance-evaluator/index.ts`

Main export: `evaluateResearchRelevance(query, results, model, getResearchFolder, abortSignal)`

Implementation:
- Groups raw `SearchResult[]` by `folder_name` to get candidate folders
- Uses `generateText()` (Vercel AI SDK) with the evaluator prompt and a read-only file tool
- The file tool is scoped to the research folders being evaluated — it can only read files within those specific folders
- Provides the search result snippets as context in the prompt so the evaluator has the chunk-level data without needing to read files in many cases
- Returns `string[]` — list of relevant folder names (a subset of the input folder names)

Tools provided to the evaluator:
- `list_files` — takes a folder name, returns the list of files in that folder. Calls `listAppFiles()` with the correct subfolder path (`search-results/<folder>`).
- `read_file` — takes a folder name and filename, returns file content or null if the file doesn't exist. Internally calls `readAppFile()` with the correct subfolder path.
- Both tools are scoped to candidate folders only — they reject reads from folders not in the candidate set.
- Both tools are created inline (not from `file-tools.ts`) to keep them scoped and simple.

### 3. Modified: `src/tools/search-research-tool.ts`

- `createSearchResearchTool` now accepts `model` and `getResearchFolder` as additional parameters (same pattern as `createResearchCheckpointTool(model)`)
- After `searchResearch()` returns raw results, calls `evaluateResearchRelevance()` to filter
- Returns `{ folder_name }[]` as before, but only for folders that passed evaluation
- On evaluator failure, falls through with unfiltered results — never blocks the main flow

### 4. Modified: `src/lib/transport/index.ts`

- In the upfront search flow (~line 99), after `searchResearch()` returns, calls `evaluateResearchRelevance()` before setting `upfrontSearchResults`
- Only sets `waitingForExistingResearchChoice = true` if filtered results are non-empty
- If no folders survive evaluation, proceeds directly to `finalizeProvisionalFolder()` (same as if no results were found)
- On evaluator failure, falls through with unfiltered results

### 5. Modified: `src/lib/transport/tool-registry.ts`

- Passes `model` and `getResearchFolder` to `createSearchResearchTool()` (line 71)

### 6. Unchanged: `src/lib/system-prompt.md`

No changes needed. The model now only sees relevant folders, so it doesn't need additional instructions about evaluating relevance.

## Evaluator Prompt Design

The prompt receives:
- The user's query
- The grouped folder data: for each folder, its name and the top 2-3 chunk snippets (truncated to 300 chars each, from the search results)

The evaluator uses `list_files` and `read_file` tools to explore folders when snippets are insufficient.

Example evaluator output for 3 candidates:
```
pricing-analysis-2026-03
ai-framework-comparison-2025-11
```

(Only 2 of 3 folders deemed relevant.)

## Implementation Notes

### Tool scoping

The evaluator's `read_file` tool should only allow reading files within the candidate folders. It validates that the requested folder is in the candidate set before reading.

### Cascade stopping

The evaluator prompt instructs the model to stop reading as soon as it has enough information. If `summary.md` makes it clear the folder is (or isn't) relevant, no further reads are needed. This minimizes latency and token cost.

Note: `summary.md` is not a guaranteed file — it's a convention that some research folders may have. The evaluator's `read_file` tool returns `null` for missing files, and the prompt instructs the evaluator to move to the next fallback. `README.md` is the standard file created by `create_research_plan`, so it's the most reliable source of folder scope.

### Cancellation

The evaluator respects the abort signal. If the user cancels or the search is aborted, the evaluator stops and the unfiltered results are returned.

### Sub-agent pattern

Follows the same `generateText()` pattern as `research-checkpoint-tool.ts` (line 30) and `verified-research-tool.ts` (line 104). No streaming needed — the evaluator returns a single text response.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Evaluator model call fails | Return unfiltered results |
| Evaluator times out | Return unfiltered results |
| File read fails | Evaluator proceeds with available data |
| Abort signal fires | Return unfiltered results |
| No candidate folders | Skip evaluation, return empty |

## Token/Latency Estimate

| Metric | Estimate |
|--------|----------|
| Evaluator system prompt | ~300 tokens |
| Per-folder context (snippets + file names) | ~150-300 tokens |
| File reads (summary.md, README.md) | ~200-500 tokens each |
| Evaluator output | ~50-100 tokens |
| Total per evaluation (5 folders) | ~1000-3000 tokens |
| Added latency | ~2-5 seconds |

The cost is minimal compared to the main research flow, and it prevents the model from spending many more tokens continuing irrelevant research.

## Files Changed

| File | Action |
|------|--------|
| `src/lib/research-relevance-evaluator/prompt.md` | New |
| `src/lib/research-relevance-evaluator/index.ts` | New |
| `src/tools/search-research-tool.ts` | Modified (add model + getResearchFolder params, call evaluator) |
| `src/lib/transport/index.ts` | Modified (call evaluator on upfront results) |
| `src/lib/transport/tool-registry.ts` | Modified (pass model + getResearchFolder to search research tool) |

## Out of Scope

- Changes to the Rust search pipeline (the backend already has sophisticated retrieval)
- Changes to the system prompt (not needed when filtering works)
- Pre-filtering by score threshold (the evaluator handles this more accurately)
- Caching evaluator results (can be added later if needed)
