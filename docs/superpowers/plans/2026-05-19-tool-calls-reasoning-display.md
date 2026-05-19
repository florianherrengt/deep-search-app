# Tool Calls & Reasoning Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display AI reasoning/thinking and tool call invocations in the chat UI using assistant-ui's built-in primitives.

**Architecture:** Replace `MessagePrimitive.Parts` with `MessagePrimitive.GroupedParts` to handle part-type-specific rendering. Reasoning parts group into a collapsible "Thinking" accordion. Tool calls render as inline expandable cards. Install Tailwind CSS v4 + shadcn/ui for the Collapsible primitive.

**Tech Stack:** React 18, TypeScript, Vite 6, Tailwind CSS v4, shadcn/ui, @assistant-ui/react, @assistant-ui/react-markdown, lucide-react

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/index.css` | Create (rename from App.css import) | Tailwind import + custom CSS |
| `src/App.css` | Delete | Replaced by Tailwind |
| `src/App.tsx` | Modify | Update CSS import |
| `src/lib/utils.ts` | Create | `cn()` utility |
| `src/components/ui/collapsible.tsx` | Create | shadcn Collapsible |
| `src/components/ui/button.tsx` | Create | shadcn Button |
| `src/components/assistant-ui/markdown-text.tsx` | Create | Markdown renderer for reasoning |
| `src/components/assistant-ui/reasoning.tsx` | Create | Collapsible reasoning component |
| `src/components/assistant-ui/tool-fallback.tsx` | Create | Inline expandable tool call card |
| `src/components/assistant-ui/thread.tsx` | Modify | GroupedParts rendering |
| `vite.config.ts` | Modify | Add Tailwind plugin + path alias |
| `tsconfig.json` | Modify | Add path alias |
| `package.json` | Modify | New deps |
| `components.json` | Create | shadcn config |

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Tailwind CSS v4 + Vite plugin**

```bash
npm install tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Install runtime deps**

```bash
npm install @assistant-ui/react-markdown remark-gfm lucide-react class-variance-authority clsx tailwind-merge tw-shimmer
```

- [ ] **Step 3: Install dev deps for path alias**

```bash
npm install -D @types/node
```

- [ ] **Step 4: Verify install**

```bash
npm ls tailwindcss @assistant-ui/react-markdown lucide-react class-variance-authority
```

Expected: All listed with versions, no errors.

---

### Task 2: Configure Tailwind CSS v4

**Files:**
- Create: `src/index.css`
- Modify: `vite.config.ts`
- Modify: `src/main.tsx` (update CSS import)
- Delete: `src/App.css` (content migrates to `index.css`)

- [ ] **Step 1: Create `src/index.css` with Tailwind import + existing custom styles**

```css
@import "tailwindcss";

:root {
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;
  color: #0f0f0f;
  background-color: #f6f6f6;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

@media (prefers-color-scheme: dark) {
  :root {
    color: #f6f6f6;
    background-color: #2f2f2f;
  }
}
```

- [ ] **Step 2: Update `src/main.tsx` to import `index.css` instead of `App.css`**

Change the import from:
```tsx
import './App'
```
(If it exists — check first.) Then in `src/App.tsx`, remove the line:
```tsx
import "./App.css";
```

And in `src/main.tsx`, add:
```tsx
import "./index.css";
```

- [ ] **Step 3: Update `vite.config.ts` to add Tailwind plugin and `@` path alias**

```ts
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

- [ ] **Step 4: Update `tsconfig.json` to add path alias**

Add `baseUrl` and `paths` to `compilerOptions`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 5: Delete `src/App.css`**

```bash
rm src/App.css
```

- [ ] **Step 6: Verify dev server starts**

```bash
npm run dev
```

Expected: Vite starts without errors. The app should load (styles may look different since we removed the old CSS — that's fine for now).

---

### Task 3: Create `cn()` utility and initialize shadcn/ui

**Files:**
- Create: `src/lib/utils.ts`
- Create: `components.json`

- [ ] **Step 1: Create `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Create `components.json` at project root**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 3: Verify shadcn CLI works**

