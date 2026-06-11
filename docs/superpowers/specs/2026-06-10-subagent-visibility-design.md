# Subagent Visibility

Display all LLM and tool work as trackable subagent runs in the chat UI, with a collapsible right sidebar for detailed inspection of streaming text and tool calls.

## Problem

When the AI calls tools (brave_search, extract_page_content) or runs internal LLM operations (folder naming, retrieval-agent, memory extraction), the user sees either nothing or a raw JSON dump. There is no way to observe what is happening in real time, what each operation produced, or review past operations after the fact.

## Approach

In-band data events in the existing Vercel AI SDK stream. Subagent operations emit `data` parts (same mechanism as `guardrail_event` and `agent_diagnostic` today). A React context store receives these events, tracks runs per chat, and feeds both the inline chat cards and the right sidebar.

## Data Model

### SubAgentRun

```typescript
interface SubAgentRun {
  id: string;                    // e.g. "sa-1718012345678-0"
  name: string;                  // Human-readable: "Brave Search", "Folder Naming"
  toolName: string;              // Raw tool name: "brave_search", "name_folder"
  status: "running" | "complete" | "error";
  startedAt: string;             // ISO 8601
  finishedAt: string | null;
  text: string;                  // Accumulated streamed text (capped at 10KB)
  toolCalls: SubAgentToolCall[];
  error: string | null;
  parentMessageId: string;       // Assistant message this belongs to
}

interface SubAgentToolCall {
  toolName: string;
  args: unknown;
  result?: unknown;
  status: "running" | "complete" | "error";
}
```

### Stream Events

Emitted as data parts with `name: "subagent_event"`:

```typescript
type SubAgentEvent =
  | { type: "start"; id: string; name: string; toolName: string; parentMessageId: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "tool-call"; id: string; toolCall: SubAgentToolCall }
  | { type: "tool-result"; id: string; toolCallIndex: number; result: unknown }
  | { type: "complete"; id: string }
  | { type: "error"; id: string; error: string };
```

### Disk Storage

Per chat, alongside the existing transcript:

```
search-results/<folder>/
  chats/
    <chatId>.json              # Existing chat transcript
    <chatId>.subagents.json    # Array of SubAgentRun[]
```

Loaded on chat open via `readAppFile()`, written on chat finish via `writeAppFile()`. Same patterns as `research-history.ts`.

## Stream Integration

### Modified Context

Every tool receives an extended context via `experimental_context`:

```typescript
interface SubAgentContext {
  subAgentStream: {
    writer: UIMessageStreamWriter<UIMessage>;
  };
  emitSubAgentEvent: (event: SubAgentEvent) => void;
  registerSubAgent: (name: string, toolName: string) => string;
}
```

### Tool Wrapping

A higher-order function `withSubAgentTracking(toolName, displayName, execute)` wraps each tool's `execute`:

1. Calls `registerSubAgent()` which emits a `start` event
2. Runs the original execute function
3. Forwards text/tool-call progress as `text-delta`/`tool-call` events
4. Emits `complete` on success, `error` on failure

### What Gets Tracked

All tools and internal LLM calls:

| Operation | Trigger | Has streaming text |
|-----------|---------|--------------------|
| Folder naming | `nameFolderFromMessage()` | Yes (LLM output) |
| Retrieval agent | `identifyRelevantFolders()` | Yes (LLM output) |
| Memory extraction | `extractAndStoreMemories()` | Yes (LLM output) |
| Research plan | `create_research_plan` tool | Yes (LLM output) |
| Facts check | `facts_check` tool | Yes (LLM output) |
| Research checkpoint | `research_checkpoint` tool | Yes (LLM output) |
| Search tools | `brave_search`, `exa_search`, etc. | No (just args/result) |
| Content extraction | `extract_page_content` tool | Partial (summary text) |
| File tools | `create_file`, `read_file`, etc. | No (just args/result) |
| Sequential thinking | `sequential_thinking` tool | No (just args/result) |

### Event Emission Point

In `guarded-stream.ts`, events are written to the `ReadableStream` controller as data parts:

```typescript
controller.enqueue({
  type: "data",
  name: "subagent_event",
  data: event,
});
```

### Existing Sub-Agent Stream

The current `collectSubAgentTextStream()` in `sub-agent-stream.ts` is updated to also call `emitSubAgentEvent({ type: "text-delta", ... })` alongside its existing `writer.write()` calls. This makes folder naming, retrieval-agent, and memory extraction automatically appear as subagent runs without changing their call sites.

## React State

### SubAgentProvider

```typescript
interface SubAgentStoreState {
  runsByChat: Record<string, SubAgentRun[]>;
  selectedRunId: string | null;
}

interface SubAgentStoreActions {
  loadRuns(chatId: string, runs: SubAgentRun[]): void;
  processEvent(event: SubAgentEvent): void;
  clearRuns(chatId: string): void;
  selectRun(runId: string | null): void;
  persistRuns(chatId: string, folderName: string): Promise<void>;
}
```

### Component Tree Position

```
AppInner
  SettingsProvider
    PromptTemplatesProvider
      SkillsProvider
        SubAgentProvider          <-- new
          TabPanel
            ResearchSidebar (left)
            Chat
            SubAgentSidebar       <-- new, right sidebar
```

