# How the Research Agent Works

This document describes, in detail, how Deep Search turns a user message into a verified, cited research answer: how the agent loop is structured, how it is **forced** to plan before researching, how it is **forced** to verify before answering, and how every guardrail is enforced in code.

It is written from the implementation in:

- `src/lib/transport/` — app-level agent transport
- `src/lib/agent-guards.ts` — app-level guardrails (currency + wrapper)
- `src/lib/system-prompt.md` — workflow instructions sent to the model
- `src/tools/` — tool definitions
- `deep-search-core/research-orchestrator` — the loop, the core guards, tool-call prerequisites
- `deep-search-core/search-extract` — search providers and page extraction

---

## 1. Mental model

Deep Search is **not** a single `streamText` call with `maxSteps`. It is a custom `while` loop that:

1. Calls the model once (`streamText`, one attempt),
2. Streams tokens to the UI as they arrive,
3. When the model finishes, **evaluates the response against a set of guardrails**,
4. Either **accepts** (ends the turn) or **retries** by appending an internal user message and forcing `toolChoice`,
5. Repeats until accept, abort, or a per-guard retry limit.

Research quality is enforced through three reinforcing layers:

| Layer | What it does | Where |
|------|--------------|-------|
| **Prompt** | Tells the model the workflow it must follow. | `src/lib/system-prompt.md` |
| **Tool prerequisites** | Hides tools from the model until prior tools have run; throws if it tries to bypass that. | `deep-search-core/.../guards/tool-call-requirements.ts` |
| **Step guards** | After each model response, inspects what it did and forces a retry if it skipped plan / checkpoint / research depth. | `deep-search-core/.../guards/agent-guards.ts` + `src/lib/agent-guards.ts` |

The three layers are deliberately redundant: the prompt asks, the prerequisites block, and the guards catch anything that slips through.

---

## 2. End-to-end pipeline

```
User submits message
        │
        ▼
DirectTransport.sendMessages()                  src/lib/transport/index.ts:174
        │
        ├─ Resolve chat model (user-configurable)        index.ts:190
        ├─ Ensure research folder exists                 index.ts:208-243
        │     └─ generateFolderSlug() uses the LLM as a sub-agent (3 retries)
        ├─ Extract memory candidates (submit-message only) index.ts:245-287
        │
        ▼
createGuardedStream()                           src/lib/transport/guarded-stream.ts:10
        │
        ├─ createTools()                         src/lib/transport/tool-registry.ts:48
        │     ├─ Chrome DevTools MCP tools (if enabled)         :59
        │     ├─ Search tools (only for configured providers)   :80
        │     ├─ Plan / checkpoint / extract / facts_check       :88-105
        │     ├─ File / skill / research-history / currency      :106-115
        │     └─ applyToolCallRequirementSafeguards(tools)       :119
        ├─ buildSystemPrompt() (append Available skills)        :109
        ├─ getProviderOptions()  (disable DeepSeek thinking on forced toolChoice) :47
        │
        ▼
core: createGuardedStream()                     deep-search-core/.../orchestrator/guarded-stream.ts:41
        │
        └── while (!abortSignal.aborted) {              :106
              ├─ runAttempt()  → streamText(...)         :194
              ├─ evaluateStep()                          :129
              │     └─ app wrapper: evaluateAssistantStep()  src/lib/agent-guards.ts:240
              │           ├─ currency_conversion guard        :249-277
              │           └─ core evaluateAssistantStep()     agent-guards.ts:273
              │                 ├─ tool_call_requirement
              │                 ├─ question_tool
              │                 ├─ shouldContinueFromLatestTool (accept)
              │                 └─ research_checkpoint (depth + checkpoint)
              │
              ├─ accept  → break (with optional diagnostic)   :140
              ├─ retry limit hit → break with warning         :150
              └─ retry: append "Internal guardrail retry..."  :155-168
                    set toolChoice, sendStart=false
            }
```

Each tool's `execute` runs **inside** the model's tool-call roundtrip within a single `runAttempt`. The guardrail evaluation happens **between** attempts, after the model emits a `stop` finish reason.

---

## 3. The tool layer

### 3.1 What tools exist

Assembled in `src/lib/transport/tool-registry.ts:83-117`:

| Tool | Always registered? | Purpose |
|------|-------------------|---------|
| `ask_questions` | yes | Structured clarification questions with candidate answers |
| `disambiguate` | yes | DuckDuckGo instant-answer lookup for genuinely ambiguous terms |
| `brave_search` / `exa_search` / `serper_search` / `tavily_search` / `searxng_search` | **only if its API key/baseUrl is set** | Web search |
| `sequential_thinking` | yes | Externalised reasoning scratchpad (no-op execute) |
| `create_research_plan` | yes (uses the LLM) | Produces the structured research plan |
| `research_checkpoint` | yes (uses the LLM) | Advisory quality self-check before finalising |
| `extract_page_content` | yes | Reads a URL into cleaned text + optional summary; saves HTML+text to folder |
| `facts_check` | yes | Re-opens every URL cited in the draft answer and verifies claims |
| `create_file` / `read_file` / `update_file` / `move_file` / `delete_file` / `list_files` | yes | Research-folder file ops |
| `load_skill` | yes | Loads an agent skill by slug |
| `search_research` | yes | Searches past research folders (LLM over folder names) |
| `switch_research_folder` | yes | Switches the active folder to continue previous research |
| `currency_conversion` | yes | FX conversion via frankfurter.dev, cached |
| `chrome_devtools_*` | **only if Chrome DevTools MCP enabled** | Dynamically discovered MCP tools (last-resort browser control) |

