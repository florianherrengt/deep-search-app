# Disambiguate Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `duckduckgo_instant_answer` tool with a `disambiguate` tool that uses a sub-agent to extract entities then resolves each via DDG, returning plain text.

**Architecture:** Single tool `disambiguate` that takes a question, runs `generateObject` to extract entities with compact search hints, calls DDG Instant Answer API for each entity, and returns formatted text. Empty string if nothing ambiguous.

**Tech Stack:** Vercel AI SDK (`tool`, `zodSchema`, `generateObject`, `LanguageModel`), Zod, Bottleneck, `@tauri-apps/plugin-http`

---

### Task 1: Create the disambiguate tool

**Files:**
- Create: `src/tools/disambiguate-tool.ts`
- Reference: `src/tools/duckduckgo-instant-answer-tool.ts` (DDG API logic to reuse)
- Reference: `src/tools/research-checkpoint-tool.ts` (sub-agent pattern to follow)

- [ ] **Step 1: Create `src/tools/disambiguate-tool.ts` with entity extraction schema and DDG resolution**

```ts
import { tool, zodSchema, generateObject, type LanguageModel } from "ai";
import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import Bottleneck from "bottleneck";

const API_URL = "https://api.duckduckgo.com/";
const MAX_RELATED_TOPICS = 8;

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

const OptionalStringSchema = z.string().nullable().optional();

const ExtractedEntitySchema = z.object({
  term: z.string().describe("The entity name, e.g. 'Steam Machine'"),
  searchHint: z
    .string()
    .describe("Compact DDG-friendly query, e.g. 'Steam Machine Valve'"),
});

const ExtractedEntitiesSchema = z.object({
  entities: z.array(ExtractedEntitySchema),
});

const DuckDuckGoResponseSchema = z
  .object({
    Heading: OptionalStringSchema,
    AbstractText: OptionalStringSchema,
    Definition: OptionalStringSchema,
    Answer: OptionalStringSchema,
    Type: OptionalStringSchema,
    RelatedTopics: z.array(z.unknown()).optional().default([]),
  })
  .passthrough();

const DuckDuckGoRelatedTopicSchema = z
  .object({
    Text: OptionalStringSchema,
    Topics: z.array(z.unknown()).optional(),
  })
  .passthrough();

function cleanString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function flattenRelatedTopicText(relatedTopics: unknown[]): string[] {
  const flattened: string[] = [];

  function visit(topic: unknown) {
    const parsed = DuckDuckGoRelatedTopicSchema.safeParse(topic);
    if (!parsed.success) return;

    const text = cleanString(parsed.data.Text);
    if (text) {
      flattened.push(text);
    }

    for (const child of parsed.data.Topics ?? []) {
      visit(child);
    }
  }

  for (const topic of relatedTopics) {
    visit(topic);
  }

  return flattened;
}

async function fetchDuckDuckGo(query: string): Promise<string> {
  return limiter.schedule(async () => {
    const url = new URL(API_URL);
    url.searchParams.set("q", query.trim());
    url.searchParams.set("format", "json");
    url.searchParams.set("no_redirect", "1");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "0");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      return "";
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      return "";
    }

    const parsed = DuckDuckGoResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return "";
    }

    const data = parsed.data;
    const lines: string[] = [];

    const heading = cleanString(data.Heading);
    const abstract = cleanString(data.AbstractText);
    const definition = cleanString(data.Definition);
    const answer = cleanString(data.Answer);

    if (heading) lines.push(heading);
    if (abstract) lines.push(abstract);
    if (definition && definition !== abstract) lines.push(definition);
    if (answer && answer !== abstract && answer !== definition)
      lines.push(answer);

    const related = flattenRelatedTopicText(data.RelatedTopics)
      .slice(0, MAX_RELATED_TOPICS)
      .filter((t) => !lines.includes(t));
    if (related.length > 0) {
      lines.push("Related: " + related.join(", "));
    }

    return lines.join("\n");
  });
}

async function extractEntities(
  model: LanguageModel,
  question: string,
): Promise<z.infer<typeof ExtractedEntitiesSchema>> {
  const { object } = await generateObject({
    model,
    schema: zodSchema(ExtractedEntitiesSchema),
    system:
      "You identify entities, concepts, acronyms, products, people, places, organizations, and ambiguous terms in a question. For each one, provide a compact search hint suitable for a knowledge lookup API (not a full question). If nothing in the question is ambiguous, unclear, or requires external context, return an empty list. Do not include common words, verbs, or question words.",
    prompt: question,
  });
  return ExtractedEntitiesSchema.parse(object);
}

export function createDisambiguateTool(model: LanguageModel) {
  return tool({
    description:
      "Identify and resolve ambiguous entities, concepts, acronyms, and terms in a question. Returns concise descriptions and related context from DuckDuckGo. Pass the user's question as-is. Returns empty text if nothing needs disambiguation.",
    strict: true,
    inputSchema: zodSchema(
      z.object({
        question: z
          .string()
          .describe("The user's question to disambiguate"),
      }),
    ),
    outputSchema: zodSchema(z.string()),
    execute: async ({ question }) => {
      const { entities } = await extractEntities(model, question);
      if (entities.length === 0) return "";

      const results: string[] = [];
      for (const entity of entities) {
        const ddgResult = await fetchDuckDuckGo(entity.searchHint);
        if (ddgResult) {
          results.push(ddgResult);
        }
      }

      return results.join("\n\n");
    },
  });
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/tools/disambiguate-tool.ts 2>&1 | head -20`

