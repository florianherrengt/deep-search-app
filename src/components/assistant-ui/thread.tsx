import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ActionBarPrimitive,
  ErrorPrimitive,
  AuiIf,
  MessagePartPrimitive,
  useAui,
  useAuiState,
  type PartState,
} from "@assistant-ui/react";
import {
  useCallback, useEffect, useRef, useState, type ReactNode,
} from "react";
import { CopyIcon, CheckIcon, RefreshCwIcon, ArrowDownIcon } from "lucide-react";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  ModelSelector,
  type ModelOption,
} from "@/components/assistant-ui/model-selector";
import {
  canRenderQuestionsTool,
  QuestionsToolView,
  type QuestionResult,
} from "@/components/assistant-ui/questions-tool";
import { ContextWindowBadge } from "@/components/assistant-ui/context-window-badge";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { GuardrailCard } from "@/components/assistant-ui/guardrail-card";
import { AgentDiagnosticCard } from "@/components/assistant-ui/agent-diagnostic-card";
import {
  AutoCollapsingReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
} from "@/components/assistant-ui/reasoning";
import { PromptTemplateButton } from "@/components/assistant-ui/prompt-template-button";
import { Text, Title } from "@mantine/core";
import { SearchIcon } from "lucide-react";
import classes from "./thread.module.css";

const groupBy = (part: PartState) => {
  if (part.type === "reasoning") return ["group-reasoning"] as const;
  return null;
};

type EnrichedToolCallPart = Extract<PartState, { type: "tool-call" }> & {
  toolUI?: ReactNode;
  addResult?: (result: QuestionResult) => void;
};

interface ThreadProps {
  models: ModelOption[];
  selectedModelId: string;
  onSelectedModelIdChange: (modelId: string) => void;
  onConfigure?: () => void;
  hasEnabledModel?: boolean;
  tokenCount: number;
  chatId?: string;
  previousSearches: string[];
}

const COMPOSER_DRAFT_STORAGE_KEY = "deep-search:composer-draft";

function readComposerDraft(): string {
  if (typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(COMPOSER_DRAFT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeComposerDraft(value: string): void {
  if (typeof window === "undefined") return;

  try {
    if (value.length === 0) {
      window.localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(COMPOSER_DRAFT_STORAGE_KEY, value);
    }
  } catch {
    // localStorage can be unavailable in privacy modes; draft persistence is best-effort.
  }
}

export function Thread({
  models,
  selectedModelId,
  onSelectedModelIdChange,
  onConfigure,
  hasEnabledModel = true,
  tokenCount,
  chatId,
  previousSearches,
}: ThreadProps) {
  const selectedModel = models.find((model) => model.id === selectedModelId);

  return (
    <ThreadPrimitive.Root className={`md-flex-col ${classes.root}`}>
      <ThreadPrimitive.Viewport
        scrollToBottomOnRunStart={false}
        className={classes.viewport}
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <div className={classes.emptyState}>
            <SearchIcon className={classes.emptyIcon} size={24} strokeWidth={1.6} aria-hidden="true" />
            <Title order={1} size="h2">What do you want to understand?</Title>
            {hasEnabledModel ? (
              <Text c="dimmed" size="sm" mt="xs" maw="var(--app-copy-max-width)">
                Ask a focused question. Deep Search will investigate it and keep the evidence visible.
              </Text>
            ) : (
              <Text c="dimmed" size="sm" mt="xs">
                Add a model provider below to start researching.
              </Text>
            )}
          </div>
        </AuiIf>
        <div className={classes.messages}>
          <ThreadPrimitive.Messages>
            {() => <ThreadMessage chatId={chatId} />}
          </ThreadPrimitive.Messages>
        </div>
      </ThreadPrimitive.Viewport>

      <ThreadPrimitive.ViewportFooter className={classes.footer}>
        <div className={classes.composerFrame}>
          <ThreadPrimitive.ScrollToBottom
            aria-label="Scroll to the latest message"
            className={classes.scrollToBottom}
          >
            <ArrowDownIcon size={16} />
          </ThreadPrimitive.ScrollToBottom>
          <ComposerPrimitive.Root
            data-testid="chat-composer"
            className={classes.composer}
          >
            <ComposerInput previousSearches={previousSearches} />
            <div className={classes.composerRow}>
              <div className={classes.composerRowLeft}>
                {hasEnabledModel ? (
                  <ModelSelector
                    models={models}
                    value={selectedModelId}
                    onValueChange={onSelectedModelIdChange}
                    onConfigure={onConfigure}
                    size="sm"
                    variant="ghost"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={onConfigure}
                    className={classes.addProviderButton}
                  >
                    Add provider
                  </button>
                )}
                <ContextWindowBadge model={selectedModel} tokenCount={tokenCount} />
              </div>
              <div className={classes.composerRowRight}>
                <AuiIf condition={(s) => !s.thread.isRunning}>
                  <PromptTemplateButton />
                </AuiIf>
                <AuiIf condition={(s) => !s.thread.isRunning}>
                  <ComposerPrimitive.Send
                    disabled={!hasEnabledModel}
                    aria-label="Send message"
                    data-testid="chat-send-button"
                    className={classes.sendButton}
                  >
                    Send
                  </ComposerPrimitive.Send>
                </AuiIf>
                <AuiIf condition={(s) => s.thread.isRunning}>
                  <ComposerPrimitive.Cancel
                    aria-label="Stop generation"
                    className={classes.cancelButton}
                  >
                    Stop
                  </ComposerPrimitive.Cancel>
                </AuiIf>
              </div>
            </div>
          </ComposerPrimitive.Root>
        </div>
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Root>
  );
}

function ComposerInput({ previousSearches }: { previousSearches: string[] }) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const rafScheduledRef = useRef(false);
  const [hasVerticalOverflow, setHasVerticalOverflow] = useState(false);
  const aui = useAui();
  const composerText = useAuiState((s) => s.composer.text);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const programmaticRef = useRef(false);
  const didRestoreDraftRef = useRef(false);

  const refreshOverflow = useCallback(() => {
    if (typeof window === "undefined") return;
    if (rafScheduledRef.current) return;
    rafScheduledRef.current = true;
    window.requestAnimationFrame(() => {
      rafScheduledRef.current = false;
      const input = inputRef.current;
      if (!input) return;
      setHasVerticalOverflow(input.scrollHeight > input.clientHeight + 1);
    });
  }, []);

  const handleChange = useCallback(() => {
    if (programmaticRef.current) return;
    if (historyIndex !== -1) setHistoryIndex(-1);
    refreshOverflow();
  }, [historyIndex, refreshOverflow]);

  useEffect(() => {
    if (didRestoreDraftRef.current) return;
    didRestoreDraftRef.current = true;

    if (composerText.length > 0) return;

    const draft = readComposerDraft();
    if (draft.length > 0) {
      programmaticRef.current = true;
      aui.composer().setText(draft);
      setTimeout(() => { programmaticRef.current = false; }, 0);
    }
  }, [aui, composerText]);

  useEffect(() => {
    if (!didRestoreDraftRef.current) return;
    writeComposerDraft(composerText);
  }, [composerText]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const cyclingHistory =
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown");
      if (!cyclingHistory || previousSearches.length === 0) return;
      event.preventDefault();
      let newIndex: number;
      if (historyIndex === -1) {
        newIndex = previousSearches.length - 1;
      } else if (event.key === "ArrowUp") {
        newIndex = historyIndex === 0 ? previousSearches.length - 1 : historyIndex - 1;
      } else {
        newIndex = historyIndex === previousSearches.length - 1 ? 0 : historyIndex + 1;
      }
      setHistoryIndex(newIndex);
      programmaticRef.current = true;
      aui.composer().setText(previousSearches[newIndex]);
      setTimeout(() => { programmaticRef.current = false; }, 0);
    },
    [aui, historyIndex, previousSearches],
  );

  const setInputRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      inputRef.current = node;
      refreshOverflow();
    },
    [refreshOverflow],
  );

  return (
    <ComposerPrimitive.Input
      ref={setInputRef}
      data-testid="chat-composer-input"
      placeholder="Ask something..."
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      title={previousSearches.length > 0 ? "Use Alt+↑ and Alt+↓ to reuse previous searches" : undefined}
      minRows={1}
      maxRows={8}
      autoFocus
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onHeightChange={refreshOverflow}
      className={classes.composerInput}
      style={{ overflowY: hasVerticalOverflow ? "auto" : "hidden" }}
    />
  );
}

