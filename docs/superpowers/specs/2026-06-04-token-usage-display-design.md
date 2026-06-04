# Token Usage Display

Show the current conversation's token usage in the existing `ContextWindowBadge`, changing it from a static max (e.g. "Context: 200K") to a live indicator (e.g. "Context: 42K / 200K").

## Data Flow

1. `runAttempt()` in `guarded-stream.ts` reads `result.totalUsage` after `pipeUIMessageStream` completes. `totalUsage` is a `PromiseLike<LanguageModelUsage>` that resolves with cumulative input/output/total tokens across all steps.
2. A `data-token_usage` chunk is enqueued on the controller — same pattern as `data-agent_diagnostic`.
3. `ContextWindowBadge` in `thread.tsx` scans all assistant messages for the latest `token_usage` data part and displays `used / max`.

## Schema

```ts
interface TokenUsageEvent {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
```

## Changes

### `src/lib/transport/guarded-stream.ts`

- After `pipeUIMessageStream` in `runAttempt()`, resolve `result.totalUsage` and return it alongside `AttemptFinish`.
- In the main loop of `createGuardedStream()`, after each `runAttempt()` call, enqueue a `data-token_usage` chunk via the controller.

### `src/components/assistant-ui/thread.tsx`

- `ContextWindowBadge` reads all messages, finds the latest `token_usage` data part from any assistant message, and displays `formatTokenCount(inputTokens) / formatTokenCount(max)`.

### `src/lib/context-window.ts`

- Add `formatTokenUsage(used: number | undefined, max: number | undefined): string` helper.

## Edge Cases

- **Usage unavailable**: some providers return `undefined` token counts — badge falls back to showing only the max.
- **Streaming in progress**: only updated after each attempt completes, so it shows the previous turn's usage while streaming.
- **Provider returning `undefined` tokens**: guard against `undefined` values from `totalUsage`.