### 3.2 Conditional registration

Search providers are optional. `createSearchTools(pkgSearchKeys, bridgeFetch)` in `deep-search-core` walks the key map and **only creates** a search tool if its key is non-empty (`src/lib/transport/tool-registry.ts:70-80`). An unconfigured provider is invisible to the model — not merely disabled.

The Chrome DevTools MCP tools are created only when `searchKeys?.chromeDevToolsMcpEnabled` is truthy (`tool-registry.ts:59-64`) and each MCP tool's description is appended with "Use only as a last resort..." (`src/lib/mcp/chrome-devtools-tools.ts:161`).

### 3.3 Single search schema

Every search tool exposes exactly one parameter to the model:

```ts
// deep-search-core/src/search-extract/core/types.ts:22-24
export const searchQueryInputSchema = z.object({
  query: z.string().min(1).describe("Search query"),
});
```

No recency, count, or domain filters are exposed. Output is a plain string formatted by `formatSearchResults()` (`deep-search-core/.../search/format.ts`): `"${title}: ${url}\n${description}"` joined by `"\n-\n"`. No dedup, no client-side ranking.

### 3.4 Safeguard wrapping

After assembly, the entire tool set passes through:

```ts
// src/lib/transport/tool-registry.ts:119
return applyToolCallRequirementSafeguards(tools);
```

This does two things to every tool (see §6): wraps `execute` to throw on prerequisite violation, and rewrites the description to announce the prerequisite to the model.

---

## 4. The system prompt

`src/lib/system-prompt.md` (146 lines). It is **static markdown** imported raw and only one piece is appended dynamically — the **Available skills** list, if any skills are configured (`src/lib/transport/guarded-stream.ts:109-121`).

The prompt has six sections:

1. **Core behaviour** (`:1-8`) — "You are a deep research agent. Do not stop at first results."
2. **Workflow** (`:9-75`) — the canonical pipeline the model is told to follow (see §5).
3. **Browser debugging** (`:77-84`) — prefer `extract_page_content`, treat Chrome DevTools MCP as last-resort.
4. **Writing style** (`:86-110`) — explicit anti-AI-tell word list, banned transitions, banned rhetorical structures.
5. **Truth-seeking stance** (`:112-146`) — anti-sycophancy rules, evidence-tagging scheme, confidence levels, truth-over-comfort.
6. *(Dynamic)* **Available skills** — appended only if `skillsStore.get()` returns skills.

The prompt does **not** inject the current date, the configured providers, or any settings. The model discovers its capabilities from the tool schemas the SDK passes.

### 4.1 Evidence tagging

The prompt instructs the model to tag every empirical claim (`system-prompt.md:124`):

> Tag claims by source: `[KNOWN]` training fact, `[INFERRED]` deduction, `[ASSUMED]` unverified premise, `[GUESS]` no basis, `[SEARCHED]` from a source you opened in this conversation.

And to attach an explicit confidence band (`:130`): `HIGH (≥80%)`, `MEDIUM (50-80%)`, `LOW (20-50%)`, `UNKNOWN (<20%)`. Claims tagged `[GUESS]` are capped at LOW.

---

## 5. The workflow the model is told to follow

From `system-prompt.md:9-75`, the model is instructed to run this exact sequence:

1. **Clarify before planning** (`:11-14`)
   - `disambiguate` only for genuinely ambiguous terms
   - `ask_questions` to narrow scope, intent, output format
   - Told: "`create_research_plan` is not available until `ask_questions` has been called earlier in the conversation."
2. **Plan the research** (`:16-21`) — call `create_research_plan`, use the plan to derive focused queries.
3. **Check previous research** (`:23-32`) — call `search_research` (past folders, not web) 2–4 times; if matches, ask the user whether to continue or start fresh; `switch_research_folder` if continuing.
4. **Research in passes** (`:34-62`) — follow the plan's passes (broad map → primary evidence → independent evidence → failure/limitation search → synthesis); read pages with `extract_page_content`; classify sources by the plan's classes; assign confidence by the plan's rules; persist notes with `create_file`; update `README.md` and `summary.md` incrementally.
5. **Stop condition** (`:62`): "Stop only when further searching is unlikely to change the answer."
6. **Analyse and answer** (`:64-75`)
   - Cross-reference sources
   - Call `research_checkpoint` with searches run, sources opened, claims verified, unresolved questions, confidence, readiness
   - Then call `facts_check` before the final answer
   - Cite URLs; verify links
   - Convert every monetary amount via `currency_conversion`

The prompt and the code enforce each of these steps independently — see §6 and §7.

---

## 6. How planning is enforced

This is the first of the two questions the doc set out to answer in depth. Planning is enforced at **three** layers, each catching what the previous misses.

### 6.1 Layer 1 — tool prerequisites (hard block)

