import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ActionBarPrimitive,
  ErrorPrimitive,
  AuiIf,
  useAuiState,
  type PartState,
} from "@assistant-ui/react";
import { CopyIcon, CheckIcon, RefreshCwIcon, ArrowDownIcon } from "lucide-react";
import {
  ModelSelector,
  type ModelOption,
} from "@/components/assistant-ui/model-selector";
import { formatTokenCount } from "@/lib/context-window";import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { GuardrailCard } from "@/components/assistant-ui/guardrail-card";
import { AgentDiagnosticCard } from "@/components/assistant-ui/agent-diagnostic-card";
import {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
} from "@/components/assistant-ui/reasoning";
import { PromptTemplateButton } from "@/components/assistant-ui/prompt-template-button";

const SCROLL_THRESHOLD = 200;

const groupBy = (
  part: PartState,
  _index: number,
  _parts: readonly PartState[],
) => {
  if (part.type === "reasoning") return ["group-reasoning"] as const;
  return null;
};

interface ThreadProps {
  models: ModelOption[];
  selectedModelId: string;
  onSelectedModelIdChange: (modelId: string) => void;
  tokenCount: number;
}

export function Thread({
  models,
  selectedModelId,
  onSelectedModelIdChange,
  tokenCount,
}: ThreadProps) {
  const selectedModel = models.find((model) => model.id === selectedModelId);

  return (
    <ThreadPrimitive.Root className="relative flex h-full flex-col">
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-4" scrollToBottomOnRunStart={false}>
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

      <ThreadPrimitive.ViewportFooter className="relative border-t border-zinc-200 px-6 py-3 dark:border-zinc-700">
        <ThreadPrimitive.ScrollToBottom
          className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full border bg-background p-2 shadow-md hover:bg-accent disabled:invisible"
          style={{ "--aui-scroll-to-bottom-threshold": `${SCROLL_THRESHOLD}px` } as React.CSSProperties}
        >
          <ArrowDownIcon className="h-4 w-4" />
        </ThreadPrimitive.ScrollToBottom>
        <ComposerPrimitive.Root className="space-y-2">
          <ComposerPrimitive.Input
            placeholder="Ask something..."
            className="w-full resize-none rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            rows={1}
            autoFocus
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <ModelSelector
                models={models}
                value={selectedModelId}
                onValueChange={onSelectedModelIdChange}
                size="sm"
                variant="ghost"
                contentClassName="w-[min(24rem,calc(100vw-3rem))]"
              />
              <ContextWindowBadge model={selectedModel} tokenCount={tokenCount} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <AuiIf condition={(s) => !s.thread.isRunning}>
                <PromptTemplateButton />
              </AuiIf>
              <AuiIf condition={(s) => !s.thread.isRunning}>
                <ComposerPrimitive.Send className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                  Send
                </ComposerPrimitive.Send>
              </AuiIf>
              <AuiIf condition={(s) => s.thread.isRunning}>
                <ComposerPrimitive.Cancel className="rounded-xl bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600">
                  Stop
                </ComposerPrimitive.Cancel>
              </AuiIf>
            </div>
          </div>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Root>
  );
}

function ContextWindowBadge({
  model,
  tokenCount,
}: {
  model: ModelOption | undefined;
  tokenCount: number;
}) {
  const contextWindowLabel = formatTokenCount(model?.contextWindowTokens);
  const usedLabel = formatTokenCount(tokenCount);

  const displayText =
    usedLabel && contextWindowLabel
      ? `${usedLabel} / ${contextWindowLabel}`
      : usedLabel
        ? usedLabel
        : contextWindowLabel
          ? contextWindowLabel
          : "unknown";

  return (
    <span
      className="hidden shrink-0 rounded-md border border-zinc-200 px-2 py-1 text-xs text-muted-foreground sm:inline-flex dark:border-zinc-700"
      title={
        contextWindowLabel
          ? `${contextWindowLabel} token context window`
          : "Context window size unavailable"
      }
    >
      Context: {displayText}
    </span>
  );
}

function MessageActionBar() {
  const role = useAuiState((s) => s.message.role);
  return (
    <ActionBarPrimitive.Root
      className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
      hideWhenRunning
    >
      <ActionBarPrimitive.Copy
        className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        copiedDuration={2000}
      >
        <AuiIf condition={({ message }) => message.isCopied}>
          <CheckIcon className="h-3.5 w-3.5 text-green-500" />
        </AuiIf>
        <AuiIf condition={({ message }) => !message.isCopied}>
          <CopyIcon className="h-3.5 w-3.5" />
        </AuiIf>
      </ActionBarPrimitive.Copy>
      {role === "assistant" && (
        <ActionBarPrimitive.Reload className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
          <RefreshCwIcon className="h-3.5 w-3.5" />
        </ActionBarPrimitive.Reload>
      )}
    </ActionBarPrimitive.Root>
  );
}

function ThreadMessage() {
  const role = useAuiState((s) => s.message.role);
  return (
    <MessagePrimitive.Root
      className={
        role === "user"
          ? "group mb-4 flex justify-end"
          : "group mb-4 max-w-[80%] space-y-2"
      }
    >
      {role === "user" ? (
        <div className="max-w-[70%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-white">
          <MessagePrimitive.Parts />
        </div>
      ) : (
        <>
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
                case "text": {
                  return (
                    <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto">
                      <MarkdownText />
                    </div>
                  );
                }
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
                      args={toolPart.args}
                      result={toolPart.result}
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
                case "data": {
                  const dataPart = part as {
                    name?: string;
                    data?: unknown;
                  };
                  if (dataPart.name === "guardrail_event") {
                    return <GuardrailCard event={dataPart.data} />;
                  }
                  if (dataPart.name === "agent_diagnostic") {
                    return <AgentDiagnosticCard event={dataPart.data} />;
                  }
                  return null;
                }
                default:
                  return null;
              }
            }}
          </MessagePrimitive.GroupedParts>
          <MessageActionBar />
          <MessagePrimitive.Error>
            <ErrorPrimitive.Root className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              <ErrorPrimitive.Message />
            </ErrorPrimitive.Root>
          </MessagePrimitive.Error>
        </>
      )}
    </MessagePrimitive.Root>
  );
}
