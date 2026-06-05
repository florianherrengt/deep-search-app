# Research Relevance Evaluator — Implementation Plan

## Step 1: Create evaluator prompt

**File:** `src/lib/research-relevance-evaluator/prompt.md`

Write the system prompt for the evaluator sub-agent. It instructs the model to:
- Evaluate candidate research folders against the user's query
- Follow the cascade: summary.md → README.md → chunk snippets → other files
- Stop reading as soon as it can decide
- Return only relevant folder names, one per line
- Return empty if none are relevant

**Verify:** Read the file and confirm it covers all cascade steps and the output format.

## Step 2: Create evaluator module

**File:** `src/lib/research-relevance-evaluator/index.ts`

Implement `evaluateResearchRelevance(query, results, model, getResearchFolder, abortSignal)`:
1. Group `SearchResult[]` by `folder_name`
2. Build the user prompt with per-folder snippets (top 2-3 chunks, truncated to 300 chars)
3. Create scoped `list_files` and `read_file` tools (inline, not from file-tools.ts):
   - `list_files(folder)` — calls `listAppFiles` for `search-results/<folder>`, rejects folders not in candidate set
   - `read_file(folder, filename)` — calls `readAppFile` for `search-results/<folder>/<filename>`, rejects folders not in candidate set, returns null for missing files
4. Call `generateText()` with the evaluator prompt, user prompt, and scoped tools
5. Parse the output: split by newlines, trim, filter to only known folder names
6. Return filtered `SearchResult[]` (all chunks from relevant folders)
7. On any error, return the original unfiltered results

**Verify:** Read the file. Confirm it imports from `ai` (generateText), `@/lib/app-file-storage` (readAppFile, listAppFiles), `@/lib/research-search` (SearchResult), and the prompt via `?raw`.

## Step 3: Modify search-research-tool

**File:** `src/tools/search-research-tool.ts`

1. Change `createSearchResearchTool(apiKey)` to `createSearchResearchTool(apiKey, model, getResearchFolder)`
2. Import `evaluateResearchRelevance` from the new module
3. After `searchResearch()` returns, call `evaluateResearchRelevance(query, results, model, getResearchFolder, options?.abortSignal)`
4. If evaluator returns filtered results, use those; otherwise use unfiltered
5. Deduplicate by folder name as before, return `{ folder_name }[]`

**Verify:** Read the diff. Confirm the function signature changed, the evaluator is called, and fallback works.

## Step 4: Modify tool-registry

**File:** `src/lib/transport/tool-registry.ts`

Line 71: Change `createSearchResearchTool(apiKey)` to `createSearchResearchTool(apiKey, model, getResearchFolder)`.

**Verify:** Read line 71. Confirm both `model` and `getResearchFolder` are passed.

## Step 5: Modify upfront search flow

**File:** `src/lib/transport/index.ts`

1. Import `evaluateResearchRelevance` from the new module
2. After `searchResearch()` at ~line 99, call the evaluator on the raw results before setting `upfrontSearchResults`
3. Wrap in try/catch — on failure, use unfiltered results
4. `waitingForExistingResearchChoice` should only be `true` if filtered results are non-empty

**Verify:** Read the modified section. Confirm evaluator is called, try/catch wraps it, and the conditional flow is correct.

## Step 6: Build and test

1. Run `npm run build` to verify TypeScript compilation
2. Run `npm test` to check for regressions
3. Run `cargo test` in `src-tauri/` to verify no Rust regressions (no Rust changes expected, but verify)

**Verify:** All commands pass with no errors.

## Dependency Order

Steps 1-2 must be done first (new files). Steps 3-5 can be done in parallel after that. Step 6 is last.

```
Step 1 (prompt) ──┐
Step 2 (module) ───┤
                   ├── Step 3 (tool) ──┐
                   ├── Step 4 (registry)┤── Step 6 (build)
                   ├── Step 5 (transport)┘
```

## Estimated Scope

| Step | Files | Lines (approx) |
|------|-------|----------------|
| 1 | 1 new | ~30-40 |
| 2 | 1 new | ~80-120 |
| 3 | 1 modified | ~15 changed |
| 4 | 1 modified | ~1 changed |
| 5 | 1 modified | ~15 changed |
| 6 | 0 | 0 |
| **Total** | **2 new + 3 modified** | **~140-190** |
