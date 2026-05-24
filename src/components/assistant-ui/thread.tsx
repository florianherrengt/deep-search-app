import { useRef, useState, useCallback, useEffect } from "react";
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
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { GuardrailCard } from "@/components/assistant-ui/guardrail-card";
import {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
} from "@/components/assistant-ui/reasoning";

const SCROLL_THRESHOLD = 200;

const groupBy = (
  part: PartState,
  _index: number,
  _parts: readonly PartState[],
) => {
  if (part.type === "reasoning") return ["group-reasoning"] as const;
  return null;
};

function ScrollToBottomThreshold() {
  const [visible, setVisible] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const handleScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setVisible(distanceFromBottom > SCROLL_THRESHOLD);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  return (
    <>
      <div ref={viewportRef} className="sr-only" aria-hidden />
      {visible && (
        <ThreadPrimitive.ScrollToBottom className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full border bg-background p-2 shadow-md hover:bg-accent disabled:invisible">
          <ArrowDownIcon className="h-4 w-4" />
        </ThreadPrimitive.ScrollToBottom>
      )}
    </>
  );
}

interface ThreadProps {
  models: ModelOption[];
  selectedModelId: string;
  onSelectedModelIdChange: (modelId: string) => void;
}

export function Thread({
  models,
  selectedModelId,
  onSelectedModelIdChange,
}: ThreadProps) {
  return (
    <ThreadPrimitive.Root className="relative flex h-full flex-col">
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

      <ThreadPrimitive.ViewportFooter className="relative border-t border-zinc-200 px-6 py-3 dark:border-zinc-700">
        <ScrollToBottomThreshold />
        <ComposerPrimitive.Root className="space-y-2">
          <ComposerPrimitive.Input
            placeholder="Ask something..."
            className="w-full resize-none rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            rows={1}
            autoFocus
          />
          <div className="flex items-center justify-between gap-2">
            <ModelSelector
              models={models}
              value={selectedModelId}
              onValueChange={onSelectedModelIdChange}
              size="sm"
              variant="ghost"
              contentClassName="w-[min(24rem,calc(100vw-3rem))]"
            />
            <div className="flex shrink-0 items-center gap-2">
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
                    <div className="prose prose-sm dark:prose-invert max-w-none">
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
                case "data": {
                  const dataPart = part as {
                    name?: string;
                    data?: unknown;
                  };
                  if (dataPart.name === "guardrail_event") {
                    return <GuardrailCard event={dataPart.data} />;
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