Declared in `deep-search-core/.../guards/tool-call-requirements.ts:25-42`:

```ts
export const TOOL_CALL_REQUIREMENTS = {
  [TOOL_NAMES.create_research_plan]: {
    requiredPreviousTools: [TOOL_NAMES.ask_questions],
    instruction:
      "Call ask_questions first to clarify the research scope, then retry create_research_plan.",
  },
  [TOOL_NAMES.extract_page_content]: {
    anyOfPreviousTools: [
      TOOL_NAMES.brave_search, TOOL_NAMES.exa_search,
      TOOL_NAMES.serper_search, TOOL_NAMES.tavily_search,
      TOOL_NAMES.searxng_search,
    ],
    instruction:
      "Run a web search first to find URLs to extract from, then retry extract_page_content.",
  },
} as const satisfies Record<string, ToolCallRequirement>;
```

Two rules:
- **`create_research_plan` requires `ask_questions` to have been called.** All listed tools must appear in history.
- **`extract_page_content` requires at least one search tool.** Any-of semantics.

These are enforced two ways:

#### 6.1.1 Active-tool filtering (model never sees the tool)

Before each attempt, the loop computes the tools the model is allowed to see:

```ts
// deep-search-core/.../orchestrator/guarded-stream.ts:111-114
activeTools: getActiveToolNamesForMessages(tools, currentUiMessages),
```

`getActiveToolNamesForMessages()` (`tool-call-requirements.ts:89-97`) returns every tool whose requirement is **already satisfied** by the message history. Until `ask_questions` has been called, `create_research_plan` is **omitted from `activeTools`** — the model literally cannot choose it. Until a search has run, `extract_page_content` is omitted too.

#### 6.1.2 Execute-time guard (throws if the model bypasses filtering)

Even if a provider honours a tool not in `activeTools`, every tool's `execute` is wrapped:

```ts
// tool-call-requirements.ts:70-80
execute: ((input, options) => {
  const violation = evaluateToolCallRequirementForModelMessages(
    toolName, options.messages,
  );
  if (violation) throw new ToolCallRequirementError(violation);
  return execute.call(tool, input, options);
})
```

#### 6.1.3 Post-response check (forces a retry even if the SDK reports a soft failure)

After the model responds, `evaluateToolCallRequirementForResponse()` (`:99-115`) scans the response message for any tool calls that would have violated a requirement. If found, the guard returns a `tool_call_requirement` retry:

```ts
// agent-guards.ts:284-290
const toolRequirementViolation = evaluateToolCallRequirementForResponse({
  messages, responseMessage,
});
if (toolRequirementViolation) return toolRequirementRetry(toolRequirementViolation);
```

The retry (`agent-guards.ts:371-393`) **pins** the next tool via `toolChoice`:

```ts
toolChoice: { type: "tool", toolName: nextTool }  // e.g. ask_questions
```

So the model is structurally unable to produce a research plan without first asking questions, and unable to extract pages without first searching.

### 6.2 Layer 2 — the planner sub-agent

When the model does call `create_research_plan`, the tool runs a **separate `streamText` call** with its own dedicated system prompt — `src/tools/research-planner-prompt.md` (82 lines). The main model is not trusted to free-form a plan; the planner prompt constrains the output to a fixed structure:

- **Objective** — one sentence
- **Context extracted** — topic, intent, output shape, freshness, constraints, assumptions to verify
- **Must-answer questions** — a 5-column table (question / why it matters / evidence to collect / best source types / suggested searches)
- **Source priority** — Primary / Secondary / Experiential / Weak
- **Research passes** — at minimum: *Map the topic*, *Primary evidence*, *Independent evidence*, *Synthesis*; "Prefer 3-6 focused passes, but use more if the query requires separate subtopics."
- **Confidence rules** — High / Medium / Low
- **Stop conditions** — "Stop only when must-answer questions are answered, key claims have source support, contradictions are handled, and further searching is unlikely to change the answer."

The planner streams its output to a dedicated sub-agent panel (`research-plan-tool.ts:40-42`) so the user can watch the plan form, then returns the text to the main model.

### 6.3 Layer 3 — prompt reinforcement

`system-prompt.md:14`:

> `create_research_plan` is not available until `ask_questions` has been called earlier in the conversation.

And the planner tool's own description (`research-plan-tool.ts:16-17`):

> "Call this after asking clarifying questions to create a research plan."

Plus every prerequisite-having tool has its description auto-rewritten with a `Prerequisite:` line (`tool-call-requirements.ts:226-243`), so even the tool schema the model sees restates the rule.

---

## 7. How verification is enforced

The second core question. Verification happens at **four** layers: tool-call prerequisites (above), the **research-depth guard**, the **research-checkpoint guard** + tool, and the **facts_check** tool.

### 7.1 The `evaluateAssistantStep` decision tree

This is the heart of the verification system. It runs after every model attempt. The full order, from `deep-search-core/.../guards/agent-guards.ts:273-369`:

