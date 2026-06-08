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
import { formatTokenCount } from "@/lib/context-window";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
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
    <ThreadPrimitive.Root className="md-flex-col" style={{ position: "relative" }}>
      <ThreadPrimitive.Viewport
        scrollToBottomOnRunStart={false}
        style={{ display: "flex", flex: 1, flexDirection: "column", gap: 12, overflowY: "auto", padding: "16px 24px" }}
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <div style={{ display: "flex", height: "60vh", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: "var(--mantine-color-dimmed)" }}>
            <h1 style={{ marginBottom: 4, fontSize: 24, fontWeight: 700 }}>Deep Search</h1>
            <p style={{ fontSize: 18 }}>Ask something...</p>
          </div>
        </AuiIf>
        <ThreadPrimitive.Messages>
          {() => <ThreadMessage />}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>

      <ThreadPrimitive.ViewportFooter style={{ position: "relative", borderTop: "1px solid var(--mantine-color-default-border)", padding: "12px 24px" }}>
        <ThreadPrimitive.ScrollToBottom
          style={{
            position: "absolute",
            top: -44,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "1px solid var(--mantine-color-default-border)",
            background: "var(--mantine-color-body)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            cursor: "pointer",
          }}
        >
          <ArrowDownIcon style={{ width: 16, height: 16 }} />
        </ThreadPrimitive.ScrollToBottom>
        <ComposerPrimitive.Root style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ComposerPrimitive.Input
            placeholder="Ask something..."
            rows={1}
            autoFocus
            style={{
              width: "100%",
              resize: "none",
              borderRadius: 12,
              border: "1px solid var(--mantine-color-default-border)",
              background: "var(--mantine-color-body)",
              padding: "12px 16px",
              fontSize: 14,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", minWidth: 0, alignItems: "center", gap: 8 }}>
              <ModelSelector
                models={models}
                value={selectedModelId}
                onValueChange={onSelectedModelIdChange}
                size="sm"
                variant="ghost"
              />
              <ContextWindowBadge model={selectedModel} tokenCount={tokenCount} />
            </div>
            <div style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 8 }}>
              <AuiIf condition={(s) => !s.thread.isRunning}>
                <PromptTemplateButton />
              </AuiIf>
              <AuiIf condition={(s) => !s.thread.isRunning}>
                <ComposerPrimitive.Send aria-label="Send message" style={{ borderRadius: 12, backgroundColor: "var(--mantine-color-blue-filled)", padding: "8px 16px", fontSize: 14, color: "var(--mantine-color-white)", border: "none", cursor: "pointer" }}>
                  Send
                </ComposerPrimitive.Send>
              </AuiIf>
              <AuiIf condition={(s) => s.thread.isRunning}>
                <ComposerPrimitive.Cancel aria-label="Stop generation" style={{ borderRadius: 12, backgroundColor: "var(--mantine-color-red-filled)", padding: "8px 16px", fontSize: 14, color: "var(--mantine-color-white)", border: "none", cursor: "pointer" }}>
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
      style={{
        display: "none",
        flexShrink: 0,
        borderRadius: 6,
        border: "1px solid var(--mantine-color-default-border)",
        padding: "4px 8px",
        fontSize: 12,
        color: "var(--mantine-color-dimmed)",
      }}
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
      hideWhenRunning
      style={{ display: "flex", alignItems: "center", gap: 4, opacity: 0, transition: "opacity 0.15s" }}
    >
      <ActionBarPrimitive.Copy
        copiedDuration={2000}
        aria-label="Copy message"
        className="md-icon-btn"
      >
        <AuiIf condition={({ message }) => message.isCopied}>
          <CheckIcon style={{ width: 14, height: 14, color: "var(--mantine-color-green-6)" }} />
        </AuiIf>
        <AuiIf condition={({ message }) => !message.isCopied}>
          <CopyIcon style={{ width: 14, height: 14 }} />
        </AuiIf>
      </ActionBarPrimitive.Copy>
      {role === "assistant" && (
        <ActionBarPrimitive.Reload aria-label="Regenerate response" className="md-icon-btn">
          <RefreshCwIcon style={{ width: 14, height: 14 }} />
        </ActionBarPrimitive.Reload>
      )}
    </ActionBarPrimitive.Root>
  );
}

function ThreadMessage() {
  const role = useAuiState((s) => s.message.role);
  return (
    <MessagePrimitive.Root
      style={
        role === "user"
          ? { marginBottom: 16, display: "flex", justifyContent: "flex-end" }
          : { marginBottom: 16, maxWidth: "80%" }
      }
    >
      {role === "user" ? (
        <div style={{ maxWidth: "70%", whiteSpace: "pre-wrap", borderRadius: 16, borderBottomRightRadius: 4, backgroundColor: "var(--mantine-color-blue-filled)", padding: "8px 16px", color: "var(--mantine-color-white)" }}>
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
                    <div style={{ overflowX: "auto" }}>
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
            <ErrorPrimitive.Root className="md-card-sm" style={{ border: "1px solid var(--mantine-color-red-3)", backgroundColor: "var(--mantine-color-red-0)", color: "var(--mantine-color-red-text)" }}>
              <ErrorPrimitive.Message />
            </ErrorPrimitive.Root>
          </MessagePrimitive.Error>
        </>
      )}
    </MessagePrimitive.Root>
  );
}