### Event Flow to Store

The `Chat` component uses `useChat` from the Vercel AI SDK, which receives data parts as message parts. A `useEffect` in `Chat` watches for new data parts with `name === "subagent_event"` and calls `processEvent()` on the store.

### Lifecycle

1. **Chat starts** -> `Chat` mounts -> `loadRuns(chatId, [])` (or loads from disk if resuming)
2. **Streaming** -> each `subagent_event` data part -> `processEvent()` -> store updates -> React re-renders sidebar
3. **Chat finishes** -> `persistRuns(chatId, folderName)` writes to `<chatId>.subagents.json`
4. **User reopens old chat** -> `loadRuns(chatId, runsFromDisk)` hydrates from file

### Session Awareness

Runs are keyed by `chatId`. Multiple concurrent chat sessions don't interfere. The right sidebar shows runs for the currently active chat only.

## UI

### Linking Tool-Call Parts to SubAgentRuns

When `withSubAgentTracking` wraps a tool, it emits a `start` event with the subagent ID. The tool's execute function sets `providerMetadata.subAgentId` on the tool-call part through the Vercel AI SDK's context. In `thread.tsx`, the renderer reads this metadata from the tool-call part and looks up the corresponding `SubAgentRun` from the store. If a match is found, `SubAgentCard` renders; otherwise, `ToolFallback` renders as before.

### Inline Chat Cards

In `thread.tsx`, each tool-call part that has a matching subagent run renders as a compact card:

- Icon (wrench or tool-specific)
- Human-readable name
- Status: spinner (running), green "done" badge, or red "error" badge
- "inspect" hint on hover
- Clicking opens the right sidebar and selects this run

Subagent data parts (`name === "subagent_event"`) return `null` in the message renderer. They are invisible in the chat.

### Right Sidebar

A 380px sidebar that slides in from the right when a subagent card is clicked:

**Header**: "Subagents" title + close button

**Run list**: All runs for the current chat, each showing:
- Colored status dot (blue pulsing = running, green = done, red = error)
- Human-readable name
- Duration (e.g. "0.3s", "now" for running)
- Click to select

**Detail panel** for the selected run:
- "Output" section: streaming/accumulated text
- "Tool Calls" section: cards per tool call with JSON args and results
- Content renders with monospace formatting, same style as existing `ToolFallback`

The sidebar uses `position: relative` within the flex layout, not an overlay. The chat panel shrinks to accommodate it. Closing the sidebar restores the chat to full width.

### Layout in TabPanel

The right sidebar sits inside the `main` tab's chat panel area:

```
ResearchSidebar | Chat + SubAgentSidebar
```

The `Chat` component and `SubAgentSidebar` are siblings in a flex row. When the sidebar is closed it has `width: 0` with a transition.

## Error Handling & Edge Cases

### Aborted Runs

If the user hits "Stop" mid-stream, running subagents emit an `error` event with `"Aborted"`. Partial text and tool calls are preserved in the store and sidebar.

### Multiple Concurrent Subagents

Tools like `extract_page_content` and `memory-agent` can run concurrently. Each gets its own `SubAgentRun` entry. The sidebar run list shows all active runs; the detail panel shows whichever is selected.

### Crash/Restart Recovery

Subagent data is persisted on chat finish. On reload, runs that were mid-stream (have `startedAt` but no `finishedAt`) are marked `error`.

### No Research Folder Yet

Before the first message creates a folder, subagent events flow through the stream but are not persisted. The in-memory store holds them. Once the folder is created, persistence activates.

### Large Outputs

The `text` field in `SubAgentRun` is capped at 10KB. Full results remain in the tool call `args`/`result` on the main message. The sidebar shows the capped preview.

### Data Part Filtering

In `thread.tsx`, the existing `case "data"` handler gains:

```typescript
if (dataPart.name === "subagent_event") return null;
```

Subagent events are invisible in message rendering. Only the subagent cards (which read from the store) appear inline.

## Files to Create or Modify

### New Files

- `src/lib/sub-agent-store.tsx` - SubAgentProvider context, store state, actions
- `src/components/sub-agent-sidebar.tsx` - Right sidebar component
- `src/components/sub-agent-card.tsx` - Inline chat card component

### Modified Files

- `src/lib/sub-agent-stream.ts` - Add `emitSubAgentEvent` integration, extend context type
- `src/lib/transport/guarded-stream.ts` - Create and pass `SubAgentContext`, emit events to controller
- `src/lib/transport/tool-registry.ts` - Wrap tools with `withSubAgentTracking()`
- `src/lib/research-history.ts` - Add `readSubAgentRuns()` / `writeSubAgentRuns()` functions
- `src/components/assistant-ui/thread.tsx` - Filter subagent data parts, render `SubAgentCard` for tool-call parts with `subAgentId` metadata (fall back to `ToolFallback` for untracked tools)
- `src/components/chat.tsx` - Wire up `processEvent()` from data parts, call `loadRuns`/`persistRuns`
- `src/App.tsx` - Add `SubAgentProvider` to component tree
- `src/components/tab-panel.tsx` - Accept and render `SubAgentSidebar` alongside chat panel