```ts
export function evaluateAssistantStep({ messages, responseMessage, isHiddenText }) {
  // (1) Hard prereq check first
  const toolRequirementViolation = evaluateToolCallRequirementForResponse(...);
  if (toolRequirementViolation) return toolRequirementRetry(toolRequirementViolation);

  // (2) If the response has no visible text, accept (nothing to verify)
  const text = getMessageText(responseMessage, hiddenPredicate);
  if (!text) return { action: "accept" };

  // (3) If the model asked the user a question in plain text, force ask_questions
  if (!hasToolCall(responseMessage, ask_questions) && asksUserForInput(text)) {
    return { /* guard: "question_tool", toolChoice: ask_questions */ };
  }

  // (4) If the response ends with a tool call and no text after, accept (let it continue)
  if (shouldContinueFromLatestTool(responseMessage, hiddenPredicate)) {
    return { action: "accept" };
  }

  // (5) From here on, the model produced a text answer. Verify research depth.
  const userText = getLatestUserText(messages, hiddenPredicate);
  if (!isResearchLikeRequest(userText)) return { action: "accept" };

  // (6) Research-like question. Was a checkpoint already done this turn?
  if (currentTurnMessages.some(hasResearchCheckpoint)) {
    return { action: "accept" };  // verified — let it through
  }

  // (7) No checkpoint. Did it use ANY deep-research tool?
  if (!currentTurnMessages.some(hasDeepResearchToolCall)) {
    return { /* guard: "research_checkpoint", retry: "depth reminder",
              retryInstruction: "...answered a research-like request without showing research...",
              toolChoice: "required" */ };
  }

  // (8) Used research tools but no checkpoint. Force the checkpoint.
  return { /* guard: "research_checkpoint", retry: "checkpoint guidance",
            toolChoice: { type: "tool", toolName: "research_checkpoint" } */ };
}
```

#### 7.1.1 What counts as "research-like"

`isResearchLikeRequest()` (`agent-guards.ts:240-251`) classifies a user message as research-like if any of these hold:

- It contains any of the `RESEARCH_KEYWORDS` (`:104-134`): `latest, current, recent, today, news, research, investigate, find, search, source, sources, cite, verify, compare, best, recommend, recommendation, review, price, cost, market, legal, law, regulation, medical, financial, travel, map, directions`.
- It is ≥40 characters and starts with `what|who|when|where|why|how|which`.

And it returns `false` for greetings (`hi`, `hello`, `thanks`, `ok`).

#### 7.1.2 What counts as a "deep research tool call"

```ts
// agent-guards.ts:136-143
const RESEARCH_TOOL_NAMES = new Set([
  brave_search, exa_search, serper_search, tavily_search,
  searxng_search, extract_page_content,
]);
```

Note: `disambiguate`, `sequential_thinking`, and the file tools do **not** count. The model cannot satisfy the depth guard by just thinking or filing notes.

#### 7.1.3 The two retry messages

When the guard fires, it emits a `guardrail_event` chunk (rendered by `GuardrailCard` in the UI) and appends a user-visible retry instruction. Two flavours:

- **Depth reminder** (`:342-344`): *"Your previous response answered a research-like request without showing research. Reconsider whether you searched deeply enough. If more evidence would materially improve the answer, use search and page-reading tools before answering. You may call research_checkpoint for plain-text guidance when ready."* — `toolChoice: "required"` (any tool).
- **Checkpoint forcing** (`:359-361`): *"Before finalizing this research answer, call research_checkpoint once for plain-text guidance. Use the guidance to decide whether further research would materially improve the answer; do not wait for an approval status."* — `toolChoice: { type: "tool", toolName: "research_checkpoint" }` (pinned).

### 7.2 The `research_checkpoint` tool

Once forced, the model must call `research_checkpoint`. Its schema (`agent-guards.ts:37-45`):

```ts
export const researchCheckpointInputSchema = z.object({
  originalQuestion: z.string().min(1),
  searchesRun: z.array(z.string().min(1)),
  sourcesOpened: z.array(researchSourceSchema),   // { url, title?, sourceType?, date? }
  claimsVerified: z.array(z.string().min(1)),
  unresolvedQuestions: z.array(z.string().min(1)),
  confidence: z.enum(["low", "medium", "high"]),
  readyToAnswer: z.boolean(),
});
```

The tool runs a **two-stage review** (`research-checkpoint-tool.ts:17-22`):

1. **Local heuristic guidance first** — `validateResearchCheckpoint()` (`agent-guards.ts:410-454`) checks thresholds and produces bullet-point guidance:
   - `readyToAnswer === false` → *"You marked the research as not ready to answer."*
   - `searchesRun.length === 0` → *"Run at least one real search query before relying on the answer."*
   - `sourcesOpened.length < 2` → *"Open and inspect more than one relevant source when the topic depends on external facts."*
   - `claimsVerified.length < 2` → *"List the key claims you verified, especially dates, prices, numbers, and source-specific facts."*
   - `unresolvedQuestions.length > 0` → *"Resolve or explicitly disclose these open questions: …"*
   - `confidence === "low"` → *"Confidence is low; do more research or make the uncertainty prominent in the final answer."*
   - If all pass: *"You appear ready to answer. Synthesize the verified claims, cite the sources you opened, and state any residual uncertainty."*

