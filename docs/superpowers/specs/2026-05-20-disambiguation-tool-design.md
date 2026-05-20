# Disambiguation Tool Design

## Problem

The agent uses `duckduckgo_instant_answer` poorly. Instead of extracting entities and resolving them, it passes full questions or near-full questions. The tool also flattens DDG responses into unstructured text, losing the distinction between "this is a disambiguation page" vs "this is a known entity with a clear description."

Example: "When will the Steam Machine be released?" should resolve "Steam Machine" → "A series of small form factor gaming computers by Valve" so the agent can formulate better search queries. Instead the agent sends the whole question and gets noise.

## Solution

Replace `duckduckgo_instant_answer` with a single `disambiguate` tool that internally runs a sub-agent to extract entities from the user's question, then resolves each one via DDG Instant Answer, returning structured results.

The agent makes one tool call. The tool does the rest.

## Changes

### 1. Delete `duckduckgo-instant-answer-tool.ts`

Remove entirely.

### 2. New file: `src/tools/disambiguate-tool.ts`

A single tool that combines entity extraction and DDG resolution. Follows the same sub-agent pattern as `research-checkpoint-tool.ts` and `extract-page-content-tool.ts`.

**Input schema:**

```ts
{
  question: string;
}
```

**Output:** plain text string. Empty string if nothing is ambiguous.

Example output for "When will the Steam Machine be released?":

```
Steam Machine — A series of small form factor gaming computers by Valve
Related: SteamOS, Valve Corporation, PC gaming console
```

**Internal flow:**

1. `generateObject` call extracts entities with a system prompt:
   > You identify entities, concepts, acronyms, products, people, places, organizations, and ambiguous terms in a question. For each one, provide a compact search hint suitable for a knowledge lookup API (not a full question). If nothing in the question is ambiguous or unclear, return an empty list.

2. If no entities extracted, return empty string immediately.

3. For each extracted entity, call DDG Instant Answer API with the `searchHint` as query.

4. Format results as readable text: term, description, related topics.

**Keep from old tool:**
- Rate limiter (1 req/s, Bottleneck)
- Fetch via Tauri HTTP plugin
- `skip_disambig=0`, `no_redirect=1`, `no_html=1`, `format=json` params

**Exported as:** `createDisambiguateTool(model: LanguageModel)` — needs model for the `generateObject` sub-agent call.

### 3. Update `transport.ts`

- Remove import of `duckDuckGoInstantAnswerTool`
- Add import of `createDisambiguateTool`
- In `createTools`, replace `duckduckgo_instant_answer` with `disambiguate: createDisambiguateTool(model)`

### 4. Update `system-prompt.md`

Replace the Clarify section's DDG instructions:

```
- First run disambiguate on the user's question to identify and resolve key concepts, entities, acronyms, and ambiguous terms.
- An empty result means nothing is ambiguous — proceed directly to search.
- Use the resolved descriptions and related terms to formulate better search queries for the real search tools.
- Then use ask_questions to narrow scope, intent, and output format before running the main search tools.
```

## Files Changed

| File | Change |
|------|--------|
| `src/tools/duckduckgo-instant-answer-tool.ts` | Delete |
| `src/tools/disambiguate-tool.ts` | New — sub-agent entity extraction + DDG resolution in one tool |
| `src/lib/transport.ts` | Update import and `createTools` |
| `src/lib/system-prompt.md` | Update Clarify section |

## Not Changed

- Agent guardrails — `disambiguate` is not in `RESEARCH_TOOL_NAMES`, guardrails are unaffected
- DDG API params — same endpoint, same rate limiting
- UI components — tool rendering uses the generic fallback which handles any tool
