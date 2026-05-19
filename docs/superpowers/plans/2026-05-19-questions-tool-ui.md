# Questions Tool UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a custom interactive UI when the model uses the `askQuestions` tool, allowing users to select/type answers and submit them back as the tool result.

**Architecture:** Create a `QuestionsToolUI` component using `makeAssistantToolUI` from `@assistant-ui/react`. Register it as a child of the `AssistantRuntimeProvider`. The component renders inline in the assistant message via `part.toolUI` in the existing `GroupedParts` switch. Answers flow back via `addResult`.

**Tech Stack:** React, TypeScript, Tailwind CSS, `@assistant-ui/react`, `@ai-sdk/react`

---

### Task 1: Create the QuestionsToolUI component

**Files:**
- Create: `src/components/assistant-ui/questions-tool.tsx`

This component receives tool call args via `makeAssistantToolUI`'s render prop. It renders an interactive form for pending state and a compact read-only view for completed state.

- [ ] **Step 1: Create the QuestionsToolUI component file**

```tsx
import { useState } from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { CheckCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type QuestionArgs = {
  questions: {
    question: string;
    candidates: { label: string; value: string }[];
  }[];
};

type QuestionResult = {
  answers: {
    question: string;
    answer: string;
    custom?: boolean;
  }[];
};

export const QuestionsToolUI = makeAssistantToolUI<QuestionArgs, QuestionResult>({
  toolName: "askQuestions",
  render: ({ args, addResult, result }) => {
    if (result) return <CompletedView result={result} />;
    if (!args?.questions) return null;
    return <PendingView questions={args.questions} onSubmit={addResult} />;
  },
});

function PendingView({
  questions,
  onSubmit,
}: {
  questions: QuestionArgs["questions"];
  onSubmit: (result: QuestionResult) => void;
}) {
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});

  function select(index: number, value: string) {
    setSelections((prev) => ({ ...prev, [index]: value }));
    setCustomAnswers((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function setCustom(index: number, text: string) {
    setCustomAnswers((prev) => ({ ...prev, [index]: text }));
    if (text) {
      setSelections((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  }

  function handleSubmit() {
    const answers: QuestionResult["answers"] = [];
    questions.forEach((q, i) => {
      const custom = customAnswers[i]?.trim();
      const selected = selections[i];
      if (custom) {
        answers.push({ question: q.question, answer: custom, custom: true });
      } else if (selected) {
        answers.push({ question: q.question, answer: selected });
      }
    });
    onSubmit({ answers });
  }

  const hasAny = Object.keys(selections).length > 0 || Object.keys(customAnswers).length > 0;

  return (
    <div className="my-2 space-y-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
      {questions.map((q, qi) => (
        <div key={qi} className="space-y-2">
          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {q.question}
          </div>
          <div className="flex flex-wrap gap-2">
            {q.candidates.map((c) => (
              <button
                key={c.value}
                onClick={() => select(qi, c.value)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  selections[qi] === c.value
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-300"
                    : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Or type your own..."
            value={customAnswers[qi] ?? ""}
            onChange={(e) => setCustom(qi, e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
        </div>
      ))}
      <button
        onClick={handleSubmit}
        disabled={!hasAny}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600"
      >
        Submit Answers
      </button>
    </div>
  );
}

function CompletedView({ result }: { result: QuestionResult }) {
  return (
    <div className="my-2 space-y-1 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400">
        <CheckCircleIcon className="h-4 w-4" />
        Answers submitted
      </div>
      {result.answers.map((a, i) => (
        <div key={i} className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium">{a.question}</span>
          <span className="mx-1">→</span>
          <span className={a.custom ? "italic" : ""}>{a.answer}</span>
          {a.custom && (
            <span className="ml-1 text-xs text-zinc-400">(custom)</span>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/assistant-ui/questions-tool.tsx
git commit -m "feat: add QuestionsToolUI component"
```

---

### Task 2: Wire up QuestionsToolUI in the app

**Files:**
- Modify: `src/App.tsx` — render `QuestionsToolUI` inside `AssistantRuntimeProvider`
- Modify: `src/components/assistant-ui/thread.tsx` — use `part.toolUI` in the tool-call case

The `makeAssistantToolUI` component must be rendered as a child of `AssistantRuntimeProvider` so the runtime can discover it. Then in the `GroupedParts` switch, we render `part.toolUI` for tool calls instead of always falling through to `ToolFallback`.

- [ ] **Step 1: Add QuestionsToolUI to the provider in App.tsx**

In `src/App.tsx`, import `QuestionsToolUI` and render it inside `AssistantRuntimeProvider`:

Change the `Chat` component's return to:

```tsx
return (
  <AssistantRuntimeProvider runtime={runtime}>
    <QuestionsToolUI />
    <div className="h-screen">
      <Thread />
    </div>
  </AssistantRuntimeProvider>
);
```

Add the import at the top:

```tsx
import { QuestionsToolUI } from "./components/assistant-ui/questions-tool";
```

- [ ] **Step 2: Update tool-call rendering in thread.tsx**

In `src/components/assistant-ui/thread.tsx`, modify the `tool-call` case in the `GroupedParts` children function. Currently it creates `toolPart` and passes it to `<ToolFallback>`. Change it to prefer `part.toolUI` when available:

Replace the `tool-call` case in the switch with:

```tsx
case "tool-call": {
  if (part.toolUI) return part.toolUI;
  const toolPart = part as {
    toolName: string;
    args?: unknown;
    result?: unknown;
    status?: { type: string };
  };
  return (
    <ToolFallback
      toolName={toolPart.toolName}
      args={
        toolPart.args
          ? JSON.stringify(toolPart.args, null, 2)
          : undefined
      }
      result={
        toolPart.result
          ? JSON.stringify(toolPart.result, null, 2)
          : undefined
      }
      status={
        toolPart.status?.type === "running"
          ? "running"
          : toolPart.result !== undefined
            ? "complete"
            : "running"
      }
    />
  );
}
```

The key change: `if (part.toolUI) return part.toolUI;` at the top of the case. The existing `ToolFallback` code stays as the fallback for any tool without a registered UI.

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/assistant-ui/thread.tsx
git commit -m "feat: wire up QuestionsToolUI in app and thread"
```

---

### Task 3: Manual verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test the feature**

Send a message that triggers the `askQuestions` tool. Verify:
1. Questions render inline with selectable candidate buttons
2. Clicking a candidate highlights it (blue)
3. Typing in the custom input clears any candidate selection
4. Submit button is disabled until at least one answer is provided
5. After submission, a green "Answers submitted" card shows the answers
6. The main chat input at the bottom stays visible and usable throughout
7. User can ignore the questions and type a regular message

- [ ] **Step 3: Commit any fixes if needed**