2. **LLM judge on top** — `judgeResearchCheckpoint()` (`research-checkpoint-tool.ts:25-43`) sends the checkpoint JSON to the model with a system prompt that forbids JSON, forbids approve/reject, and asks for concise plain-text guidance on direct relevance, source support, recency, and gaps.

The local guidance is the fallback if the judge fails or returns empty (`agent-guards.ts:478-494`).

The minimum thresholds the checkpoint enforces:

| Field | Minimum |
|-------|---------|
| `searchesRun` | ≥ 1 |
| `sourcesOpened` | ≥ 2 |
| `claimsVerified` | ≥ 2 |
| `readyToAnswer` | `true` |
| `confidence` | not `"low"` |

### 7.3 The `facts_check` tool

After the checkpoint, the prompt requires one more step before the final answer (`system-prompt.md:70`):

> call `facts_check` before giving the final answer. Pass the original research objective/questions/clarifications and the final answer/report you plan to give. The tool will extract source URLs from your text, open each one, and check whether high-risk factual claims … are supported by those sources.

`facts_check` (`src/tools/facts-check-tool.ts`) is the only tool that **re-opens cited URLs and verifies claims against them**:

1. Extracts every URL from the draft answer with `/https?:\/\/[^\s)\]>"')]+/g` (`:5`).
2. Fetches each one **in parallel** with `extractPageContent(url, { summarize: false })` (`:67-76`) — reusing the full extraction pipeline (webview / Chrome MCP / Scrape.do / fetch fallbacks).
3. Builds a source dossier (`:78-97`): `--- Source N: {url} ---\n{content}` or `[Could not fetch: {reason}]`.
4. Sends the original objective + the draft answer + the dossier to the model with the `FACTS_CHECK_SYSTEM` prompt (`:28-46`), which forces the judge to report each high-risk claim as **confirmed / contradicted / unverifiable**, quoting the source.
5. Returns plain-text notes. The system prompt instructs: *"If `facts_check` reports factual problems, tell the user what was wrong and correct the final answer before presenting it."* (`system-prompt.md:71`)

Unlike `research_checkpoint`, `facts_check` is **prompt-mandated, not guard-mandated**. There is no guardrail that hard-blocks the final answer if `facts_check` was skipped. This is deliberate — the checkpoint guard already ensures the model did real research; facts_check is the model's own due-diligence step.

### 7.4 Currency enforcement

A dedicated guard catches unconverted money. In the app wrapper (`src/lib/agent-guards.ts:249-277`), if `targetCurrency` is set, the response text is scanned by `detectForeignCurrencyMentions()` (`:156-184`) using:

- Currency-symbol regexes built from `currency-symbol-map` (skipping single-letter symbols)
- `\d+ USD`-style code patterns for every known currency code
- Named-currency patterns ("dollars", "euros", "yen", with amount words)

If a foreign mention is found and `currency_conversion` was not called in this response, the guard retries with:

> *"Convert all foreign currency amounts to {TARGET}. Use the currency_conversion tool. Do not include original foreign amounts, exchange rates, or ≈."*

If `currency_conversion` was already called but foreign mentions persist, the retry is sharper:

> *"Your response still contains foreign currency amounts. Rewrite using only {TARGET}. Do not include original foreign amounts, exchange rates, or ≈."*

This guard is capped at **1 retry** (`src/lib/transport/guarded-stream.ts:93-95`) — lower than the default of 2, because currency mentions are easy to fix and we don't want loops.

---

## 8. The guardrail loop in detail

### 8.1 Per-attempt flow

From `deep-search-core/.../orchestrator/guarded-stream.ts:106-169`:

```ts
while (!abortSignal?.aborted) {
  lastFinish = await runAttempt({ ... });                   // (A) call the model

  if (lastFinish.usage) writeTokenUsageEvent(...);

  const decision = evaluateStep
    ? evaluateStep({ messages, responseMessage })            // (B) custom eval
    : evaluateAssistantStep({ messages, responseMessage });  //    or default eval

  if (decision.action === "accept") {                        // (C) done
    const diagnostic = getNoReplyDiagnostic(lastFinish);
    if (diagnostic) writeAgentDiagnosticEvent(...);
    break;
  }

  const guardRetryCount = retries[decision.guard] ?? 0;      // (D) limit check
  const guardMaxRetries = effectiveMaxRetries[decision.guard] ?? MAX_GUARD_RETRIES;
  if (guardRetryCount >= guardMaxRetries) {
    writeGuardrailEvent(controller, maxRetryWarning(...));
    break;                                                   // give up, accept
  }

  retries[decision.guard] = guardRetryCount + 1;             // (E) count + emit event
  writeGuardrailEvent(controller, { ...decision.event, attempt: retries[decision.guard] });

  currentUiMessages = lastFinish.messages;                   // (F) rebuild messages
  currentModelMessages = await buildRetryMessages({
    messages: currentUiMessages, tools, instruction: decision.retryInstruction,
  });
  toolChoice = decision.toolChoice;                          // (G) pin next tool
  sendStart = false;                                         //     don't re-send "start"
}
```

### 8.2 How retries are injected

`buildRetryMessages()` (`:291-307`) appends a synthetic user turn:

```ts
return [
  ...(await convertToModelMessages(messages, { tools })),
  { role: "user", content: `Internal guardrail retry. ${instruction}` },
];
```

