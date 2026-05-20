# Disambiguation Tool Design

## Problem

The agent uses `duckduckgo_instant_answer` poorly. Instead of extracting entities and resolving them, it passes full questions or near-full questions. The tool also flattens DDG responses into unstructured text, losing the distinction between "this is a disambiguation page" vs "this is a known entity with a clear description."

Example: "When will the Steam Machine be released?" should resolve "Steam Machine" → "A series of small form factor gaming computers by Valve" so the agent can formulate better search queries. Instead the agent sends the whole question and gets noise.

An initial implementation used an LLM sub-agent (`generateObject`) to extract entities, but the LLM over-engineered the search queries (e.g. "Valve Steam Machine launch date discontinuation 2015 2018 SteamOS" instead of "Steam Machine"), producing no DDG results.

## Solution

Replace the LLM entity extraction with **compromise.js** NLP. Use `nouns()` and `topics()` to extract noun phrases and named entities from the question, then pass each directly to DDG Instant Answer.

No LLM calls. No model dependency. Deterministic. Fast.

## Changes

### 1. `src/tools/disambiguate-tool.ts`

**Rewrite** to use compromise.js instead of `generateObject`.

**Input schema:**

```ts
{
  question: string;
}
```

**Output:** plain text string. Empty string if nothing to disambiguate.

**Internal flow:**

1. Parse question with `compromise` (`nlp(question)`)
2. Extract noun phrases via `.nouns().toSingular().out('array')` — e.g. "steam machine"
3. Extract topics (people, places, organizations) via `.topics().out('array')` — e.g. "Valve"
4. Merge and deduplicate, filtering out stopwords and question words
5. If no entities, return empty string
6. For each entity, call DDG Instant Answer API with the entity term as query
7. Format results as readable text

**Dependencies:**
- `compromise` (the `two` build for POS tagging, ~225kb)
- Rate limiter (1 req/s, Bottleneck) — reused from old tool
- Fetch via Tauri HTTP plugin

**Exported as:** `disambiguateTool` — no model parameter needed.

### 2. Update `transport.ts`

- Change `disambiguate: createDisambiguateTool(model)` to `disambiguate: disambiguateTool`
- Update import

### 3. No changes to system prompt or guardrails

Already updated in previous implementation.

## Files Changed

| File | Change |
|------|--------|
| `src/tools/disambiguate-tool.ts` | Rewrite: replace generateObject with compromise.js NLP |
| `src/lib/transport.ts` | Remove model parameter from disambiguate tool call |
| `package.json` | Add `compromise` dependency |

## Not Changed

- `src/lib/system-prompt.md` — already updated
- Agent guardrails — `disambiguate` is not in `RESEARCH_TOOL_NAMES`
- DDG API integration — same endpoint, same rate limiting
- UI components — tool rendering uses the generic fallback
