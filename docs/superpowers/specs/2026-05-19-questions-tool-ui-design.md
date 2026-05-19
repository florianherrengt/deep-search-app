# Questions Tool UI Design

## Summary

When the model uses the `askQuestions` tool, render a custom interactive UI inline in the assistant message. Users can select from candidate answers or type their own, skip questions, or ignore the UI entirely and send a regular message. The main chat input stays visible at all times.

## Context

- The `askQuestions` tool is already defined at `src/tools/questions-tool.ts`
- Tool accepts `{ questions: [{ question: string, candidates: [{ label: string, value: string }] }] }`
- Currently all tool calls render through the generic `ToolFallback` (collapsible JSON)
- Using `@assistant-ui/react` with `makeAssistantToolUI` for custom tool rendering
- Using `@ai-sdk/react` `useChat` with `addToolOutput` for returning results

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Answer delivery | Tool result via `addResult` | Model receives structured answers and continues seamlessly |
| UI placement | Inline in assistant message | Natural flow, matches existing message structure |
| Submission model | Select + Submit button | Batch all answers in one tool result |
| Skipping | Omit unanswered questions | Unanswered questions excluded from result |
| Main input | Always visible | User can ignore questions and send regular messages |

## Component: `QuestionsToolUI`

Registered via `makeAssistantToolUI({ toolName: "askQuestions", render: ... })`.

### States

1. **Pending** (no result yet): Interactive form with questions, candidates, custom text inputs, and a Submit button
2. **Completed** (result present): Read-only compact view showing selected answers

### Interactive UI Layout

```
┌─────────────────────────────────────────┐
│ Q1: "Which approach do you prefer?"      │
│ ┌──────────┐ ┌──────────┐               │
│ │ ○ Option A │ │ ● Option B │ (selected) │
│ └──────────┘ └──────────┘               │
│ Or type your own: [__________________]  │
├─────────────────────────────────────────┤
│ Q2: "What's the priority?"              │
│ ┌──────────┐ ┌──────────┐               │
│ │ ○ High     │ │ ○ Low      │           │
│ └──────────┘ └──────────┘               │
│ Or type your own: [__________________]  │
├─────────────────────────────────────────┤
│            [ Submit Answers ]            │
└─────────────────────────────────────────┘
```

### Completed UI Layout

```
┌─────────────────────────────────────────┐
│ Q1: Which approach do you prefer?        │
│ → Option B                               │
│ Q2: What's the priority?                │
│ → (skipped)                              │
└─────────────────────────────────────────┘
```

### Data Flow

1. Tool call arrives with `args.questions`
2. Component renders interactive UI for each question
3. User selects candidates and/or types custom answers
4. User clicks Submit
5. Component calls `addResult({ answers: [{ question: string, answer: string, custom?: boolean }] })`
6. Model receives tool result and continues generating

### Answer Schema

```typescript
type QuestionAnswer = {
  question: string;    // Original question text
  answer: string;      // Selected candidate value or custom text
  custom?: boolean;    // True if user typed a custom answer
};

type QuestionsResult = {
  answers: QuestionAnswer[];
};
```

Unanswered questions are excluded from the `answers` array.

## Files

| File | Action | Description |
|------|--------|-------------|
| `src/components/assistant-ui/questions-tool.tsx` | New | Custom tool UI component |
| `src/App.tsx` | Modify | Register tool UI with runtime |
| `src/tools/questions-tool.ts` | No change | Keep existing tool definition |

## Key Implementation Details

- Use `makeAssistantToolUI` from `@assistant-ui/react` — provides `args`, `addResult`, `result`, `status`
- Each question renders candidates as selectable chips/buttons (radio-style)
- Each question has an optional text input for custom answers
- Custom text overrides candidate selection if both are present
- Submit button calls `addResult` with the structured answers
- After submission, `result` is truthy, so component renders read-only view
- The main `ComposerPrimitive.Input` at the bottom of `Thread` remains visible always
- No changes needed to the tool definition — `execute` returns its placeholder string and `addResult` overrides it