So the model sees its own previous output plus a plain-text instruction prefixed `Internal guardrail retry. …` and (typically) a pinned `toolChoice`. `sendStart = false` so the UI does not show a second "agent starting" indicator for the retry.

### 8.3 Retry limits

```ts
// deep-search-core/.../orchestrator/guarded-stream.ts:22-28
const MAX_GUARD_RETRIES = 2;
const DEFAULT_MAX_RETRIES_PER_GUARD = {
  question_tool: 2,
  research_checkpoint: 2,
  tool_call_requirement: 2,
};
```

App override (`src/lib/transport/guarded-stream.ts:93-95`):

```ts
maxGuardRetries: { currency_conversion: 1 },
```

When the limit is hit, the loop **accepts whatever the model produced** and emits a warning:

> *"The agent kept missing this guardrail, so the latest output is shown."* (`:492`)

This is an explicit design decision: bounded loops are more important than perfect enforcement.

### 8.4 Tool-choice fallback

Some providers reject `toolChoice: { type: "tool", ... }` while reasoning/thinking is enabled (notably DeepSeek). The loop catches this and retries without forced tool choice (`:194-217`):

```ts
async function runAttempt(params) {
  try {
    return await runAttemptOnce(params);
  } catch (error) {
    if (params.toolChoice && !params.abortSignal?.aborted
        && isForcedToolChoiceUnsupported(error)) {
      return await runAttemptOnce({ ...params, toolChoice: undefined });
    }
    throw error;
  }
}
```

`isForcedToolChoiceUnsupported` matches errors that mention `tool_choice`/`tool choice` together with `thinking`/`reasoning`. The app also proactively disables DeepSeek thinking when a forced toolChoice is in play (`src/lib/transport/guarded-stream.ts:47-69`).

### 8.5 The "continue from latest tool" shortcut

`shouldContinueFromLatestTool()` (`agent-guards.ts:456-476`) returns `accept` when the response's last non-empty part is a tool invocation and any text after it is hidden sub-agent text. This is what lets the agent chain `search → extract → search → extract → …` without the depth guard firing on every intermediate response.

### 8.6 The empty-response diagnostic

After accepting, `getNoReplyDiagnostic()` (`guarded-stream.ts:373-394`) checks whether the final response actually contained visible text. If not, it emits an `agent_diagnostic` event with kind `empty_response` and one of these messages (`:444-469`):

- finish reason `length` → *"The provider stopped at the output limit before returning visible answer text."*
- finish reason `content-filter` → *"The provider reported a content-filter stop before returning visible answer text."*
- tool calls happened but no final text → *"The model finished after tool work but did not return final answer text."*
- only sub-agent text → *"Only internal verification or tool-progress text was produced; no final answer text was returned."*
- only reasoning → *"The model produced reasoning but no visible answer text."*
- otherwise → *"The provider ended the turn without returning visible answer text."*

`source-url`, `source-document`, and `file` parts count as visible replies (`:422-429`), so a response consisting only of citations still counts.

---

## 9. The extraction pipeline

The `extract_page_content` tool (`src/tools/extract-page-content-tool.ts`) is the agent's only way to read a web page. It is registered with a hard prerequisite: at least one search tool must have been called first (§6.1).

### 9.1 Input

```ts
// extract-page-content-tool.ts:537-557
{
  url: string,
  query?: string,                      // focuses the LLM summary
  summarize?: boolean,                 // default true
  method?: "auto" | "fetch" | "webview" | "chrome" | "scrape.do",
}
```

### 9.2 Backends

`getEngine()` (`:71-116`) assembles a `SearchExtractEngine` with a `PageLoader`:

| Method | Backend | How HTML is obtained |
|--------|---------|----------------------|
| `fetch` | Rust `fetch_html` | `reqwest` HTTP GET via Tauri command; 5 MB cap; up to 5 redirects; SSRF-guarded (`src-tauri/src/lib.rs:126-133, 258-298`) |
| `webview` | Tauri webview | Hidden webview tab, 30 s load timeout, polls `readyState` every 500 ms, returns `document.documentElement.outerHTML` (`lib.rs:69-123`) |
| `chrome` | Chrome DevTools MCP | MCP `navigate_page` + `evaluate_script(() => document.documentElement.outerHTML)` via the sidecar |
| `scrape.do` | Remote renderer | `api.scrape.do` with API token |
| `auto` (default) | Fallback chain | `fetch` first; if content < 200 chars, fall back to `render` (webview/chrome/scrape.do) |

The `chrome` and `scrape.do` backends are layered on top of the base loader — `withScrapeDoFallback(basePageLoader, scrapeDoToken)` wraps `renderHtml` so Scrape.do is tried first and the base loader is the fallback.

### 9.3 Site-specific extractors

Four custom extractors fire **before** generic HTML fetching (`:112`):

| Extractor | `canHandle` | Parses |
|-----------|------------|--------|
| `RedditExtractor` | `reddit.com` | Fetches `/.json`, parses posts/comments |
| `AmazonExtractor` | `amazon.*/dp/` | Title, price, rating, features, specs |
| `ShopifyExtractor` | Shopify storefronts | Product info from Shopify DOM |
| `GithubExtractor` | `github.com` | Description, stars, topics, README |