```bash
npx shadcn@latest add button --yes
```

Expected: `src/components/ui/button.tsx` is created. If prompted, accept defaults.

---

### Task 4: Add shadcn components

**Files:**
- Create: `src/components/ui/collapsible.tsx`
- Create: `src/components/ui/tooltip.tsx`
- Already created: `src/components/ui/button.tsx` (from Task 3)

- [ ] **Step 1: Add collapsible component**

```bash
npx shadcn@latest add collapsible --yes
```

Expected: `src/components/ui/collapsible.tsx` created.

- [ ] **Step 2: Add tooltip component**

```bash
npx shadcn@latest add tooltip --yes
```

Expected: `src/components/ui/tooltip.tsx` created.

- [ ] **Step 3: Verify build compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors.

---

### Task 5: Create markdown-text component

**Files:**
- Create: `src/components/assistant-ui/markdown-text.tsx`

- [ ] **Step 1: Create `src/components/assistant-ui/markdown-text.tsx`**

```tsx
import "@assistant-ui/react-markdown/styles/dot.css";
import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { type FC, memo, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      components={defaultComponents}
    />
  );
};
export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<{
  language: string;
  code: string;
}> = ({ language, code }) => {
  const [isCopied, setIsCopied] = useState(false);

  const onCopy = () => {
    if (!code || isCopied) return;
    navigator.clipboard.writeText(code).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 3000);
    });
  };

  return (
    <div className="flex items-center justify-between rounded-t-lg bg-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      <span>{language}</span>
      <button
        onClick={onCopy}
        className="flex items-center gap-1 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {isCopied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
};

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1 className={cn("mb-4 mt-6 text-2xl font-bold", className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn("mb-3 mt-5 text-xl font-semibold", className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn("mb-2 mt-4 text-lg font-semibold", className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("mb-3 leading-7", className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn("mb-3 ml-6 list-disc [&>li]:mt-1", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn("mb-3 ml-6 list-decimal [&>li]:mt-1", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote className={cn("border-l-4 border-zinc-300 pl-4 italic", className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <pre className={cn("overflow-x-auto rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800", className)} {...props} />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock && "rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-800",
          className
        )}
        {...props}
      />
    );
  },
  CodeHeader,
});
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

Expected: No errors.

---

### Task 6: Create reasoning component

**Files:**
- Create: `src/components/assistant-ui/reasoning.tsx`

- [ ] **Step 1: Create `src/components/assistant-ui/reasoning.tsx`**

```tsx
import { memo, useCallback, useRef, useState } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import {
  useScrollLock,
  useAuiState,
  type ReasoningMessagePartComponent,
  type ReasoningGroupComponent,
} from "@assistant-ui/react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;

const reasoningVariants = cva("aui-reasoning-root mb-4 w-full", {
  variants: {
    variant: {
      outline: "rounded-lg border px-3 py-2",
      ghost: "",
      muted: "rounded-lg bg-muted/50 px-3 py-2",
    },
  },
  defaultVariants: {
    variant: "outline",
  },
});

export type ReasoningRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "onOpenChange"
> &
  VariantProps<typeof reasoningVariants> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
  };

function ReasoningRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        lockScroll();
      }
      if (!isControlled) {
        setUncontrolledOpen(open);
      }
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  return (
    <Collapsible
      ref={collapsibleRef}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(reasoningVariants({ variant }), className)}
      {...props}
    >
      {children}
    </Collapsible>
  );
}

function ReasoningFade({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-white to-transparent dark:from-zinc-900",
        className,
      )}
      {...props}
    />
  );
}

function ReasoningTrigger({
  active,
  duration,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  active?: boolean;
  duration?: number;
}) {
  const durationText = duration ? ` (${duration}s)` : "";
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200",
        className,
      )}
      {...props}
    >
      <BrainIcon className="h-4 w-4" />
      <ChevronDownIcon className="h-3 w-3 transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
      <span>Thinking{durationText}</span>
      {active ? (
        <span className="aui-reasoning-shimmer ml-1 inline-block h-3 w-3 animate-pulse rounded-full bg-blue-400" />
      ) : null}
    </CollapsibleTrigger>
  );
}

function ReasoningContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      className={cn(
        "overflow-hidden text-sm text-zinc-600 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down dark:text-zinc-300",
        className,
      )}
      {...props}
    >
      <div className="mt-2">{children}</div>
    </CollapsibleContent>
  );
}

function ReasoningText({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("aui-reasoning-text", className)} {...props}>
      <MarkdownText />
    </div>
  );
}

const ReasoningImpl: ReasoningMessagePartComponent = () => <ReasoningText />;

const ReasoningGroupImpl: ReasoningGroupComponent = ({
  children,
  startIndex,
  endIndex,
}) => {
  const isReasoningStreaming = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false;
    const lastIndex = s.message.parts.length - 1;
    if (lastIndex < 0) return false;
    const lastType = s.message.parts[lastIndex]?.type;
    if (lastType !== "reasoning") return false;
    return lastIndex >= startIndex && lastIndex <= endIndex;
  });

  return (
    <ReasoningRoot defaultOpen={isReasoningStreaming}>
      <ReasoningTrigger active={isReasoningStreaming} />
      <ReasoningContent>{children}</ReasoningContent>
    </ReasoningRoot>
  );
};

export const ReasoningGroup = memo(ReasoningGroupImpl);
ReasoningGroup.displayName = "ReasoningGroup";

export {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
  ReasoningFade,
  reasoningVariants,
};
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

Expected: No errors.

---

### Task 7: Create tool-fallback component

**Files:**
- Create: `src/components/assistant-ui/tool-fallback.tsx`

- [ ] **Step 1: Create `src/components/assistant-ui/tool-fallback.tsx`**

```tsx
import { useState } from "react";
import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ToolFallback({
  toolName,
  args,
  result,
  status,
}: {
  toolName: string;
  args?: string;
  result?: string;
  status: "running" | "complete" | "error";
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="my-2 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
          "hover:bg-zinc-100 dark:hover:bg-zinc-800",
        )}
      >
        <WrenchIcon className="h-3.5 w-3.5 text-zinc-400" />
        <span className="font-medium text-zinc-700 dark:text-zinc-200">
          {toolName}
        </span>
        {status === "running" && (
          <span className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
        )}
        {status === "complete" && (
          <span className="ml-auto text-xs text-green-600 dark:text-green-400">done</span>
        )}
        {status === "error" && (
          <span className="ml-auto text-xs text-red-500">error</span>
        )}
        <ChevronDownIcon
          className={cn(
            "h-3.5 w-3.5 text-zinc-400 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
          {args && (
            <div className="mb-2">
              <div className="mb-1 text-xs font-medium text-zinc-500">Input</div>
              <pre className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                {typeof args === "string" ? args : JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}
          {result && (
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-500">Result</div>
              <pre className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

Expected: No errors.

---

### Task 8: Update thread.tsx with GroupedParts rendering

**Files:**
- Modify: `src/components/assistant-ui/thread.tsx`

- [ ] **Step 1: Rewrite `src/components/assistant-ui/thread.tsx`**

```tsx
import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  AuiIf,
  useAuiState,
} from "@assistant-ui/react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
} from "@/components/assistant-ui/reasoning";

const groupBy = (
  part: { type: string },
  _index: number,
  _parts: readonly { type: string }[],
) => {
  if (part.type === "reasoning") return ["group-reasoning"];
  return null;
};

