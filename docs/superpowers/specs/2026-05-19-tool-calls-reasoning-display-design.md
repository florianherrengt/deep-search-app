# Tool Calls & Reasoning Display

## Goal

Display AI reasoning/thinking and tool call invocations in the chat UI using assistant-ui's built-in primitives. Tool calls render as inline expandable cards; reasoning renders in a collapsible accordion.

## Current State

- `thread.tsx` (59 lines) uses `MessagePrimitive.Parts` for all content rendering -- no custom part rendering
- No tool call UI exists; `askQuestions` tool runs but shows nothing
- No reasoning/thinking display
- Plain CSS only (no Tailwind, no shadcn/ui)
- `@assistant-ui/react` v0.14.5, `@assistant-ui/react-ai-sdk` v1.3.26

## Infrastructure Changes

1. Install Tailwind CSS v4 + PostCSS + autoprefixer
2. Initialize shadcn/ui (needed for Collapsible, Tooltip primitives)
3. Install `@assistant-ui/react-markdown` + `remark-gfm` (for markdown in reasoning text)
4. Install `lucide-react` (icons)
5. Install `class-variance-authority` + `clsx` + `tailwind-merge` (shadcn deps)
6. Add shadcn components: `collapsible`, `tooltip`, `button`
7. Create `src/lib/utils.ts` with `cn()` helper

## New Files

### `src/components/assistant-ui/reasoning.tsx`
Collapsible reasoning component per assistant-ui docs. Contains:
- `ReasoningRoot` -- Collapsible container with scroll lock
- `ReasoningTrigger` -- "Thinking (Ns)" with brain icon + chevron + shimmer during streaming
- `ReasoningContent` -- Animated collapsible body
- `ReasoningText` -- Wraps `<MarkdownText>` for each reasoning part

### `src/components/assistant-ui/tool-fallback.tsx`
Inline expandable card for tool calls. Contains:
- Card wrapper with border and muted background
- Header: wrench icon + tool name + status badge (spinner for running, checkmark for complete)
- Collapsible detail: JSON-formatted args while running, args + result when complete

### `src/components/assistant-ui/markdown-text.tsx`
Markdown renderer using `@assistant-ui/react-markdown` with `remark-gfm`. Styled via assistant-ui's dot.css.

### `src/lib/utils.ts`
Standard `cn()` utility (clsx + tailwind-merge).

## Modified Files

### `src/components/assistant-ui/thread.tsx`
Replace `MessagePrimitive.Parts` with `MessagePrimitive.GroupedParts`:
- `groupBy` function groups consecutive `reasoning` parts into `"group-reasoning"`
- Render function handles each part type:
  - `group-reasoning`: collapsible reasoning shell (Root + Trigger + Content + children)
  - `reasoning`: individual `ReasoningText` inside the group
  - `text`: plain text rendering
  - `tool-call`: `ToolFallback` component
  - Default: null

### `src/App.css`
Remove existing `aui-msg`, `aui-welcome`, `aui-composer` styles as Tailwind takes over. Keep layout-level styles that Tailwind doesn't replace (dark mode color vars, base typography).

## Visual Behavior

### Reasoning
- Collapsed by default when complete, auto-expanded during streaming
- Trigger shows "Thinking (3s)" with brain icon and animated shimmer
- Content renders reasoning text as markdown
- Outline variant: rounded border, subtle background

### Tool Calls
- Inline card within the message flow
- Wrench icon + tool name in header row
- Status badge: spinning loader while running, green checkmark when complete
- Click to expand/collapse JSON detail
- `askQuestions` shows the questions array; other tools show generic args/result

## Dependencies

New production deps: `@assistant-ui/react-markdown`, `remark-gfm`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-shimmer`

New dev deps: `tailwindcss`, `@tailwindcss/vite`, `postcss`, `autoprefixer`

## Out of Scope

- Custom per-tool UI components (just fallback for now)
- Branching UI
- Message actions (copy, retry)
- Thread list / model selection