### 9.4 HTML → text

Custom cheerio-based sanitisation in `deep-search-core/.../extract/sanitize-html.ts`:

1. **Prune** structural noise tags (`script`, `style`, `nav`, `header`, `footer`, `iframe`, `svg`, etc.).
2. **Remove** hidden elements (`hidden`, `aria-hidden`, `display:none`, noise roles like `banner`/`navigation`/`dialog`) and anything matching `/cookie|consent|gdpr|popup|modal|overlay|newsletter|captcha|ad-.../`.
3. **Walk** the remaining DOM, joining inline text with spaces, blocks with newlines, table cells with ` | `. Deduplicate repeated lines (max 2 occurrences). Minimum threshold: 200 chars.

Output is **plain text with structure preserved via newlines**, not Markdown.

### 9.5 Persistence

Every successful extraction saves to the research folder:
- `<domain>/<page>.html` — raw HTML
- `<domain>/<page>-content.html` — sanitised text
- `<domain>/<page>-summary.md` — LLM summary (if summarised)

So future turns can `read_file` the saved content instead of re-fetching.

### 9.6 CAPTCHA retries

Reddit and Amazon specifically get challenge-page retry loops (`extract-page-content-tool.ts:308-327`):
- Reddit: retry every 5 s up to 5 min when `isRedditChallengeHtml` matches.
- Amazon: retry every 3 s up to 3 min when `isAmazonChallengePage` matches.

Both use the webview renderer (real browser).

---

## 10. Loop bounds, stop conditions, abort

### 10.1 There is no `maxSteps`

The loop is **not** bounded by a step count. The AI SDK's own multi-step mechanism is bypassed — each `streamText` call is one roundtrip, and the custom `while` loop decides whether to continue.

### 10.2 Stop conditions

The loop ends when any of these is true:

1. `evaluateStep` returns `accept` (§7.1).
2. A guardrail hits its per-guard retry limit (`MAX_GUARD_RETRIES = 2`, `currency_conversion = 1`) — the response is accepted with a warning.
3. The user aborts via `abortSignal` (checked at `:106`).

### 10.3 When the model decides to stop researching

The model is told the stop condition in two places:

- `system-prompt.md:62`: *"Stop only when further searching is unlikely to change the answer."*
- `research-planner-prompt.md:82`: *"Stop only when must-answer questions are answered, key claims have source support, contradictions are handled, and further searching is unlikely to change the answer."*

There is **no explicit tool-loop / duplicate-query detector**. The model is trusted (via prompt + planner stop conditions + checkpoint guidance) to recognise when it has enough. The bounded retry counters are the safety net if it gets stuck on a guard.

### 10.4 Abort propagation

`abortSignal` flows from `DirectTransport.sendMessages` → `createGuardedStream` → core loop → `streamText({ abortSignal })` → every tool's `options.abortSignal`. Tools that spawn sub-agents (`create_research_plan`, `extract_page_content`, `facts_check`, `research_checkpoint`) propagate the signal into their inner `streamText`/`generateText` calls and emit `cancelled` sub-agent events on abort.

---

## 11. Observability

The loop emits custom `UIMessageChunk` types alongside normal text/tool deltas:

| Chunk type | When | Rendered by |
|-----------|------|-------------|
| `data-guardrail_event` | Every guardrail retry and warning | `GuardrailCard` |
| `data-agent_diagnostic` | Empty response after accept | `AgentDiagnosticCard` |
| `data-token_usage` | After each attempt with usage data | usage meters |
| Sub-agent events (`start`, `text-delta`, `complete`, `error`, `cancelled`) | Plan, checkpoint, facts_check, extraction tools | `ToolFallback` inline + `SubAgentSidebar` |

`guardrail_event` carries `kind` (`question_tool` | `research_checkpoint` | `tool_call_requirement` | `currency_conversion`), `status` (`retrying` | `warning` | `passed`), `title`, `message`, optional `reason`, and `attempt` number — so the user sees exactly which guard fired and on which retry.

---

## 12. Configuration and key gating

### 12.1 API key storage

All keys live in the Tauri plugin-store (a JSON file in the app data dir), validated by Zod on every write. Schema in `src/lib/settings-store.ts:55-83`. Defaults are empty strings — empty means unconfigured.

### 12.2 How keys gate tools

The chain:

1. `App.tsx` reads settings and maps empty strings to `null` in `searchKeys`.
2. `createTools(searchKeys)` in `tool-registry.ts`:
   - Creates each search tool **only if** its key is non-null.
   - Creates Chrome DevTools MCP tools **only if** `chromeDevToolsMcpEnabled` is truthy.
   - Threads `scrapeDoApiKey` into extraction and facts_check as the remote-renderer fallback.
3. The chat model itself is user-configurable (`src/lib/chat-providers.ts`): `openrouter` (default), `anthropic`, `deepseek`, `zhipu`, `opencode-zen`, `local`. A provider appears in the model selector only if its key is set.

### 12.3 Network permissions

