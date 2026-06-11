# Subagent Visibility — Implementation Plan

## Build Order

Dependencies flow top-down. Each step builds on the previous.

### Step 1: Data types & event protocol

**Files:** `src/lib/sub-agent-types.ts` (new)

Define `SubAgentRun`, `SubAgentToolCall`, `SubAgentEvent` types. Pure types, no dependencies.

---

### Step 2: Persistence layer

**Files:** `src/lib/sub-agent-persistence.ts` (new)

Add `readSubAgentRuns(folderName, chatId)` and `writeSubAgentRuns(folderName, chatId, runs)` using existing `readAppFile`/`writeAppFile` patterns from `research-history.ts`. File path: `search-results/<folder>/chats/<chatId>.subagents.json`.

---

### Step 3: React store (SubAgentProvider)

**Files:** `src/lib/sub-agent-store.tsx` (new)

Create `SubAgentContext` with `runsByChat`, `selectedRunId`, and actions (`processEvent`, `loadRuns`, `selectRun`, `clearRuns`, `persistRuns`). Use React context + `useState`. The `processEvent` function handles all `SubAgentEvent` variants, updating the run in `runsByChat[chatId]`.

Export `SubAgentProvider` component and `useSubAgentStore()` hook.

---

### Step 4: Extend sub-agent-stream.ts

**Files:** `src/lib/sub-agent-stream.ts` (modify)

- Import `SubAgentEvent` from the new types file
- Add `emitSubAgentEvent` and `registerSubAgent` to `SubAgentStreamContext`
- Update `collectSubAgentTextStream` to call `emitSubAgentEvent({ type: "text-delta", ... })` alongside existing `writer.write()`
- Add a helper `createSubAgentContext(writer, onEvent)` that returns the full context object

---

### Step 5: Event emission in guarded-stream.ts

**Files:** `src/lib/transport/guarded-stream.ts` (modify)

- Create a `writeSubAgentEvent` helper (same pattern as `writeGuardrailEvent`, `writeAgentDiagnosticEvent`)
- In `createGuardedStream`, create the `SubAgentStreamContext` with an `onEvent` callback that calls `writeSubAgentEvent(controller, event)`
- Pass this context to `createTools` via a new `subAgentContext` parameter
- Pass the context to `nameFolderFromMessage` calls in `DirectTransport.sendMessages()` via the `experimental_context` mechanism (or as an explicit parameter)

---

### Step 6: Tool wrapping (withSubAgentTracking)

**Files:** `src/lib/transport/tool-registry.ts` (modify), `src/tools/*.ts` (modify per tool)

Create `withSubAgentTracking(displayName, toolFn)` that wraps a tool's `execute`:

1. Calls `registerSubAgent(name, toolName)` from context → emits `start` event
2. Runs original `execute`
3. Emits `complete` or `error` event

For simple tools (brave_search, file tools, etc.), the wrapper just captures input/output as a single `SubAgentToolCall`. For LLM-calling tools (extract_page_content, research_checkpoint, etc.), it also forwards text deltas.

Apply wrapping in `tool-registry.ts` when assembling the tool set.

---

### Step 7: Wire folder naming, retrieval-agent, memory-agent

**Files:** `src/lib/transport/folder-namer.ts`, `src/lib/retrieval-agent.ts`, `src/lib/memory-agent.ts` (modify)

These call `generateText()` outside of tool execution. They need to:

1. Accept the `SubAgentStreamContext` (or just `emitSubAgentEvent` + `registerSubAgent`) as a parameter
2. Call `registerSubAgent` at the start
3. Forward text via `emitSubAgentEvent({ type: "text-delta" })` if streaming
4. Call `emitSubAgentEvent({ type: "complete" })` at the end

The calls in `DirectTransport.sendMessages()` (folder naming, memory extraction) pass the context from step 5.

---

### Step 8: Chat component wiring

**Files:** `src/components/chat.tsx` (modify)

- Import `useSubAgentStore`
- In `useChat`'s `onFinish` callback, also call `persistRuns(chatId, folderName)`
- Add a `useEffect` that scans incoming message parts for `data` parts with `name === "subagent_event"` and calls `processEvent`
- On mount, call `loadRuns(chatId, [])` (or load from disk if `researchFolder` exists)

---

### Step 9: Inline subagent cards

**Files:** `src/components/sub-agent-card.tsx` (new), `src/components/assistant-ui/thread.tsx` (modify)

`SubAgentCard` component:
- Reads from `useSubAgentStore` by the `subAgentId` from the tool-call part's `providerMetadata`
- Shows icon, name, status (spinner/done/error), "inspect" hint on hover
- On click, calls `selectRun(runId)` to open the right sidebar

In `thread.tsx`:
- Filter `subagent_event` data parts (`return null` in the `case "data"` handler)
- In `case "tool-call"`, check for `providerMetadata.subAgentId`. If present, render `SubAgentCard` instead of `ToolFallback`

---

### Step 10: Right sidebar

**Files:** `src/components/sub-agent-sidebar.tsx` (new)

Three sections:
1. **Header**: "Subagents" + close button
2. **Run list**: Maps `runsByChat[chatId]` to clickable items with status dots
3. **Detail panel**: Shows selected run's text output and tool calls

Uses Mantine components (`Box`, `Text`, `UnstyledButton`, `ScrollArea`) matching existing codebase style.

---

### Step 11: Layout integration

**Files:** `src/App.tsx` (modify), `src/components/tab-panel.tsx` (modify)

In `App.tsx`:
- Wrap the tree in `SubAgentProvider`
- Pass `SubAgentSidebar` down to the chat panel area

In `tab-panel.tsx` or the chat panel wrapper:
- Render `SubAgentSidebar` as a sibling to the `Chat` component in a flex row
- Sidebar is conditionally visible based on `selectedRunId !== null`
- Chat panel shrinks via `flex: 1` when sidebar opens

---

## Testing Notes

- Unit tests for `processEvent` reducer logic (all event types)
- Unit tests for persistence (read/write round-trip)
- Manual testing: start a chat, verify cards appear inline, verify sidebar opens, verify text streams, verify old chat loads persisted runs
- Verify that `guardrail_event` and `agent_diagnostic` still render correctly (regression)
- Verify that existing `ToolFallback` still renders for tools without subagent tracking
