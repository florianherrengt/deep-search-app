# Specification: Memory Extraction for `ask_questions` Answers

**GitHub Issue:** #2 — User answering questions from the tool call should trigger memories extraction

**Status:** Draft

**Date:** 2026-06-17

---

## 1. System Overview

The Deep Search app has a memory extraction system that extracts durable user facts from conversation messages and stores them in `memories.md` inside the active research folder (`search-results/<folder-name>/memories.md`). Extraction is triggered at the start of `DirectTransport.sendMessages()` (before the guarded stream), only on `trigger === "submit-message"`.

Currently, extraction only considers user messages with `role === "user"`. When the `ask_questions` tool is used, the model asks the user questions, the user submits answers via `QuestionsToolUI`, and those answers are stored as `tool-ask_questions` parts on the ASSISTANT message — NOT as a new user message. Therefore, answers from `ask_questions` are never extracted.

This specification defines the changes required to also extract memories from `ask_questions` answers, along with a fundamental change to how memory extraction performs deduplication (moving from code-level `Set` dedup to LLM-level merge), a change from fire-and-forget to blocking (`await`) before the guarded stream, and a generic candidate collection architecture.

---

## 2. Problem Statement

| ID | Problem | Impact |
|----|---------|--------|
| P1 | The current `findLastUserMessageForExtraction()` only inspects `role === "user"` messages. `ask_questions` answers live in `role === "assistant"` messages as `tool-ask_questions` parts. | User answers provided through the `ask_questions` flow are permanently invisible to the memory extraction system. |
| P2 | The current deduplication strategy (code-level `Set` merge of old + new facts) has no semantic understanding. Identical facts phrased differently ("User has a dog" vs "User owns a dog") are treated as distinct. | Duplicate or near-duplicate memories accumulate, degrading quality. |
| P3 | The LLM prompt instructs the model to return only new facts, but the LLM has no context of existing memories. | The LLM cannot distinguish "new" from "already known" without seeing existing memories. |
| P4 | Memory extraction is fire-and-forget (`void` + `.catch()`). Failures are silently swallowed. If extraction fails technically, the guarded stream proceeds regardless, wasting the opportunity to capture user facts. | Technical failures are invisible and unrecoverable. |

---

## 3. Goals

| ID | Goal | Priority |
|----|------|----------|
| G1 | Answers submitted through `ask_questions` trigger memory extraction identically to user-authored messages, through a unified `collectMemoryCandidates()` function. | P0 |
| G2 | `extractAndStoreMemories` receives existing `memories.md` content and returns the **complete merged** fact list; the LLM is responsible for deduplication and merging. | P0 |
| G3 | The `memory-agent-prompt.md` prompt is updated to instruct the LLM to receive existing memories and return the complete merged array. | P0 |
| G4 | Answers from a single `ask_questions` tool call are batched into one extraction call, formatted as structured JSON. | P0 |
| G5 | Extraction only fires on `trigger === "submit-message"` (same as existing extraction). | P0 |
| G6 | Memory extraction is AWAITED before the guarded stream. If extraction throws (technical failure), `createGuardedStream` never runs — the error propagates to `sendMessages()`'s `catch` block. | P0 |
| G7 | Minimal structured logging uses `console.debug` with fields: `correlationId`, `candidateId`, `source`, `decision`, `contentLength`. | P0 |
| G8 | No extraction triggers for: assistant messages without ask_questions answers, tool calls, tool outputs, sub-agent outputs, synthetic messages, system messages, or regenerate-message triggers. | P1 |

---

## 4. Non-Goals

- Changing the `ask_questions` UI (`QuestionsToolUI`) or its data format.
- Changing when memory extraction fires relative to the guarded stream (stays: before guarded stream, but now awaited).
- Extracting from intermediate streaming deltas or partial tool states.
- Supporting extraction of other tool types beyond `ask_questions` (though the architecture is extensible — see §21.1).
- Changing the `memories.md` file format (remains markdown bullet list under `# Memories`).
- Changing the `serializedWrite` mechanism for concurrent write safety.
- Supporting `trigger === "regenerate-message"` for any extraction path.
- Persisting `processedMemoryMessageIds` across browser sessions (remains in-memory only).
- Syncing memories across devices or to a remote service.
- Preserving non-bullet content (free-form notes, comments) in memories.md across LLM rewrites. The LLM receives the full file content but only returns structured fact bullet points. Users should keep all memories in the standard bullet format.

---

## 5. Users / Actors

| Actor | Role |
|-------|------|
| End User | A person conducting research. Answers questions asked by the `ask_questions` tool. |
| Deep Search App | The frontend application that sends messages and receives streamed responses. |
| `DirectTransport.sendMessages()` | The transport layer that orchestrates memory extraction before the guarded stream. |
| `collectMemoryCandidates()` | The new generic candidate collection function that scans messages for eligible content. |
| `extractAndStoreMemories()` | The memory extraction function that calls the LLM and writes `memories.md`. |
| LLM (Language Model) | The AI model that performs semantic memory extraction, deduplication, and merging. |

---

## 6. Scope Boundaries

### In Scope

- Creating `collectMemoryCandidates()` to scan messages from end to start, collecting candidates from supported sources (user messages, ask_questions answers).
- Modifying the extraction trigger block in `DirectTransport.sendMessages()` to use `collectMemoryCandidates`, `await` extraction, and add message IDs to `processedMemoryMessageIds` only after successful extraction.
- Modifying `extractAndStoreMemories()` to read existing memories, pass them to the LLM, write the LLM's complete merged output, and THROW on technical failures.
- Updating `memory-agent-prompt.md` with merge + deduplication instructions.
- Adding minimal structured `console.debug` logging with specified fields.
- Adding a throw-on-technical-failure contract in `extractAndStoreMemories`.
- Updating unit tests for both `memory-extraction-guard.test.ts` and `memory-agent.test.ts`.
- Adding new test cases for `collectMemoryCandidates`, ask_questions answer extraction, LLM-merge behavior, and error handling.

### Out of Scope

- The `QuestionsToolUI` rendering logic.
- The `canRenderQuestionsTool` or `questionResultSchema` definitions.
- The `getAskQuestionsAnswers()` function (NOT reused by new code — it discards the question field; new code reads answer entries directly from tool parts). The function remains unchanged; it is still used by `getPreviousResearchChoice()`.
- The `serializedWrite` folder-queue mechanism.
- The `createGuardedStream` function.
- The research folder initialization or naming.
- Any backend (Rust/Tauri) code.
- Any E2E test changes (no E2E tests currently exist for memory extraction).

---

## 7. User Flow / System Flow

### 7.1 Normal User Message Extraction

1. User types a message and submits ("I have a dog").
2. `DirectTransport.sendMessages()` is called with `trigger: "submit-message"`.
3. If a research folder is active:
   a. `collectMemoryCandidates(messages)` scans messages from the end.
   b. If a user-message candidate is found and its ID is not in `processedMemoryMessageIds`:
      - **Awaits** `extractAndStoreMemories(text, ...)` with the user message text.
      - If extraction throws, the error propagates to `sendMessages()`'s `catch` block. `createGuardedStream` is **never called**.
      - If extraction succeeds, adds the candidate ID to `processedMemoryMessageIds`.
4. `extractAndStoreMemories` (updated):
   a. Resolves research folder — throws if null/empty.
   b. Reads existing `memories.md` from the research folder (inside `serializedWrite`).
   c. Constructs a prompt containing: existing memories + new user text.
   d. Sends to LLM with updated system prompt.
   e. LLM returns a complete merged JSON array of facts.
   f. Validates output is a JSON array of strings (invalid → throws).
   g. Writes the merged content to `memories.md`.
   h. Returns `{ memoriesStored: N }`.
5. **After** successful extraction, guarded stream proceeds.

### 7.2 Ask-Questions Answer Extraction (New Flow)

1. Model calls `ask_questions` tool with questions.
2. `QuestionsToolUI` renders in the assistant message.
3. User submits answers through the UI.
4. Answers are stored as `tool-ask_questions` parts on the assistant message:
   - Part type: `"tool-ask_questions"`
   - Part state: `"output-available"`
   - Part output: `{ answers: [{ question: string, answer: string, custom?: boolean }] }`
5. On next `submit-message` trigger (when user sends a follow-up message or the answers trigger a new round):
   a. `collectMemoryCandidates(messages)` scans messages from the end.
   b. If a tool-answer candidate is found and its ID is not in `processedMemoryMessageIds`:
      - Constructs structured JSON Q&A text (see §11.1).
      - **Awaits** `extractAndStoreMemories(qaText, ...)`.
      - If extraction throws, the error propagates. `createGuardedStream` is **never called**.
      - If extraction succeeds, adds the candidate ID to `processedMemoryMessageIds`.

   **Note:** The auto-continue mechanism (`shouldContinueAfterToolResult` in `chat.tsx:253`) triggers a `sendMessages` call with `trigger: "submit-message"`, matching the extraction trigger gate. Verified from `@assistant-ui/react` source.