export function Thread() {
  return (
    <ThreadPrimitive.Root className="flex h-full flex-col">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-6 py-4">
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <div className="flex h-[60vh] flex-col items-center justify-center text-center opacity-60">
            <h1 className="mb-1 text-2xl font-bold">Deep Search</h1>
            <p className="text-lg">Ask something...</p>
          </div>
        </AuiIf>
        <ThreadPrimitive.Messages>
          {() => <ThreadMessage />}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>

      <div className="border-t border-zinc-200 px-6 py-3 dark:border-zinc-700">
        <ComposerPrimitive.Root className="flex items-end gap-2">
          <ComposerPrimitive.Input
            placeholder="Ask something..."
            className="flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            rows={1}
            autoFocus
          />
          <AuiIf condition={(s) => !s.thread.isRunning}>
            <ComposerPrimitive.Send className="rounded-xl bg-blue-600 px-4 py-3 text-sm text-white hover:bg-blue-700">
              Send
            </ComposerPrimitive.Send>
          </AuiIf>
          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel className="rounded-xl bg-red-500 px-4 py-3 text-sm text-white hover:bg-red-600">
              Stop
            </ComposerPrimitive.Cancel>
          </AuiIf>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}

function ThreadMessage() {
  const role = useAuiState((s) => s.message.role);
  return (
    <MessagePrimitive.Root
      className={
        role === "user"
          ? "mb-4 flex justify-end"
          : "mb-4 max-w-[80%] space-y-2"
      }
    >
      {role === "user" ? (
        <div className="max-w-[70%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-white">
          <MessagePrimitive.Parts />
        </div>
      ) : (
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-reasoning": {
                const running =
                  "status" in part &&
                  part.status &&
                  typeof part.status === "object" &&
                  "type" in part.status &&
                  (part.status as { type: string }).type === "running";
                return (
                  <ReasoningRoot defaultOpen={!!running}>
                    <ReasoningTrigger active={!!running} />
                    <ReasoningContent>{children}</ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "reasoning":
                return <ReasoningText />;
              case "text":
                return (
                  <div className="whitespace-pre-wrap leading-7">
                    <MarkdownText />
                  </div>
                );
              case "tool-call": {
                const toolPart = part as {
                  toolName: string;
                  args?: unknown;
                  result?: unknown;
                  status?: { type: string };
                };
                return (
                  <ToolFallback
                    toolName={toolPart.toolName}
                    args={toolPart.args ? JSON.stringify(toolPart.args, null, 2) : undefined}
                    result={toolPart.result ? JSON.stringify(toolPart.result, null, 2) : undefined}
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
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
      )}
    </MessagePrimitive.Root>
  );
}
```

- [ ] **Step 2: Update `src/App.tsx` to remove the old CSS import**

In `src/App.tsx`, remove the line `import "./App.css";` (should already be gone from Task 2, but verify).

- [ ] **Step 3: Verify build**

```bash
npm run dev
```

Expected: App starts, chat UI renders with Tailwind styles, composer works.

---

### Task 9: Update App.tsx styles

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update `src/App.tsx` — remove the CSS import and add minimal layout styles via Tailwind classes**

The `Chat` component's wrapping div should use Tailwind classes. Update the return in `Chat`:

```tsx
return (
  <AssistantRuntimeProvider runtime={runtime}>
    <div className="h-screen">
      <Thread />
    </div>
  </AssistantRuntimeProvider>
);
```

And the API key form should also use Tailwind. Update the `if (!apiKey)` block:

```tsx
if (!apiKey) {
  return (
    <main className="flex flex-col items-center justify-center pt-[10vh] text-center">
      <h1 className="text-2xl font-bold">Deep Search</h1>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          saveKey();
        }}
      >
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.currentTarget.value)}
          placeholder="OpenRouter API Key"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={!keyInput}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save Key
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Verify full build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

---

### Task 10: Verify end-to-end

- [ ] **Step 1: Start dev server and test in browser**

```bash
npm run dev
```

Manually verify:
1. API key entry screen renders with Tailwind styles
2. Chat interface loads
3. Send a message — assistant responds
4. Tool calls (if model triggers `askQuestions`) appear as expandable cards
5. If using a reasoning model, "Thinking" accordion appears collapsed by default

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add tool call and reasoning display with Tailwind + shadcn/ui"
```