Check for import errors or type mismatches. Fix any issues.

- [ ] **Step 3: Commit**

```bash
git add src/tools/disambiguate-tool.ts
git commit -m "feat: add disambiguate tool with sub-agent entity extraction"
```

---

### Task 2: Wire up the new tool in transport

**Files:**
- Modify: `src/lib/transport.ts:20` (remove old import)
- Modify: `src/lib/transport.ts:89` (remove old tool, add new)

- [ ] **Step 1: Replace the DDG import with disambiguate import**

In `src/lib/transport.ts`, remove line 20:
```
import { duckDuckGoInstantAnswerTool } from "@/tools/duckduckgo-instant-answer-tool";
```

Add:
```ts
import { createDisambiguateTool } from "@/tools/disambiguate-tool";
```

- [ ] **Step 2: Replace the tool in `createTools`**

In the `createTools` function, remove:
```ts
duckduckgo_instant_answer: duckDuckGoInstantAnswerTool,
```

Add:
```ts
disambiguate: createDisambiguateTool(model),
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add src/lib/transport.ts
git commit -m "feat: wire up disambiguate tool, remove duckduckgo_instant_answer"
```

---

### Task 3: Update the system prompt

**Files:**
- Modify: `src/lib/system-prompt.md:11-17` (Clarify section)

- [ ] **Step 1: Replace the Clarify section**

In `src/lib/system-prompt.md`, replace lines 11-17:

```
**Clarify**

- First run `duckduckgo_instant_answer` as a quick semantic understanding check on the user's main topic. This is not a search engine, does not return ranked results, and should not be used to answer the user.
- Prefer compact keyword queries such as entity names, acronyms, product names, people, places, organizations, or topic phrases, not full natural-language research questions.
- Use its concise text to identify likely meanings, canonical terminology, related entities, and possible follow-up query angles for the real search tools. If it returns empty text, treat that as normal and do not mention it to the user.
- Then use `ask_questions` to narrow scope, intent, and output format before running the main search tools.
- Ask again later if ambiguity remains.
```

With:

```
**Clarify**

- First run `disambiguate` on the user's question to identify and resolve key concepts, entities, acronyms, and ambiguous terms.
- An empty result means nothing is ambiguous — proceed directly to search.
- Use the resolved descriptions and related terms to formulate better search queries for the real search tools.
- Then use `ask_questions` to narrow scope, intent, and output format before running the main search tools.
- Ask again later if ambiguity remains.
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/system-prompt.md
git commit -m "feat: update system prompt for disambiguate tool"
```

---

### Task 4: Delete the old DDG tool

**Files:**
- Delete: `src/tools/duckduckgo-instant-answer-tool.ts`

- [ ] **Step 1: Verify no remaining imports**

Run: `grep -r "duckduckgo-instant-answer-tool\|duckDuckGoInstantAnswerTool\|duckduckgo_instant_answer" src/ --include="*.ts" --include="*.tsx" -l`

Expected: no results (all references removed in Tasks 2 and 3).

- [ ] **Step 2: Delete the file**

```bash
git rm src/tools/duckduckgo-instant-answer-tool.ts
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: remove old duckduckgo_instant_answer tool"
```

---

### Task 5: Run full type check and tests

**Files:**
- None (verification only)

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`

Expected: clean, no errors.

- [ ] **Step 2: Run tests**

Run: `npx vitest run 2>&1 | tail -30`

Expected: all existing tests pass. No new tests needed since the DDG tool had no tests.

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address typecheck/test issues from disambiguate tool migration"
```