6. `extractAndStoreMemories` processes identically to 7.1 step 4, using the structured JSON Q&A text as the "user content".

### 7.3 Edge: Both User Message AND Ask-Questions Answers in Same Send

A single `sendMessages` call can contain both:
- A user message (e.g., user's original question "I want to learn about AI")
- An assistant message with ask_questions answers (from a previous turn)

In this case:
1. `collectMemoryCandidates` returns one candidate per source type (up to two candidates).
2. Each candidate is looped over. For each unprocessed candidate, `await extractAndStoreMemories` is called sequentially.
3. Each candidate's success enables its ID to be added to `processedMemoryMessageIds`.

These are independent extractions, each tracked by its own message ID in `processedMemoryMessageIds`.

Multiple extractions against the same research folder are serialized through `serializedWrite`'s folder queue, preventing concurrent write data loss. The entire read-LLM-write cycle for each extraction is guarded by `serializedWrite`.

### 7.4 Extraction Failure is Fatal

If any candidate's extraction throws, the error propagates immediately. Subsequent candidates are NOT processed, and `createGuardedStream` is NOT called. The error reaches `sendMessages()`'s outer `catch` block, which enqueues an error event and finishes the stream with finish reason `"error"`.

---

## 8. Architecture Breakdown

```
┌──────────────────────────────────────────────────────────────┐
│ DirectTransport.sendMessages()                                │
│                                                               │
│  if (researchFolder && trigger === "submit-message") {       │
│                                                               │
│    // Collect all memory candidates                           │
│    candidates = collectMemoryCandidates(messages)             │
│                                                               │
│    // Process each candidate (sequential, await each)         │
│    for (candidate of candidates) {                            │
│      if (processedMemoryMessageIds.has(candidate.id)) {       │
│        log: decision = "skip-processed"                       │
│        continue                                               │
│      }                                                        │
│                                                               │
│      log: decision = "extract"                                │
│                                                               │
│      await extractAndStoreMemories(candidate.content, ...)    │
│      // ↑ BLOCKING — if this throws, the error propagates     │
│      //   and createGuardedStream is NEVER called             │
│                                                               │
│      processedMemoryMessageIds.add(candidate.id)              │
│      // ↑ ONLY after successful extraction                    │
│    }                                                          │
│  }                                                            │
│                                                               │
│  createGuardedStream(...)  // only reached if all succeeded   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ collectMemoryCandidates(messages)                             │
│                                                               │
│  Scans messages from end to start.                            │
│  Collects at most ONE candidate per source type:              │
│                                                               │
│  1. source: "user-message" → last user message with text     │
│  2. source: "tool-answer"  → last assistant message with     │
│     tool-ask_questions answers in output-available state      │
│                                                               │
│  Returns MemoryExtractionCandidate[]                          │
│  (0, 1, or 2 entries)                                        │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ extractAndStoreMemories(userContent, getResearchFolder,       │
│                          model, abortSignal, deps)            │
│                                                               │
│  1. Resolve research folder → if null/empty, THROW            │
│                                                               │
│  2. serializedWrite guard (entire read+LLM+write cycle)       │
│     a. Read existing memories.md content                      │
│     b. Build prompt: "Existing memories:\n<content>\n\n      │
│                       New user content:\n<userContent>"      │
│     c. Call LLM with updated system prompt + built prompt    │
│     d. Parse LLM output as JSON array of strings             │
│        - If not JSON → THROW                                  │
│        - If not array → THROW                                 │
│        - If any array entry is not a string, THROW `Error("LLM returned non-string entry in array")`. Then trim each string and normalize newlines.         │
│        - If all-trivial after trim → return memoriesStored: 0 │
│     e. Format the merged facts as memories.md markdown        │
│     f. Write to research folder                             │
│     g. Return fact count                                     │
│                                                               │
│  3. Return { memoriesStored: number_of_facts }               │
│                                                               │
│  TECHNICAL FAILURES THROW:                                    │
│  - No research folder                                         │
│  - Read failure                                               │
│  - LLM call failure                                           │
│  - Write failure                                              │
│  - Invalid JSON output                                        │
│  - Non-array JSON output                                      │
│                                                               │
│  Only returns { memoriesStored: 0 } for:                     │
│  - LLM returns [] (empty array)                               │
│  - All entries are empty strings after trim                   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ memory-agent-prompt.md (Updated)                              │
│                                                               │
│  System prompt instructs LLM:                                │
│  - You receive EXISTING memories + new user content          │
│  - Your job is to extract durable facts from new content     │
│  - Return the COMPLETE merged list (existing + new)          │
│  - Deduplicate: if a new fact is semantically identical      │
│    to an existing one, do not include it twice               │
│  - Prefer the more specific/precise phrasing when merging    │
│  - Return only a JSON array of strings                      │
│                                                               │
│  The LLM is authoritative for the rewritten memory list.     │
│  Existing memories may be rewritten, merged, removed, or     │
│  superseded. This is accepted because the memory file is     │
│  small and memory extraction is not mission-critical data    │
│  storage.                                                    │
└──────────────────────────────────────────────────────────────┘
```

**Generic architecture note:** The `collectMemoryCandidates` function is designed to be extensible. New candidate sources can be added by appending to the returned array without changing the memory extraction engine. The app currently returns two candidate types (user messages and ask_questions answers), but the architecture supports adding form submissions, tool answers, onboarding answers, etc.

---

## 9. Component Responsibilities

### 9.1 `collectMemoryCandidates(messages: UIMessage[]): MemoryExtractionCandidate[]`

**New function.** Replaces `findLastUserMessageForExtraction()`, `findLastAskQuestionsForExtraction()`, and the extraction usage of `isEligibleForMemoryExtraction()`.

Scans messages from end to start, collecting at most ONE candidate per source type:

- **`source: "user-message"`**: Finds the last user message (`role === "user"`) with text content.
- **`source: "tool-answer"`**: Finds the last assistant message with at least one `tool-ask_questions` part in `"output-available"` state with non-empty answers.



```
Contract:
  Input:  UIMessage[]
  Output: MemoryExtractionCandidate[]  (0-2 entries)
  Pure:   yes (no side effects, no logging, no state mutation)
  Throws: never
```

**Export location:** `collectMemoryCandidates` is exported from `src/lib/transport/index.ts` (the transport module, where candidate collection and trigger logic live). It is NOT exported from `src/lib/memory-agent.ts` (which exports only `extractAndStoreMemories`). Tests import it directly from the transport module.

Candidates are collected by scanning from the end, but before returning they are sorted by `messageIndex` ascending so extraction runs in conversation order (oldest-first). This matters because each extraction lets the LLM rewrite the full memory list. Oldest-first is easier to reason about.

### 9.2 `MemoryExtractionCandidate` Type

```typescript
type MemoryExtractionCandidate = {
  id: string           // dedup key (message ID for user messages, assistant message ID for ask_questions)
  source: "user-message" | "tool-answer"
  toolName?: "ask_questions"   // present only for tool-answer sources; keeps generic architecture clean
  content: string      // text to send to the LLM
  messageIndex: number // position in the messages array — used for chronological sorting
  metadata?: Record<string, unknown>
}
```

### 9.3 `isEligibleForMemoryExtraction(message: UIMessage): boolean`

**May remain exported for backward compatibility but is NOT used by the new extraction logic.** The new flow uses `collectMemoryCandidates` exclusively. If kept, it can be updated to also return `true` for assistant messages with `tool-ask_questions` answers, but this is optional — it is not on the new code path.

### 9.4 `extractAndStoreMemories(userContent, getResearchFolder, model, abortSignal, deps)`

**Signature unchanged.** Behavior changed internally.

**Before:**
1. Receive user text
2. Send to LLM → LLM returns JSON array of NEW facts only
3. Read existing memories.md
4. Code-level `Set` merge: `new Set([...existing, ...newFacts])`
5. Write merged

**After:**
1. Receive user text (raw user message or structured JSON Q&A text)
2. Resolve research folder — if `null` or empty, THROW `Error("No research folder available for memory extraction.")`
3. Enter `serializedWrite` queue for the folder (guards entire read+LLM+write cycle)
4. Read existing memories.md content inside `serializedWrite` (read failure → THROW)
5. Build prompt: existing memories context + new user content (see §11.2)
6. Send to LLM with updated system prompt (inside `serializedWrite`; LLM failure → THROW)
7. LLM returns COMPLETE merged JSON array
8. Validate: must be JSON array of strings (invalid JSON → THROW; non-array → THROW)
9. Filter to strings, trim, normalize newlines. If all entries are empty/trivial after trim → return `{ memoriesStored: 0 }`
10. Format as memories.md markdown
11. Write to research folder (inside `serializedWrite`; write failure → THROW)
12. Return `{ memoriesStored: number_of_facts_in_merged_array }`

```
Contract:
  Input:  userContent: string, getResearchFolder: () => Promise<string | null | undefined>,
          model: LanguageModel, abortSignal?: AbortSignal,
          deps?: { readAppFile?, writeAppFile?, emitEvent? }
  Output: Promise<{ memoriesStored: number }>
  Throws: Error if research folder is unavailable
  Throws: Error if readAppFile fails
  Throws: Error if LLM call fails (API error, network error)
  Throws: Error if LLM returns invalid JSON
  Throws: Error if LLM returns non-array JSON
  Throws: Error if writeAppFile fails
  Returns { memoriesStored: 0 }: only if LLM returns [] or all entries are empty after trim
```

**Key change:** `memoriesStored` is the total number of facts in the merged output. The caller (`sendMessages`) does not use the return value for any decision; it is only returned for observability.

**The LLM is authoritative for the rewritten memory list.** Existing memories may be rewritten, merged, removed, or superseded. This is accepted because the memory file is small and memory extraction is not mission-critical data storage.

### 9.5 `processedMemoryMessageIds` Tracking

This `Set<string>` on `DirectTransport` tracks message IDs that have already been successfully extracted.

**Rules:**
- Check `processedMemoryMessageIds.has(candidate.id)` before triggering.
- Add `candidate.id` ONLY AFTER `extractAndStoreMemories` succeeds (returns without throwing).
- If extraction throws, the ID is NOT added — allowing retry on the next `sendMessages` call (if the error is transient).
- The set is never cleared during a session.
- The set naturally expires when `DirectTransport` is garbage collected (page navigation or tab close).

---

## 10. Interfaces & Boundaries

### 10.1 Call Site: `DirectTransport.sendMessages()` Trigger Block

**Location:** `src/lib/transport/index.ts`, lines 135-167

**Current structure (pseudocode):**
```
if (transport.researchFolder && trigger === "submit-message") {
  candidate = findLastUserMessageForExtraction(messages)
  if (candidate && !processedMemoryMessageIds.has(candidate.id)) {
    processedMemoryMessageIds.add(candidate.id)
    logDebug("triggering memory extraction")
    void extractAndStoreMemories(candidate.text, ...).catch(...)
  }
}
```

**New structure (pseudocode):**
```
if (transport.researchFolder && trigger === "submit-message") {
  const correlationId = crypto.randomUUID()

  const candidates = collectMemoryCandidates(messages)

  if (candidates.length === 0) {
    console.debug("[memory-extraction]", {
      correlationId,
      decision: "skip-no-candidate",
    })
  }

  for (const candidate of candidates) {
    if (processedMemoryMessageIds.has(candidate.id)) {
      console.debug("[memory-extraction]", {
        correlationId,
        candidateId: candidate.id,
        source: candidate.source,
        toolName: candidate.toolName,
        decision: "skip-processed",
      })
      continue
    }

    console.debug("[memory-extraction]", {
      correlationId,
      candidateId: candidate.id,
      source: candidate.source,
      toolName: candidate.toolName,
      decision: "extract",
      contentLength: candidate.content.length,
    })

    await extractAndStoreMemories(
      candidate.content,
      async () => transport.researchFolder!,
      model,
      abortSignal,
      { emitEvent: subAgentEmitter },
    )
    // ↑ AWAITED — if it throws, the error propagates to the outer catch

    processedMemoryMessageIds.add(candidate.id)
    // ↑ ONLY after successful extraction
  }
}
```

**Key design decisions:**
- `collectMemoryCandidates` returns 0-2 candidates. The loop processes each sequentially with `await`.
- Message IDs are added to `processedMemoryMessageIds` ONLY after a successful `await` (the extraction did not throw).
- If any extraction throws, the error propagates. Remaining candidates are NOT processed. `createGuardedStream` is NOT called.
- A single `correlationId` is generated once per `sendMessages()` call and reused across all decision logs.

### 10.2 `extractAndStoreMemories` LLM Prompt Construction

**Input to LLM `prompt` parameter:**

```
Here are the existing memories stored about the user:

<existing_memories_content_or_"None.">

Here is new user content to analyze for additional memories:

<user_content>
```

The system prompt (`memory-agent-prompt.md` — updated, see §11.3) instructs the LLM to:
1. Review existing memories and new user content.
2. Extract durable facts from the new user content.
3. Return a COMPLETE merged JSON array containing all facts (existing + newly extracted).
4. Deduplicate semantically identical facts, keeping the more precise/preferred phrasing.

### 10.3 Tauri CSP / Capabilities

No changes required. No new external domains are introduced.

---

## 11. Data Models & Contracts

### 11.1 Structured Q&A Format (JSON)

When ask_questions answers are found, the text passed to `extractAndStoreMemories` is constructed as a JSON array:

```text
The following content contains user-authored answers to app-generated questions.

[
  {
    "question": "What is your preferred programming language?",
    "answer": "TypeScript, because I prefer strong typing."
  }
]
```

**Prompt rule:** "Treat `answer` as user-authored. Treat `question` only as context."

**Construction rules:**
1. Iterate all `tool-ask_questions` parts in the assistant message.
2. For each part with `state === "output-available"`:
   - For each entry in `part.output.answers`:
     - Include as `{ "question": entry.question, "answer": entry.answer }`
3. Build the full content string: the context header + `JSON.stringify(array, null, 2)`.
4. If the array is empty, candidate is `null`.

**Multiple parts in one message:** All answers across all eligible parts are batched into a single JSON array.

**Example input `tool-ask_questions` part:**
```json
{
  "type": "tool-ask_questions",
  "state": "output-available",
  "output": {
    "answers": [
      { "question": "What is your preferred programming language?", "answer": "TypeScript", "custom": false },
      { "question": "What is your preferred OS?", "answer": "macOS", "custom": false }
    ]
  }
}
```

**Resulting text passed to extractAndStoreMemories:**
```
The following content contains user-authored answers to app-generated questions.

[
  {
    "question": "What is your preferred programming language?",
    "answer": "TypeScript"
  },
  {
    "question": "What is your preferred OS?",
    "answer": "macOS"
  }
]
```

### 11.2 `extractAndStoreMemories` Prompt Template

When `existingContent` is `null` or empty string:
```
Here are the existing memories stored about the user:

None.

Here is new user content to analyze for additional memories:

<userContent>
```

When `existingContent` is non-empty:
```
Here are the existing memories stored about the user:

<existingContent>

Here is new user content to analyze for additional memories:

<userContent>
```

**Note:** The existing content is passed as raw markdown text (the full `memories.md` file content including `# Memories` header and bullet lists). This gives the LLM full context, including any non-fact content (comments, notes) the user or system may have added.

### 11.3 Updated `memory-agent-prompt.md` Content Requirements

The updated prompt MUST include:

1. **Context instruction:** "You receive EXISTING memories plus NEW user content."
2. **Merge instruction:** "Your job is to return the COMPLETE merged list of all durable user facts — both existing and newly extracted — as a single JSON array of strings."
3. **Deduplication instruction:** "If a fact in the new content is semantically identical to an existing fact, do NOT include it as a duplicate. Keep the more specific or precise phrasing."
4. **Valuing existing memories:** "Preserve ALL existing memories unless a new fact supersedes it with more specific information. Do NOT drop existing facts unless they are contradicted or made redundant by new content."
5. **Output format:** "Return only a JSON array of strings. Do not include markdown, explanations, confidence scores, keys, or objects."
6. **Extraction rules:** Retain all existing rules about what to extract (durable preferences, habits, ownership) and what NOT to extract (tasks, temporary details, sensitive info, weak inferences).
7. **No change to memory style:** Each memory must start with "User", be a complete sentence, atomic, concise.
8. **Structured Q&A recognition:** The content may include a JSON array of question-answer pairs. The "answer" field represents the user's own words and may contain durable facts about the user. The "question" field is only context.
9. **Example:** Include at least one example showing extraction from structured Q&A JSON. Input: `[{"question": "What is your preferred programming language?", "answer": "TypeScript, because I prefer strong typing."}]` Expected extraction: `["User prefers TypeScript because of strong typing."]`.

### 11.4 LLM Output Validation Contract

After receiving the LLM's text output:

1. **Strip markdown fences:** `stripMarkdownJsonFence(text)` — unchanged.
2. **Parse JSON:** `JSON.parse(stripped)`.
3. **Validation checks (in order):**
   a. If parsing throws → THROW (was: return `{ memoriesStored: 0 }`).
   b. If result is not an array → THROW (was: return `{ memoriesStored: 0 }`).
   c. If any array entry is not a string, THROW `Error("LLM returned non-string entry in array")`.
   d. Trim each string and replace `\n` with ` ` (same normalization as current).
   e. Remove empty strings after trim.
    f. If resulting array is empty → return `{ memoriesStored: 0 }`. Do NOT modify `memories.md` on disk. Existing memories are preserved.
4. **Trust the LLM's merge:** Do NOT perform additional code-level deduplication (no `new Set()`). The LLM output IS the authoritative merged list.

### 11.5 `memories.md` Write Contract

**Format (unchanged):**
```markdown
# Memories

- Fact one.
- Fact two.
```

Written via `formatMemoriesContent(facts: string[]): string` (unchanged function).

---

## 12. Execution Flow, Step by Step

### 12.1 `sendMessages()` Trigger Flow

```
1. Enter sendMessages()
2. Validate chat model exists
3. Enter ReadableStream start()
4. ─── Trigger guard (only if trigger === "submit-message") ───
5.   IF researchFolder is falsy → skip all extraction (unchanged)
6.
7.   correlationId = crypto.randomUUID()  // one per sendMessages evaluation
8.
9.   candidates = collectMemoryCandidates(messages)
10.
11.   IF candidates.length === 0:
12.     console.debug("[memory-extraction]", {
13.       correlationId,
14.       decision: "skip-no-candidate",
15.     })
16.
17.   FOR EACH candidate OF candidates:
18.     IF processedMemoryMessageIds.has(candidate.id):
19.       console.debug("[memory-extraction]", {
20.         correlationId,
21.         candidateId: candidate.id,
22.         source: candidate.source,
23.         toolName: candidate.toolName,
24.         decision: "skip-processed",
25.       })
26.       CONTINUE
27.

28.     console.debug("[memory-extraction]", {
29.       correlationId,
30.       candidateId: candidate.id,
31.       source: candidate.source,
32.       toolName: candidate.toolName,
33.       decision: "extract",
34.       contentLength: candidate.content.length,
35.     })
36.
37.     await extractAndStoreMemories(candidate.content, ...)
38.       // ↑ BLOCKING — if throws, error propagates, createGuardedStream NEVER runs
39.
40.     processedMemoryMessageIds.add(candidate.id)
41.       // ↑ ONLY after successful extraction
42.
43. ─── End trigger guard ───
44.
45. createGuardedStream(...) // only reached if all extractions succeeded
```

### 12.2 `extractAndStoreMemories()` Internal Flow

```
1. Start
2. ─── Resolve folder (throws to call site if null/empty) ───
3. folder = await getResearchFolder()
4. IF folder is null or empty string:
5.   THROW new Error("No research folder available for memory extraction.")
6.
7. Log "starting extraction" (subAgentId, messageLength)
8. Emit "start" sub-agent event
9.
10. memorySubfolder = `${SEARCH_RESULTS_SUBFOLDER}/${folder}`
11. ─── Read + LLM + Write (guarded by serializedWrite) ───
12. stored = await serializedWrite(memorySubfolder, async () => {
13.   // Step A: Read existing memories INSIDE serializedWrite
14.   // If memories.md does not exist (first-time extraction), readAppFile returns null.
15.   // This is NOT a read failure — treat as None. Only unexpected I/O errors throw.
16.   // Read failure (permissions, disk error) → THROW (rejected promise from callback)
17.   existingContent = await _readAppFile({
18.     subfolder: memorySubfolder,
19.     filename: "memories.md"
20.   })
21.
22.   // Step B: Build LLM prompt
23.   prompt = buildMemoryExtractionPrompt(existingContent, userContent)
24.
25.   // Step C: Call LLM
26.   // LLM failure → THROW
27.   result = streamText({
28.     model,
29.     system: memoryAgentPrompt,
30.     prompt,
31.     abortSignal
32.   })
33.
34.   // Step D: Stream text chunks to event emitter
35.   for await (textPart of result.textStream):
36.     chunksReceived++
37.     emit text-delta event
38.
39.   text = await result.text
40.   log "stream completed" (chunksReceived, resultLength, resultPreview)
41.
42.   // Step E: Parse LLM output
43.   stripped = stripMarkdownJsonFence(text)
44.   parsed = JSON.parse(stripped)
45.     // CATCH: if not valid JSON → THROW
46.   IF NOT Array.isArray(parsed):
47.     THROW new Error("LLM returned non-array JSON")
48.   facts = parsed
49.     .map(f => { if (typeof f !== "string") throw new Error("LLM returned non-string entry in array"); return f; })
50.     .map(f => f.replace(/\n/g, " ").trim())
51.     .filter(f => f.length > 0)
52.
53.   IF facts.length === 0:
54.     // Only non-technical return path: no facts to store
55.     RETURN 0
56.
57.   // Step F: Write merged memories (INSIDE serializedWrite callback)
58.   // Write failure → THROW
59.   logDebug "writing merged memories" (factCount: facts.length)
60.   content = formatMemoriesContent(facts)
61.   await _writeAppFile({ subfolder: memorySubfolder, filename: "memories.md", content })
62.   logDebug "memories stored" (stored: facts.length, total: facts.length)
63.   return facts.length
64. })
65.   // ↑ serializedWrite rejects if the callback throws
66.
67. IF stored === 0:
68.   // serializedWrite callback returned early (no facts)
69.   emit "complete" event
70.   RETURN { memoriesStored: 0 }
71.
72. emit "complete" event
73. RETURN { memoriesStored: stored }
```

**Key structural changes:**
- Folder resolution happens before `serializedWrite`. If the folder is missing, the function throws.
- The entire read-LLM-write cycle is inside `serializedWrite`'s callback. If any step in the callback throws, `serializedWrite`'s returned promise rejects, and the error propagates.
- Technical failures (read, LLM, write, parse) all THROW. Only the "no facts" path returns `{ memoriesStored: 0 }`.
- The read step reads raw markdown text (full `memories.md` file content), not parsed facts. `parseMemoriesContent()` is not used in the new flow.

### 12.3 `collectMemoryCandidates()` Internal Flow

```
1. Initialize result: MemoryExtractionCandidate[] = []
2. Initialize foundSources: Set<string> = new Set()
3.
4. For i = messages.length - 1 down to 0:
5.   msg = messages[i]
6.
7.   // Source: user-message
8.   IF msg.role === "user" AND NOT foundSources.has("user-message"):
9.     text = msg.parts
10.      .filter(p => p.type === "text")
11.      .map(p => p.text)
12.      .join(" ")
13.      .trim()
14.    IF text is not empty:
15.      result.push({ id: msg.id, source: "user-message", content: text, messageIndex: i })
16.      foundSources.add("user-message")
17.
18.  // Source: tool-answer
19.  IF msg.role === "assistant" AND NOT foundSources.has("tool-answer"):
20.    qaEntries: Array<{ question: string, answer: string }> = []
21.
22.    FOR EACH part IN msg.parts:
23.      IF NOT (isRecord(part) AND part.type === "tool-ask_questions"):
24.        CONTINUE
25.      IF part.state !== "output-available":
26.        CONTINUE
27.      IF NOT (isRecord(part.output) AND Array.isArray(part.output.answers)):
28.        CONTINUE
29.
30.      FOR EACH entry IN part.output.answers:
31.        IF NOT isRecord(entry):
32.          CONTINUE
33.        IF typeof entry.question !== "string":
34.          CONTINUE
35.        IF typeof entry.answer !== "string":
36.          CONTINUE
37.        answerText = entry.answer.trim()
38.        IF answerText.length === 0:
39.          CONTINUE
40.        qaEntries.push({
41.          question: entry.question.trim(),
42.          answer: answerText
43.        })
44.
45.    // A tool-answer candidate exists only when at least one valid, non-empty answer exists.
46.    // Unanswered, empty, malformed, or non-output-available parts are ignored
47.    // and do NOT mark the "tool-answer" source as found.
48.    IF qaEntries.length > 0:
49.      content = "The following content contains user-authored answers to app-generated questions.\n\n" +
50.                JSON.stringify(qaEntries, null, 2)
51.      result.push({
52.        id: msg.id,
53.        source: "tool-answer",
54.        toolName: "ask_questions",
55.        content,
56.        messageIndex: i
57.      })
58.      foundSources.add("tool-answer")
59.
60.  // Stop scanning once all sources are found
61.  IF foundSources.size === 2:
62.    BREAK
63.
64. // Sort candidates chronologically (oldest-first) for predictable extraction order
65. RETURN result.sort((a, b) => a.messageIndex - b.messageIndex)
```


---

## 13. Error Handling & Edge Cases

### 13.1 Error: No Research Folder

| Condition | Behavior |
|-----------|----------|
| `extractAndStoreMemories` called but `getResearchFolder()` returns `null`, `undefined`, or `""` | THROW `new Error("No research folder available for memory extraction.")` |
| `transport.researchFolder` is falsy at trigger point | Skip extraction entirely (unchanged, the outer trigger guard) |

The throw propagates to `sendMessages()`'s `catch` block. `createGuardedStream` is never called.

### 13.2 Error: LLM Returns Invalid Output

| Condition | Behavior |
|-----------|----------|
| LLM output is not valid JSON | THROW error (was: return `{ memoriesStored: 0 }`) |
| LLM output is valid JSON but not an array | THROW error (was: return `{ memoriesStored: 0 }`) |
| LLM output is an array with non-string entries | THROW (any non-string entry is a model-format failure) |
| LLM output is an empty array `[]` | Return `{ memoriesStored: 0 }`. Do NOT write to `memories.md`. Existing memories on disk are preserved. |
| LLM output contains strings, some with newlines | Replace `\n` with `" "` in each string before writing |
| All entries are empty strings after trim | Return `{ memoriesStored: 0 }` (trivial output — not an error) |

### 13.3 Error: LLM API Failure / Network Error

| Condition | Behavior |
|-----------|----------|
| `streamText` throws | THROW error (was: catch and return `{ memoriesStored: 0 }`). Error propagates to `sendMessages()`'s catch block. |
| Request is aborted (`AbortError`) | THROW `AbortError` (may be handled by caller, but typically propagates) |

### 13.4 Error: File I/O Failures

| Condition | Behavior |
|-----------|----------|
| `memories.md` does not exist (first-time extraction) | NOT a read failure. Treat existing memories as `None.` (see §11.2). |
| `readAppFile` fails unexpectedly (permissions, disk error) | THROW — error propagates through `serializedWrite` |
| `writeAppFile` fails inside `serializedWrite` callback | THROW — error propagates through `serializedWrite` |

Only unexpected read failures throw. Missing `memories.md` is a normal first-run condition.

### 13.5 Edge Case: Same Message Sent Multiple Times

| Condition | Behavior |
|-----------|----------|
| Same user message ID appears in multiple `sendMessages()` calls | `processedMemoryMessageIds` prevents re-extraction after first successful extraction |
| Same assistant message ID (with ask_questions answers) appears in multiple `sendMessages()` calls | `processedMemoryMessageIds` prevents re-extraction after first successful extraction |
| Message ID is in `processedMemoryMessageIds` but extraction previously failed | ID was NOT added (only added on success). The message IS retried in the next `sendMessages` call. |

### 13.6 Edge Case: Ask-Questions Part States

| Part state | Treatment |
|------------|-----------|
| `"input-available"` (questions rendered, not answered) | NOT eligible — skip |
| `"output-available"` (answers submitted) | Eligible — extract |
| `"output-error"` (tool failed) | NOT eligible — skip |
| Missing `output` property | NOT eligible — skip |
| `output.answers` is not an array | NOT eligible — skip |
| `output.answers` is an empty array | NOT eligible — skip |

### 13.7 Edge Case: Answers with Missing Fields

| Condition | Behavior |
|-----------|----------|
| Answer entry missing `question` | Skip that entry |
| Answer entry missing `answer` | Skip that entry |
| Answer entry `answer` is empty string after trim | Skip that entry |
| All entries are skipped | Candidate is `null` (no extraction) |

### 13.8 Edge Case: User Sends Empty Message

| Condition | Behavior |
|-----------|----------|
| User message has no `type: "text"` parts | Not eligible (empty text) |
| All user text parts trim to empty string | Not eligible |

### 13.9 Edge Case: Ask-Questions Generated Questions (NOT Answers)

The model calling `ask_questions` produces a `tool-ask_questions` part on an assistant message. The part state will be `"input-available"` (or no state) until the user answers. These are NOT eligible for extraction (`state !== "output-available"`).

### 13.10 Edge Case: LLM Returns Facetiously Wrong Merge

If the LLM drops existing facts or introduces incorrect facts in its merge, there is no programmatic correction. The code trusts the LLM's merge output. This is an accepted risk (see §9.4 LLM rewrite acceptance). Observability is via `memories.md` file history (the user can manually revert).

### 13.11 Edge Case: Very Large `memories.md`

If `memories.md` grows very large, the prompt sent to the LLM will be correspondingly large. This could exceed context window limits. No token-counting or truncation is specified. The LLM's context window is assumed sufficient for typical usage. If this becomes a problem, it would be addressed in a future change (see §21).

### 13.12 Edge Case: User Answers Typed in Composer (Not via QuestionsToolUI)

If the user types their answer to a question directly into the composer instead of using the `QuestionsToolUI`, the answer is a normal user message (`role: "user"`) and is extracted via the `user-message` source. If both the UI and the composer are used for different parts of the answer, both source types fire independently — the LLM merge handles deduplication. No special handling required.

### 13.13 Edge Case: Manual Edits to memories.md

Any non-bullet content (prose notes, section dividers, free-form comments) in `memories.md` will be lost the next time extraction runs, because the LLM only returns a JSON array of fact strings and the code reformats them as bullets via `formatMemoriesContent()`. This is a known limitation. Users should keep all memories in the standard bullet format (`- Fact text.`).


### 13.14 Edge Case: User Ignores ask_questions and Sends a Normal Message

If the assistant has an unanswered `tool-ask_questions` part (state `"input-available"`) and the user sends a normal composer message instead of answering through `QuestionsToolUI`, the unanswered questions are ignored for memory extraction.

Rules:
- `tool-ask_questions` with `state !== "output-available"` is not a memory candidate.
- Unanswered questions are not errors.
- Unanswered questions do not block extraction from normal user messages.
- Unanswered questions are not added to `processedMemoryMessageIds`.
- The normal user message is extracted through the `user-message` source.
- No warning is logged.


---

## 14. Deterministic Rules the Agent Must Follow

### 14.1 Implementation Order

1. **Update `memory-agent-prompt.md` first.** The LLM must know about the new prompt format before any code calls it with the new format.
2. **Update `extractAndStoreMemories()` second.** Add folder-guard throw, change prompt construction, change dedup from code-level to LLM-level, add throwing for technical failures, change return value semantics.
3. **Create `collectMemoryCandidates()` third.** New function replacing old helper functions.
4. **Update trigger block in `DirectTransport.sendMessages()` fourth.** Use `collectMemoryCandidates`, change from `void` to `await`, move `processedMemoryMessageIds.add` to after successful extraction.
5. **Update logging fifth.** Apply minimal logging format.
6. **Update `memory-agent.test.ts` tests sixth.**
7. **Update `memory-extraction-guard.test.ts` tests seventh.**

### 14.2 Code Change Rules

- **Do NOT modify** `getAskQuestionsAnswers()` — it is still used by `getPreviousResearchChoice()`; the new extraction code reads answers directly from parts.
- **Do NOT modify** `formatMemoriesContent()` — it is still needed for writing the markdown file format. `parseMemoriesContent()` becomes unused code; the implementation MAY remove it or keep it unused.
- **Do NOT modify** `serializedWrite()` or the folder-queue mechanism.
- **Do NOT modify** `QuestionsToolUI`, `questionResultSchema`, or `questionsInputSchema`.
- **Do NOT modify** `createGuardedStream()`.
- **Do NOT introduce** new npm dependencies.
- **Do NOT change** the positional parameters or call shape of `extractAndStoreMemories`. The `getResearchFolder` callback type may be widened to `Promise<string | null | undefined>`. Existing callers must still compile.
- **Do NOT change** the exports from `src/lib/memory-agent.ts` (only `extractAndStoreMemories` is exported).
- **Do NOT add candidate IDs to `processedMemoryMessageIds` before extraction succeeds.**
- **All technical extraction failures are fatal to `sendMessages()`.** The error propagates through the `await` and reaches the outer catch block.

### 14.3 Logging Format

All extraction-related `console.debug` calls use the prefix `[memory-extraction]` with a structured object as the second argument.

Minimal fields:

| Field | Type | Values | When present |
|-------|------|--------|-------------|
| `correlationId` | `string` | `crypto.randomUUID()` | On ALL decision logs |
| `candidateId` | `string` | Message ID | On "extract" and "skip-processed" decisions |
| `source` | `string` | `"user-message"`, `"tool-answer"` | On "extract" and "skip-processed" decisions |
| `toolName` | `string?` | `"ask_questions"` | On "extract" and "skip-processed" decisions when `source === "tool-answer"` |
| `decision` | `string` | `"extract"`, `"skip-processed"`, `"skip-no-candidate"` | On ALL decision logs |
| `contentLength` | `number` | Character count | On "extract" decision only |

Use `console.debug("[memory-extraction]", { correlationId, candidateId, source, toolName?, decision, contentLength? })`. The `toolName` field is included when `source === "tool-answer"`. The `contentLength` field is included only on `decision: "extract"`.

**Existing `logDebug` calls in `memory-agent.ts`** (using `[memory-extraction]` prefix with internal fields like `subAgentId`, `messageLength`, `chunksReceived`, etc.) are unchanged. The simplified logging applies to the trigger guard in `sendMessages()` only.

### 14.4 Return Value Semantics of `extractAndStoreMemories`

| Scenario | Return value |
|----------|-------------|
| LLM returns merged facts, write succeeds | `{ memoriesStored: <number_of_facts_in_output> }` |
| LLM returns `[]` (no facts) | `{ memoriesStored: 0 }` |
| All fact entries are empty strings after trim | `{ memoriesStored: 0 }` |
| No research folder | THROWS |
| Read failure | THROWS |
| LLM call fails (API error) | THROWS |
| LLM returns invalid JSON | THROWS |
| LLM returns non-array JSON | THROWS |
| LLM array contains non-string entries | THROWS |
| Write failure | THROWS |

**BREAKING SEMANTIC CHANGE:** The return value `memoriesStored` changes from "count of new facts" to "total facts in merged output". All existing callers and tests that read this value must be updated.

### 14.5 What NOT to Extract (Trigger Guard)

The following message types MUST NOT trigger memory extraction under any circumstances:

| Message type | How detected | Behavior |
|-------------|-------------|----------|
| Assistant message without ask_questions answers | `role === "assistant"` AND no matching tool part | Skip |
| Tool invocation (call state) | `role === "assistant"` AND part is `tool-invocation` with `state: "call"` | Skip |
| Tool result (output state) | `role === "assistant"` AND part is `tool-invocation` with `state: "result"` | Skip |
| Sub-agent assistant messages | Implicitly skipped — `role === "assistant"` but no eligible ask_questions parts | Skip |
| Sub-agent tool calls | Implicitly skipped | Skip |
| Sub-agent tool outputs | Implicitly skipped | Skip |
| System messages | `role === "system"` | Skip |
| Synthetic/internal app messages | `role` is not `"user"` or `"assistant"` | Skip |
| ASK_QUESTIONS tool call (questions generated, NOT answered) | `tool-ask_questions` part, `state !== "output-available"` | Skip |
| `regenerate-message` trigger | `trigger !== "submit-message"` | Skip entire trigger block |
| Already-processed message | `processedMemoryMessageIds.has(id)` | Skip, log as `"skip-processed"` |

---

## 15. External Dependencies & Verified Research

### 15.1 Verified Dependencies

| Dependency | Version / Source | Usage |
|-----------|-----------------|-------|
| `ai` (Vercel AI SDK) | Existing | `streamText`, `UIMessage`, `LanguageModel` types |
| `ai/test` (MockLanguageModelV3) | Existing | Unit test mocking |
| `@/lib/app-file-storage` | Existing | `readAppFile`, `writeAppFile`, `SafePathSegmentSchema` |
| `@/lib/memory-agent-prompt.md?raw` | Existing | Imported as raw string for system prompt |
| `@/lib/research-history` | Existing | `SEARCH_RESULTS_SUBFOLDER` constant |
| `@/lib/sub-agent-types` | Existing | `createSubAgentId`, `SubAgentEvent` |
| `@/lib/sub-agent-emitter` | Existing | `emitSubAgentEvent` |
| `@/lib/abort` | Existing | `isAbortError`, `throwIfAborted` |
| `@/lib/json` | Existing | `isRecord` utility |
| `@assistant-ui/react` | Existing | `useChat` auto-send uses trigger `"submit-message"` (verified from source) |

### 15.2 No New Dependencies

No new npm packages, external services, or APIs are introduced by this change.

### 15.3 Compatibility

- **Tauri v2:** No Rust/Tauri code changes. No new IPC calls.
- **Node sidecar:** No sidecar involvement.
- **CSP / Capabilities:** No new external domains.
- **Browser APIs:** `crypto.randomUUID()` is used for correlation IDs. Verified available in Tauri webview (Chromium).

---

## 16. Security, Privacy & Compliance Requirements

### 16.1 API Key Exposure

- Memory extraction uses the same LLM model as the main conversation (passed via `model` parameter).
- No new API key storage, transmission, or configuration.
- The `memories.md` file is stored locally in the app data directory; no remote transmission of memories content.

### 16.2 Sensitive Information

- The existing `memory-agent-prompt.md` already instructs the LLM NOT to extract sensitive information (API keys, passwords, medical, financial, legal).
- This behavior is preserved and reinforced in the updated prompt.
- The LLM's merge output may persist previously extracted facts that contain borderline information. This is no worse than the current behavior where facts accumulate over time.

### 16.3 Logging

- `console.debug` calls use structured objects. No sensitive data in log fields.
- No full message text is logged in the new minimal format (only `contentLength`, no `messagePreview`).
- Correlation IDs are random UUIDs with no PII.

### N/A Sections

- GDPR / data deletion (local app only; no server-side data).
- Authentication / authorization (no new auth flows).
- Encryption at rest (delegated to Tauri/OS; unchanged).

---

## 17. Performance & Operational Constraints

### 17.1 LLM Call Impact

- Each `extractAndStoreMemories` call makes one LLM API request.
- Adding ask_questions answer extraction means up to one additional LLM call per `sendMessages` invocation (if both a user message and unprocessed ask_questions answers exist).
- LLM calls are AWAITED before the guarded stream. They block `createGuardedStream` until they complete (or throw).
- Multiple candidates are processed sequentially in the loop, not in parallel.

### 17.2 Prompt Size

- The LLM prompt now includes existing `memories.md` content. For typical usage (tens of facts), this is negligible compared to the system prompt and extraction rules.
- No token budget or truncation is implemented. See §13.11 for the edge case of very large files.

### 17.3 File I/O

- One read (`memories.md`) and potentially one write per extraction call.
- Reads and writes are both serialized through the folder queue. The entire read-LLM-write cycle is guarded by `serializedWrite`, preventing concurrent extractions to the same folder from reading stale state or overwriting each other.
- `streamText` is never called if the research folder is missing (the throw happens before the serializedWrite block, before LLM invocation).
- **This intentionally serializes LLM calls per research folder. Simplicity is preferred over throughput.**

### 17.4 Memory (RAM)

- `processedMemoryMessageIds` is a `Set<string>` tracking message IDs. For typical sessions (tens of messages), this is negligible.
- The set is NOT persisted; it resets on page reload or new `DirectTransport` construction.

---

## 18. Logging, Observability & Debugging

### 18.1 Minimal Trigger Guard Logging

All trigger guard logs use `console.debug("[memory-extraction]", { ... })`.

| Decision | Fields |
|----------|--------|
| `"extract"` | `correlationId`, `candidateId`, `source`, `toolName` (when `source === "tool-answer"`), `decision: "extract"`, `contentLength` |
| `"skip-processed"` | `correlationId`, `candidateId`, `source`, `toolName` (when `source === "tool-answer"`), `decision: "skip-processed"` |
| `"skip-no-candidate"` | `correlationId`, `decision: "skip-no-candidate"` |

One `correlationId` per `sendMessages()` call, reused across all decision logs in that call.

Example:
```typescript
console.debug("[memory-extraction]", {
  correlationId: "abc-123",
  candidateId: "msg-uuid",
  source: "user-message",
  decision: "extract",
  contentLength: 42,
})
```

### 18.2 Internal Memory Agent Logs (Unchanged)

Existing `logDebug` and `logWarn` calls inside `memory-agent.ts` use the `[memory-extraction]` prefix and keep their existing fields (`subAgentId`, `messageLength`, `chunksReceived`, `resultLength`, `resultPreview`, `factCount`, `stored`, `total`, `error`, `type`, `rawPreview`, `key`, `previousError`). These internal logs are unchanged.

### 18.3 Sub-Agent Events

`extractAndStoreMemories` emits the following sub-agent events (unchanged from current):

| Event type | When |
|-----------|------|
| `"start"` | Beginning of extraction |
| `"text-delta"` | Each text chunk from LLM stream |
| `"complete"` | Successful completion (with or without facts) |
| `"cancelled"` | Extraction aborted by user |
| `"error"` | LLM call failed (non-abort) — note: now followed by throw |

---

## 19. Validation & Testing Requirements

### 19.1 Test Plan Overview

| Layer | Scope | Rationale |
|-------|-------|-----------|
| Unit — Guard | `memory-extraction-guard.test.ts` | `collectMemoryCandidates` candidate collection, source types, edge cases |
| Unit — Agent | `memory-agent.test.ts` | `extractAndStoreMemories` internal: prompt construction, LLM merge, throwing behavior, file I/O |
| Integration | N/A | No integration tests required (no new external integrations) |
| E2E | N/A | No E2E tests required (no existing E2E memory tests) |

### 19.2 Unit Tests: `memory-extraction-guard.test.ts`

#### 19.2.1 Tests to Modify (Existing Tests)

These tests currently test `isEligibleForMemoryExtraction`. Update or remove them since eligibility is now handled by `collectMemoryCandidates`:

| Test | Status | Change needed |
|------|--------|---------------|
| `"returns true for user role"` | Replace | Test `collectMemoryCandidates` returns a user-message candidate for user messages with text |
| `"returns false for assistant role"` | Replace | Test `collectMemoryCandidates` does NOT return for assistant messages without ask_questions parts |
| `"returns false for system role"` | Replace | Test `collectMemoryCandidates` does NOT return for system messages |
| `"returns false for non-user roles"` | Replace | Test `collectMemoryCandidates` correctly gates on role |
| All `DirectTransport` guard tests | Modify | Tests that verify `extractAndStoreMemories` is AWAITED (not fire-and-forget), and that `processedMemoryMessageIds.add` happens after success. Tests should continue to verify that tool calls, tool outputs, sub-agent messages do NOT trigger. |

#### 19.2.2 New Tests (Required)

| ID | Test Name | Objective |
|----|-----------|-----------|
| GT-1 | `"collectMemoryCandidates returns tool-answer candidate for ask_questions answers"` | Verify that an assistant message with `tool-ask_questions` parts in `output-available` state yields a `tool-answer` candidate |
| GT-2 | `"collectMemoryCandidates constructs structured JSON Q&A content"` | Verify the content string includes the JSON array with question/answer fields |
| GT-3 | `"collectMemoryCandidates batches multiple Q&A pairs into one candidate"` | Verify that multiple answers within one message result in ONE candidate with all pairs in the JSON |
| GT-4 | `"collectMemoryCandidates batches answers from multiple ask_questions parts"` | Verify that a single assistant message with multiple `tool-ask_questions` parts batches all answers together |
| GT-5 | `"collectMemoryCandidates does not return for ask_questions part in input-available state"` | Verify `state: "input-available"` parts (questions rendered, not yet answered) do NOT produce a candidate |
| GT-6 | `"collectMemoryCandidates does not return for ask_questions part in output-error state"` | Verify `state: "output-error"` parts do NOT produce a candidate |
| GT-7 | `"collectMemoryCandidates does not return for ask_questions part without output property"` | Verify robustness against malformed parts |
| GT-8 | `"collectMemoryCandidates does not return for ask_questions part with empty answers array"` | Verify empty answers do NOT produce a candidate |
| GT-9 | `"collectMemoryCandidates skips entry with missing question field"` | Verify entries missing `question` are skipped; if all skipped, no candidate |
| GT-10 | `"collectMemoryCandidates skips entry with missing answer field"` | Verify entries missing `answer` are skipped |
| GT-11 | `"collectMemoryCandidates does not return tool-answer for assistant message without ask_questions parts"` | Verify plain assistant messages do NOT produce a `tool-answer` candidate |
| GT-12 | `"collectMemoryCandidates returns both user-message and tool-answer candidates in same scan"` | Verify both sources are collected when both candidate types exist |
| GT-13 | `"ask_questions answer extracts even when prior user message ID is already processed"` | User sends "I have a dog" (msg-1 extracted). Model calls ask_questions. User answers. Verify the ask_questions assistant message is still extracted despite msg-1 already being processed. |
| GT-15 | `"ignores unanswered ask_questions and extracts normal user message"` | Assistant has `input-available` ask_questions part. User sends normal message. Verify user-message candidate is returned, tool-answer is NOT. |
| GT-16 | `"does not mark unanswered ask_questions as processed"` | Unanswered ask_questions message ID is NOT added to `processedMemoryMessageIds`. |
| GT-17 | `"collectMemoryCandidates returns candidates sorted by messageIndex ascending"` | Messages: user at index 2, assistant-with-answers at index 5. Assert result[0].messageIndex < result[1].messageIndex. |
| GT-18 | `"extraction is awaited: failure prevents guarded stream"` | In a mock transport, verify that when `extractAndStoreMemories` throws, `createGuardedStream` is never called |
| GT-19 | `"processedMemoryMessageIds.add only after successful extraction"` | Verify that when extraction throws, the candidate ID is NOT added to the set |
| GT-20 | `"does not trigger on regenerate-message for any candidate type"` | Verify trigger gating |
| GT-21 | `"logs minimal fields: correlationId, candidateId, source, decision, contentLength"` | Verify log calls use the minimal field set |
| GT-22 | `"extracts ask_questions answers from assistant message containing mixed content"` | Assistant message has text parts, tool-ask_questions output-available, AND tool-invocation parts. Verify `collectMemoryCandidates` returns only the structured JSON from ask_questions parts. |
| GT-23 | `"collectMemoryCandidates skips already-found source types"` | Verify each source type is collected at most once, using the latest eligible message for that source (first found scanning from end). |

#### 19.2.3 Test Helpers Needed (New)

```typescript
// Create an assistant message with ask_questions answers
function askQuestionsMsg(id: string, answers: Array<{question: string, answer: string, custom?: boolean}>): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{
      type: "tool-ask_questions",
      state: "output-available",
      output: { answers },
    } as unknown as UIMessage["parts"][number]],
  };
}

// Create ask_questions input-available (not answered yet)
function askQuestionsInputMsg(id: string, questions: string[]): UIMessage { ... }

// Create ask_questions output-error
function askQuestionsErrorMsg(id: string): UIMessage { ... }
```

### 19.3 Unit Tests: `memory-agent.test.ts`

#### 19.3.1 Tests to Modify

| Test | Status | Change needed |
|------|--------|---------------|
| `"extracts facts from explicit statement"` | **Modify** | The LLM now returns COMPLETE merged list. Mock LLM must return all facts including "existing" ones. Test should verify the prompt includes existing memories and that the complete output is written. |
| `"merges with existing memories.md"` | **Modify** | The dedup is now LLM-level. The mock LLM returns the merged list. Test verifies that the prompt contains existing memories content and that the LLM's merged output is written directly. |
| `"deduplicates"` | **Modify** | The mock LLM must return a deduplicated merged list (single entry). Test verifies no code-level Set dedup occurs (no duplicate in output). |
| `"creates new file when none exists"` | **Modify** | Mock LLM returns the new facts array. Test verifies prompt shows `"None."` for existing memories. |
| `"sends the raw user message as the LLM prompt"` | **Modify** | The prompt is now structured with existing memories section. Test verifies the prompt contains the user content within the structured template. |
| `"does not throw on failure"` | **REMOVE** | Extraction now throws on failures. Replace with tests asserting the throw. |
| `"handles malformed LLM output gracefully"` | **Modify** | Invalid JSON now throws instead of returning `{ memoriesStored: 0 }` |
| `"skips non-array response"` | **Modify** | Non-array JSON now throws instead of returning `{ memoriesStored: 0 }` |

**memoriesStored semantic audit:** Audit all existing assertions on `{ memoriesStored: N }` — many tests assert specific counts that will change because `memoriesStored` now reports total facts instead of net-new.

#### 19.3.2 New Tests (Required)

| ID | Test Name | Objective |
|----|-----------|-----------|
| AT-1 | `"includes existing memories in LLM prompt when file exists"` | Verify `mockStreamText` is called with a prompt that contains the existing memories.md content |
| AT-2 | `"includes 'None.' in prompt when no existing memories"` | Verify `mockStreamText` is called with a prompt that contains `"None."` when `readAppFile` returns `null` |
| AT-3 | `"writes LLM merged output directly without code-level dedup"` | Mock LLM returns merged list. Verify `writeAppFile` receives exactly the LLM's output (no Set-based dedup applied by code) |
| AT-4 | `"throws error when research folder is null"` | Mock `getResearchFolder` to return `null`. Use `await expect(resultPromise).rejects.toThrow('No research folder available')`. Also assert `mockStreamText` was NOT called. |
| AT-5 | `"throws error when research folder is empty string or undefined"` | Mock `getResearchFolder` to return `""` and `undefined` in separate assertions. Use `await expect(resultPromise).rejects.toThrow('No research folder available')`. Also assert `mockStreamText` was NOT called. |
| AT-6 | `"returns total fact count from merged LLM output"` | Mock LLM returns 5 facts. Verify `{ memoriesStored: 5 }` |
| AT-7 | `"preserves existing facts in LLM output that the LLM returns"` | Mock existing memories with fact A, new content yields fact B. Mock LLM returns `["Fact A", "Fact B"]`. Verify both are written. |
| AT-8 | `"handles LLM dropping existing facts gracefully"` | Mock LLM returns only new facts, dropping an existing one. This is unexpected but allowed. Verify the code still writes whatever the LLM returns. |
| AT-9 | `"prompt contains structured template with existing memories"` | Verify the exact prompt format matches the template in §11.2. |
| AT-10 | `"throws on invalid JSON from LLM"` | Mock LLM returns malformed text (not parseable as JSON). Verify `extractAndStoreMemories` throws. |
| AT-11 | `"throws on non-array JSON from LLM"` | Mock LLM returns `{"key": "value"}` (valid JSON, not array). Verify `extractAndStoreMemories` throws. |
| AT-12 | `"throws on LLM API failure"` | Mock `streamText` to throw. Verify `extractAndStoreMemories` throws. |
| AT-13 | `"throws on readAppFile failure"` | Mock `readAppFile` to throw. Verify `extractAndStoreMemories` throws. |
| AT-14 | `"throws on writeAppFile failure"` | Mock `writeAppFile` to throw after LLM succeeds. Verify `extractAndStoreMemories` throws. |
| AT-15 | `"returns memoriesStored: 0 for empty LLM array"` | Mock LLM returns `[]`. Verify `{ memoriesStored: 0 }` without throwing. |
| AT-16 | `"returns memoriesStored: 0 when all entries are empty after trim"` | Mock LLM returns `["  ", "\n", ""]`. After trim/filter, array is empty. Verify `{ memoriesStored: 0 }`. |
| AT-18 | `"does not write memories.md when LLM returns an empty array"` | Mock LLM returns `[]`. Mock `writeAppFile` that would fail if called. Verify `writeAppFile` is NOT called. Verify `{ memoriesStored: 0 }`. |
| AT-19 | `"throws when LLM array contains non-string entries"` | Mock LLM returns `["valid", 42, null]`. Verify `extractAndStoreMemories` throws with a type/format error. |
| AT-20 | `"treats missing memories.md as None"` | Mock `readAppFile` returns `null`. Verify the LLM prompt contains `"None."` for existing memories. Verify extraction proceeds normally. |
| AT-17 | `"serializes concurrent extractions to same folder"` | Call `extractAndStoreMemories` twice in rapid succession against the same research folder. Verify `serializedWrite()` queued the operations and no data loss occurs. |

### 19.4 Non-Testable Items

These items rely on live LLM behavior and are verified through code review and prompt quality assessment, not automated tests:

- The LLM actually deduplicates semantically similar facts.
- The LLM preserves existing facts when merging.
- The quality of extracted facts from structured JSON Q&A content.
- Behavior when memories.md exceeds the LLM context window.

---

## 20. Acceptance Criteria

### 20.1 Core Behavior

| ID | Criterion | Pass Condition |
|----|-----------|---------------|
| AC-1 | Normal user message triggers memory extraction | `collectMemoryCandidates` returns user-message candidate; `extractAndStoreMemories` is awaited |
| AC-2 | User answer submitted through `ask_questions` triggers memory extraction | New test GT-1 passes |
| AC-3 | `ask_questions` generated question does NOT trigger memory extraction | New test GT-5 passes |
| AC-4 | `ask_questions` tool call (not answered) does NOT trigger memory extraction | New test GT-5 passes |
| AC-5 | Assistant message without ask_questions answers does NOT trigger | GT-11 test passes |
| AC-6 | Tool output does NOT trigger memory extraction | Existing tests pass (no candidate returned for tool-invocation parts) |
| AC-7 | Sub-agent output does NOT trigger memory extraction | Existing tests pass |
| AC-8 | Synthetic/internal app message does NOT trigger memory extraction | Existing tests pass |
| AC-9 | Same user-authored answer is not extracted twice | GT-19 passes (processed IDs tracked per-message; same message extracted at most once) |
| AC-10 | `ask_questions` answers trigger extraction even when original user message was already processed | GT-13 passes |
| AC-11 | `regenerate-message` does NOT trigger extraction | GT-20 passes |
| AC-12 | Extraction failure prevents guarded stream from starting | GT-18 passes |

### 20.2 LLM Merge Behavior

| ID | Criterion | Pass Condition |
|----|-----------|---------------|
| AC-13 | `extractAndStoreMemories` reads existing memories before calling LLM | New test AT-1 passes |
| AC-14 | Prompt contains `"None."` when no existing memories | New test AT-2 passes |
| AC-15 | LLM returns complete merged array; code writes LLM output directly | New test AT-3 passes |
| AC-16 | Code does NOT perform Set-based deduplication on LLM output | New test AT-3 passes (write receives exactly LLM's array) |
| AC-17 | `memoriesStored` reports total facts in merged output | New test AT-6 passes |

### 20.3 Error Handling

| ID | Criterion | Pass Condition |
|----|-----------|---------------|
| AC-18 | `extractAndStoreMemories` throws when research folder is `null` | New test AT-4 passes |
| AC-19 | `extractAndStoreMemories` throws when research folder is `""` | New test AT-5 passes |
| AC-20 | Invalid LLM JSON → throws (not returns 0) | New test AT-10 passes |
| AC-21 | Non-array LLM JSON → throws (not returns 0) | New test AT-11 passes |
| AC-22 | LLM API failure → throws (not returns 0) | New test AT-12 passes |
| AC-23 | Read failure → throws | New test AT-13 passes |
| AC-24 | Write failure → throws | New test AT-14 passes |
| AC-25 | Empty LLM array `[]` → returns `{ memoriesStored: 0 }` | New test AT-15 passes |
| AC-26 | All-trivial entries → returns `{ memoriesStored: 0 }` | New test AT-16 passes |

### 20.4 Logging

| ID | Criterion | Pass Condition |
|----|-----------|---------------|
| AC-27 | Extraction trigger logs include: `correlationId`, `candidateId`, `source`, `toolName` (when `source === "tool-answer"`), `decision`, `contentLength` (on extract) | GT-21 passes |
| AC-28 | Skip logs include `decision: "skip-processed"` or `"skip-no-candidate"` | Code review |

### 20.5 Existing Tests Pass

| ID | Criterion | Pass Condition |
|----|-----------|---------------|
| AC-29 | All existing `memory-extraction-guard.test.ts` tests pass after modifications | Test run exits 0 |
| AC-30 | All existing `memory-agent.test.ts` tests pass after modifications | Test run exits 0 |
| AC-31 | All existing tests outside memory extraction pass (no regressions) | `npx vitest run --project unit` exits 0 |

---

## 21. Extensibility & Future-Proofing Considerations

### 21.1 Adding New Candidate Sources

The `collectMemoryCandidates` function is designed to be extensible. New candidate sources (e.g., form submissions, tool answers from other tools, onboarding answers) can be added by appending to the returned array without changing the memory extraction engine. Each source is identified by a `source` string and adds at most one candidate per source type per scan.

### 21.2 Token Budget

If `memories.md` grows large enough to approach the LLM context window limit, a future change could:
- Truncate existing memories to the most recent N facts.
- Summarize older facts.
- Use a tiered approach (recent facts verbatim, older facts summarized).

This is explicitly out of scope for this change.

### 21.3 Retry on Failure

If extraction throws (LLM error, parse error, file I/O error), the error propagates to `sendMessages()`'s catch block. The message ID is NOT added to `processedMemoryMessageIds` (only added on success). On the next `submit-message` trigger, the candidate will be retried. No explicit retry loop within a single `sendMessages` call is implemented.

### 21.4 Prompt Versioning

The updated `memory-agent-prompt.md` should be reviewed periodically as LLM capabilities improve. The extraction quality from structured JSON Q&A content (vs. free-form user messages) may differ and should be evaluated.

---

## 22. Clarifications Asked

| # | Question | Answer |
|---|----------|--------|
| 1 | Should user-message and ask_questions candidates be collected by a single function or separate functions? | Single function: `collectMemoryCandidates`. Returns an array of candidates, one per source type. Allows independent processing of both in the same `sendMessages` call. |
| 2 | Should `isEligibleForMemoryExtraction` be updated? | May remain exported for backward compatibility but is NOT used by the new extraction logic. The new flow uses `collectMemoryCandidates` exclusively. |
| 3 | What happens if the LLM drops existing facts in its merge output? | The code trusts the LLM's output. No programmatic correction. This is an accepted risk (see §9.4). |
| 4 | Should `memoriesStored` count new facts or total facts? | Total facts in the merged output. The caller cannot distinguish "new" from "existing" without re-parsing, and the value is only used for observability. |

---

## 23. User Decisions & Locked Assumptions

These are non-negotiable constraints provided by the user. The implementation MUST follow them.

| # | Decision |
|---|----------|
| 1 | **Candidate collection:** Single `collectMemoryCandidates()` function returns up to one candidate per source type. Extensible by design. |
| 2 | **Answer format:** Structured JSON — `[{"question": "...", "answer": "..."}]` per batch. Treat `answer` as user-authored, `question` as context. |
| 3 | **Trigger:** `submit-message` only (same as existing). NOT `regenerate-message`. |
| 4 | **Deduplication:** LLM merge. `extractAndStoreMemories` receives existing memories.md content + new user content. LLM returns COMPLETE merged list. LLM is responsible for dedup and merge and is authoritative for the result. |
| 5 | **Blocking:** `await extractAndStoreMemories` BEFORE `createGuardedStream`. Extraction is no longer fire-and-forget. If extraction throws, the guarded stream is never started. |
| 6 | **Technical failures are fatal:** `extractAndStoreMemories` THROWS on: no research folder, read failure, LLM call failure, invalid JSON, non-array JSON, write failure. Only returns `{ memoriesStored: 0 }` for empty/trivial LLM output. |
| 7 | **Processed tracking AFTER success:** `processedMemoryMessageIds.add(candidate.id)` only after `extractAndStoreMemories` succeeds (does not throw). Failed extractions are retried on the next `submit-message` trigger. |
| 8 | **Logging:** Minimal `console.debug` with fields: `correlationId`, `candidateId`, `source`, `decision`, `contentLength`. Internal memory-agent logs unchanged. |
| 9 | **Serialized writes:** Intentional. `serializedWrite` queues LLM calls per research folder. Simplicity is preferred over throughput. |

---

## 24. Open Questions

| # | Question | Resolution |
|---|----------|------------|
| 1 | Should `findLastMessageForExtraction` be renamed? | RESOLVED: Replaced entirely by `collectMemoryCandidates`. |
| 2 | Should `isEligibleForMemoryExtraction` be updated? | RESOLVED: May remain exported for backward compatibility but is not used in the new flow. |
| 3 | What should `extractAndStoreMemories` return when the LLM returns an empty array? | RESOLVED: `{ memoriesStored: 0 }` (no facts — not an error). |
| 4 | Should the `memories.md` file be deleted if the LLM returns an empty array after previously having content? | RESOLVED: No. When the LLM returns `[]`, the code does NOT write (returns early). This preserves existing memories. |
| 5 | Should the LLM prompt for ask_questions answers differ from the prompt for raw user messages? | RESOLVED: No. The same system prompt is used. The difference is in the user prompt text (raw message vs. structured JSON). The system prompt should handle both. |