For any new external API domain, `src-tauri/tauri.conf.json` (`app.security.csp.connect-src`) and `src-tauri/capabilities/default.json` (HTTP allow lists) must both be updated — this is enforced by project policy in `AGENTS.md`.

---

## 13. Reference tables

### 13.1 Guardrails — full list

| Guard | Layer | Trigger | Retry instruction (summary) | Forced `toolChoice` | Max retries |
|-------|-------|---------|----------------------------|---------------------|-------------|
| `tool_call_requirement` | core, post-response | Model called a tool whose prereq is unmet | "Your previous response tried to call {tool} too early. {instruction}" | The missing prereq tool | 2 |
| `tool_call_requirement` (execute-time) | core, inside execute | Same — throws `ToolCallRequirementError` | n/a (tool returns error) | n/a | n/a |
| `question_tool` | core, post-response | Plain-text question to user detected by `asksUserForInput` | "Convert that request into an ask_questions tool call now." | `ask_questions` | 2 |
| `research_checkpoint` (depth) | core, post-response | Research-like request answered with no deep-research tool calls | "…answered a research-like request without showing research…" | `"required"` | 2 |
| `research_checkpoint` (checkpoint) | core, post-response | Research tools used but no `research_checkpoint` this turn | "…call research_checkpoint once for plain-text guidance…" | `research_checkpoint` | 2 |
| `currency_conversion` | app, post-response | Foreign-currency mention detected and `currency_conversion` not called | "Convert all foreign currency amounts to {TARGET}…" | none | 1 |

### 13.2 Thresholds

| Threshold | Value | Location |
|-----------|-------|----------|
| Max guard retries (default) | 2 | `guarded-stream.ts:22` |
| Max `currency_conversion` retries | 1 | `guarded-stream.ts:93-95` (app override) |
| Min `searchesRun` (checkpoint) | 1 | `agent-guards.ts:419` |
| Min `sourcesOpened` (checkpoint) | 2 | `agent-guards.ts:425` |
| Min `claimsVerified` (checkpoint) | 2 | `agent-guards.ts:431` |
| Research-like request length | ≥ 40 chars | `agent-guards.ts:248` |
| Folder-naming LLM retries | 3 | `folder-namer.ts` |
| Memory candidates per turn | max 2 (1 user + 1 ask_questions answer) | `transport/index.ts` |
| Webview page-load timeout | 30 s | `src-tauri/src/lib.rs` `PAGE_LOAD_TIMEOUT_SECS` |
| Max HTML fetch size | 5 MB | `src-tauri/src/lib.rs` `MAX_HTML_BYTES` |
| Min extracted content length | 200 chars | `sanitize-html.ts` |
| Reddit challenge retry window | 5 min (5 s interval) | `extract-page-content-tool.ts:308-327` |
| Amazon challenge retry window | 3 min (3 s interval) | `extract-page-content-tool.ts:308-327` |

### 13.3 Where decisions live

| Decision | Made by | File |
|----------|---------|------|
| Which tools the model sees | prerequisite filter | `tool-call-requirements.ts:89-97` |
| Whether a response is acceptable | `evaluateAssistantStep` | `agent-guards.ts:273` (core) + `agent-guards.ts:240` (app wrapper) |
| Whether the request is research-like | `isResearchLikeRequest` | `agent-guards.ts:240` |
| Whether to retry or accept | the loop | `guarded-stream.ts:140-168` |
| Whether a URL is fetchable | `validateUrl` (TS) + URL guard (Rust) | `src/lib/url-validation.ts`, `src-tauri/src/lib.rs:135-256` |
| Whether the checkpoint passes local rules | `validateResearchCheckpoint` | `agent-guards.ts:410-454` |
| Whether claims are supported | `facts_check` LLM judge | `src/tools/facts-check-tool.ts:28-46` |

---

## 14. Summary

Deep Search's research quality comes from **redundant enforcement**, not from any single mechanism:

- **Plan first**: `ask_questions` is the only visible tool until it's called → `create_research_plan` is the only visible planning tool → a dedicated planner sub-prompt constrains its output to a fixed structure.
- **Search before read**: `extract_page_content` is hidden until a search has run, and throws if bypassed.
- **No premature answers**: the research-depth guard rejects any text answer to a research-like question that lacks deep-research tool use, and the checkpoint guard rejects any research answer that lacks a `research_checkpoint` call.
- **Self-check before finalising**: `research_checkpoint` runs local heuristics (≥1 search, ≥2 sources, ≥2 verified claims, not low confidence, ready) plus an LLM judge, and returns advisory plain-text guidance.
- **Verify claims against sources**: `facts_check` re-opens every cited URL through the full extraction pipeline and asks a judge to label each high-risk claim confirmed/contradicted/unverifiable.
- **Bounded loops**: every guard has a max-retry counter (default 2, currency 1); when hit, the latest output is shown with a warning.
- **Observable**: every guardrail retry and warning is emitted as a `guardrail_event` chunk and rendered in the UI; every sub-agent (planner, checkpoint, extractor, fact-checker) streams to a dedicated panel.

The model is given a workflow, structurally prevented from skipping its mandatory steps, forced to self-verify before answering, and bounded so it cannot loop forever. Every enforcement point has a fallback so the system degrades gracefully rather than deadlocking.