function MessageActionBar() {
  const role = useAuiState((s) => s.message.role);
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      className={classes.messageActionBar}
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

function ThreadMessage({ chatId }: { chatId?: string }) {
  const role = useAuiState((s) => s.message.role);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  return (
    <MessagePrimitive.Root
      data-testid={role === "assistant" ? "assistant-message" : undefined}
      className={`${classes.messageRoot} ${role === "user" ? classes.userMessageRoot : classes.assistantMessageRoot}`}
    >
      {role === "user" ? (
        <div className={classes.userMessageBubble}>
          <MessagePrimitive.Parts components={{ Text: UserMessageText }} />
        </div>
      ) : (
        <ErrorBoundary>
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
                    <AutoCollapsingReasoningRoot active={!!running}>
                      {({ open, onToggle }) => (
                        <>
                          <ReasoningTrigger
                            active={!!running}
                            open={open}
                            onClick={onToggle}
                          />
                          <ReasoningContent open={open}>
                            {children}
                          </ReasoningContent>
                        </>
                      )}
                    </AutoCollapsingReasoningRoot>
                  );
                }
                case "reasoning":
                  return <ReasoningText />;
                case "text": {
                  return (
                    <div className={classes.messageContent}>
                      <MarkdownText />
                    </div>
                  );
                }
                case "tool-call": {
                  const toolPart = part as EnrichedToolCallPart & {
                    toolName: string;
                    args?: unknown;
                    result?: unknown;
                    status?: { type: string };
                  };
                  if (
                    toolPart.toolName === "ask_questions" &&
                    canRenderQuestionsTool({
                      args: toolPart.args,
                      result: toolPart.result,
                      canSubmit: typeof toolPart.addResult === "function",
                    })
                  ) {
                    if (toolPart.result === undefined && isRunning) {
                      return null;
                    }
                    return (
                      <QuestionsToolView
                        args={toolPart.args}
                        result={toolPart.result}
                        onSubmit={toolPart.addResult}
                      />
                    );
                  }
                  if (toolPart.toolUI) return toolPart.toolUI;
                  return (
                    <ToolFallback
                      toolName={toolPart.toolName}
                      args={toolPart.args}
                      result={toolPart.result}
                      chatId={chatId}
                      toolCallId={toolPart.toolCallId}
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
                default: {
                  if ((part.type as string).startsWith("data-subagent")) {
                    return null;
                  }
                  return null;
                }
              }
            }}
          </MessagePrimitive.GroupedParts>
          <MessageActionBar />
           <MessagePrimitive.Error>
             <ErrorPrimitive.Root className={`md-card-sm ${classes.messageError}`}>
               <ErrorPrimitive.Message />
             </ErrorPrimitive.Root>
           </MessagePrimitive.Error>
        </ErrorBoundary>
      )}
    </MessagePrimitive.Root>
  );
}

function UserMessageText() {
  return <MessagePartPrimitive.Text smooth={false} />;
}
