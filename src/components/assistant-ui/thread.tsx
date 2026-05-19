import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  AuiIf,
  useAuiState,
  type PartState,
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
  part: PartState,
  _index: number,
  _parts: readonly PartState[],
) => {
  if (part.type === "reasoning") return ["group-reasoning"] as const;
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
        <div className="max-w-[70%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-white">
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
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
      )}
    </MessagePrimitive.Root>
  );
}
