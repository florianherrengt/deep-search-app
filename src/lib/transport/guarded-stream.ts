import {
  convertToModelMessages,
  isToolUIPart,
  streamText,
  type FinishReason,
  type LanguageModel,
  type ModelMessage,
  type ToolChoice,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import { SafePathSegmentSchema } from "@/lib/app-file-storage";
import { isSubAgentOutputTextPart } from "@/lib/sub-agent-stream";
import {
  evaluateAssistantStep,
  type GuardDecision,
  type GuardrailEvent,
} from "@/lib/agent-guards";
import { getActiveToolNamesForMessages } from "@/lib/tool-call-requirements";
import { createTools, type SearchToolKeys } from "./tool-registry";
import { skillsStore } from "@/lib/skills-store";
import systemPrompt from "../system-prompt.md?raw";

const MAX_GUARD_RETRIES = 2;

const DEFAULT_MAX_RETRIES_PER_GUARD: Record<string, number> = {
  question_tool: MAX_GUARD_RETRIES,
  research_checkpoint: MAX_GUARD_RETRIES,
  tool_call_requirement: MAX_GUARD_RETRIES,
};

type AttemptFinish = {
  messages: UIMessage[];
  responseMessage: UIMessage;
  finishReason?: FinishReason;
  usage?: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
  };
};

export function createGuardedStream({
  model,
  researchFolder,
  messages,
  abortSignal,
  onResearchFolderChange,
  searchKeys,
  controller,
}: {
  model: LanguageModel;
  researchFolder: string | null;
  messages: UIMessage[];
  abortSignal: AbortSignal | undefined;
  onResearchFolderChange?: (folderName: string) => void | Promise<void>;
  searchKeys?: SearchToolKeys;
  controller: ReadableStreamDefaultController<UIMessageChunk>;
}): Promise<void> {
  return (async () => {
    let activeResearchFolder = researchFolder;

    try {
      const tools = await createTools({
        model,
        getResearchFolder: async () => {
          if (activeResearchFolder) return activeResearchFolder;
          throw new Error("Research folder is not initialized.");
        },
        switchResearchFolder: async (folderName) => {
          activeResearchFolder = SafePathSegmentSchema.parse(folderName);
          await onResearchFolderChange?.(activeResearchFolder);
        },
        searchKeys,
      });

      const skillsData = await skillsStore.get();
      const effectiveSystemPrompt = buildSystemPrompt(skillsData.skills);

      const getProviderOptions = ({
        model: streamModel,
        toolChoice,
      }: {
        model: unknown;
        toolChoice?: unknown;
      }): SharedV3ProviderOptions | undefined => {
        if (!toolChoice || toolChoice === "auto") return undefined;

        const info = streamModel as {
          provider?: string;
          modelId?: string;
        };
        const isDeepSeek =
          (typeof info.provider === "string" &&
            info.provider.startsWith("deepseek")) ||
          (typeof info.modelId === "string" &&
            info.modelId.toLowerCase().includes("deepseek"));

        if (isDeepSeek) {
          return { deepseek: { thinking: { type: "disabled" } } };
        }
        return undefined;
      };

      await runGuardedLoop({
        model,
        messages,
        abortSignal,
        tools,
        systemPrompt: effectiveSystemPrompt,
        getProviderOptions,
        evaluateStep: ({ messages: stepMessages, responseMessage }) =>
          evaluateAssistantStep({
            messages: stepMessages,
            responseMessage,
            targetCurrency: searchKeys?.currency,
          }),
        maxGuardRetries: {
          currency_conversion: 1,
        },
        onError: (error: unknown) =>
          error instanceof Error ? error.message : String(error),
        controller,
      });
    } catch (error) {
      if (abortSignal?.aborted) {
        return;
      }
      throw error;
    }
  })();
}

function buildSystemPrompt(
  skills?: { slug: string; whenToUse: string }[],
): string {
  let prompt = systemPrompt;

  if (skills && skills.length > 0) {
    const skillList = skills
      .map((s) => `- ${s.slug}: ${s.whenToUse}`)
      .join("\n");
    prompt += `\n\n## Available skills\n\nLoad a skill with the \`load_skill\` tool when the user's request matches its description.\n\n${skillList}`;
  }

  return prompt;
}

async function runGuardedLoop({
  model,
  messages,
  abortSignal,
  tools,
  systemPrompt: effectiveSystemPrompt,
  evaluateStep,
  maxGuardRetries,
  getProviderOptions,
  onError,
  controller,
}: {
  model: LanguageModel;
  messages: UIMessage[];
  abortSignal?: AbortSignal;
  tools: ToolSet;
  systemPrompt: string;
  evaluateStep: (params: {
    messages: UIMessage[];
    responseMessage: UIMessage;
  }) => GuardDecision<ToolSet>;
  maxGuardRetries?: Record<string, number>;
  getProviderOptions?: (params: {
    model: unknown;
    toolChoice?: unknown;
  }) => SharedV3ProviderOptions | undefined;
  onError?: (error: unknown) => string;
  controller: ReadableStreamDefaultController<UIMessageChunk>;
}) {
  const effectiveMaxRetries = {
    ...DEFAULT_MAX_RETRIES_PER_GUARD,
    ...maxGuardRetries,
  };
  const retries: Record<string, number> = {};
  let currentUiMessages = messages;
  let toolChoice: ToolChoice<ToolSet> | undefined;
  let sendStart = true;
  let lastFinish: AttemptFinish | undefined;

  let currentModelMessages = await convertToModelMessages(currentUiMessages, {
    tools,
  });

  while (!abortSignal?.aborted) {
    lastFinish = await runAttempt({
      model,
      tools,
      messages: currentModelMessages,
      activeTools: getActiveToolNamesForMessages(tools, currentUiMessages),
      toolChoice,
      originalMessages: currentUiMessages,
      sendStart,
      abortSignal,
      controller,
      systemPrompt: effectiveSystemPrompt,
      getProviderOptions,
      onError,
    });

    if (lastFinish.usage) {
      writeTokenUsageEvent(controller, lastFinish.usage);
    }

    const decision = evaluateStep({
      messages: currentUiMessages,
      responseMessage: lastFinish.responseMessage,
    });

    if (decision.action === "accept") {
      const diagnostic = getNoReplyDiagnostic(lastFinish);
      if (diagnostic) {
        writeAgentDiagnosticEvent(controller, diagnostic);
      }
      break;
    }

    const guardRetryCount = retries[decision.guard] ?? 0;
    const guardMaxRetries =
      effectiveMaxRetries[decision.guard] ?? MAX_GUARD_RETRIES;
    if (guardRetryCount >= guardMaxRetries) {
      writeGuardrailEvent(
        controller,
        maxRetryWarning(decision, guardMaxRetries),
      );
      break;
    }

    retries[decision.guard] = guardRetryCount + 1;
    writeGuardrailEvent(controller, {
      ...decision.event,
      attempt: retries[decision.guard],
    });

    currentUiMessages = lastFinish.messages;
    currentModelMessages = await buildRetryMessages({
      messages: currentUiMessages,
      tools,
      instruction: decision.retryInstruction,
    });
    toolChoice = decision.toolChoice;
    sendStart = false;
  }
}

type RunAttemptParams = {
  model: LanguageModel;
  tools: ToolSet;
  messages: ModelMessage[];
  activeTools: string[];
  toolChoice: ToolChoice<ToolSet> | undefined;
  originalMessages: UIMessage[];
  sendStart: boolean;
  abortSignal: AbortSignal | undefined;
  controller: ReadableStreamDefaultController<UIMessageChunk>;
  systemPrompt: string;
  getProviderOptions?: (params: {
    model: unknown;
    toolChoice?: unknown;
  }) => SharedV3ProviderOptions | undefined;
  onError?: (error: unknown) => string;
};

async function runAttempt(params: RunAttemptParams): Promise<AttemptFinish> {
  try {
    return await runAttemptOnce(params);
  } catch (error) {
    if (
      params.toolChoice &&
      !params.abortSignal?.aborted &&
      isForcedToolChoiceUnsupported(error)
    ) {
      return await runAttemptOnce({ ...params, toolChoice: undefined });
    }
    throw error;
  }
}

function isForcedToolChoiceUnsupported(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    (message.includes("tool_choice") || message.includes("tool choice")) &&
    (message.includes("thinking") || message.includes("reasoning"))
  );
}

async function runAttemptOnce({
  model,
  tools,
  messages,
  activeTools,
  toolChoice,
  originalMessages,
  sendStart,
  abortSignal,
  controller,
  systemPrompt: effectiveSystemPrompt,
  getProviderOptions,
  onError,
}: RunAttemptParams): Promise<AttemptFinish> {
  let finish: AttemptFinish | undefined;
  const result = streamText({
    model,
    system: effectiveSystemPrompt,
    messages,
    tools,
    activeTools: activeTools.length > 0 ? activeTools : undefined,
    toolChoice,
    abortSignal,
    providerOptions: getProviderOptions
      ? getProviderOptions({ model, toolChoice })
      : undefined,
  });
  const stream = result.toUIMessageStream<UIMessage>({
    originalMessages,
    sendStart,
    sendFinish: false,
    onError,
    onFinish: (event) => {
      finish = {
        messages: event.messages,
        responseMessage: event.responseMessage,
        finishReason: event.finishReason,
      };
    },
  });

  await pipeUIMessageStream(stream, controller, abortSignal);

  let finishReason: FinishReason | undefined;
  let totalUsage: Awaited<typeof result.totalUsage> | undefined;

  try {
    finishReason = await result.finishReason;
    totalUsage = await result.totalUsage;
  } catch (err) {
    if (!abortSignal?.aborted) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Model attempt finished without a response message: ${message}`);
    }
  }

  if (!finish) {
    throw new Error("Model attempt finished without a response message.");
  }

  finish.finishReason = finish.finishReason ?? finishReason;
  if (totalUsage) {
    finish.usage = {
      inputTokens: totalUsage.inputTokens ?? undefined,
      outputTokens: totalUsage.outputTokens ?? undefined,
      totalTokens: totalUsage.totalTokens ?? undefined,
    };
  }

  return finish;
}

async function buildRetryMessages({
  messages,
  tools,
  instruction,
}: {
  messages: UIMessage[];
  tools: ToolSet;
  instruction: string;
}): Promise<ModelMessage[]> {
  return [
    ...(await convertToModelMessages(messages, { tools })),
    {
      role: "user",
      content: `Internal guardrail retry. ${instruction}`,
    },
  ];
}

async function pipeUIMessageStream(
  stream: ReadableStream<UIMessageChunk>,
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  abortSignal: AbortSignal | undefined,
) {
  await stream.pipeTo(
    new WritableStream<UIMessageChunk>({
      write(chunk) {
        controller.enqueue(chunk);
      },
    }),
    { signal: abortSignal, preventClose: true },
  );
}

function writeGuardrailEvent(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  event: GuardrailEvent,
) {
  controller.enqueue({
    type: "data-guardrail_event",
    id: `guardrail-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    data: event,
  });
}

interface AgentDiagnosticEvent {
  kind: string;
  status: string;
  title: string;
  message: string;
  reason: string;
  finishReason?: string;
  toolCallCount?: number;
}

function writeAgentDiagnosticEvent(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  event: AgentDiagnosticEvent,
) {
  controller.enqueue({
    type: "data-agent_diagnostic",
    id: `agent-diagnostic-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    data: event,
  });
}

function writeTokenUsageEvent(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  usage: NonNullable<AttemptFinish["usage"]>,
) {
  controller.enqueue({
    type: "data-token_usage",
    id: `token-usage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    data: usage,
  });
}

function getNoReplyDiagnostic(
  finish: AttemptFinish,
): AgentDiagnosticEvent | null {
  const summary = summarizeAssistantOutput(finish.responseMessage);
  if (summary.hasVisibleReply) return null;
  if (finish.finishReason === "tool-calls") {
    return null;
  }

  return {
    kind: "empty_response",
    status: "warning",
    title: "No assistant reply",
    message: getNoReplyMessage(finish.finishReason, summary),
    reason: getNoReplyReason(finish.finishReason, summary),
    ...(finish.finishReason ? { finishReason: finish.finishReason } : {}),
    ...(summary.toolCallCount > 0
      ? { toolCallCount: summary.toolCallCount }
      : {}),
  };
}

function summarizeAssistantOutput(message: UIMessage) {
  let hasVisibleReply = false;
  let hasReasoning = false;
  let hasSubAgentText = false;
  let toolCallCount = 0;

  for (const part of message.parts) {
    if (part.type === "text") {
      if (!part.text.trim()) continue;
      if (isSubAgentOutputTextPart(part)) {
        hasSubAgentText = true;
      } else {
        hasVisibleReply = true;
      }
      continue;
    }

    if (part.type === "reasoning" && part.text.trim()) {
      hasReasoning = true;
      continue;
    }

    if (
      part.type === "source-url" ||
      part.type === "source-document" ||
      part.type === "file"
    ) {
      hasVisibleReply = true;
      continue;
    }

    if (isToolUIPart(part)) {
      toolCallCount += 1;
    }
  }

  return {
    hasVisibleReply,
    hasReasoning,
    hasSubAgentText,
    toolCallCount,
  };
}

function getNoReplyMessage(
  finishReason: FinishReason | undefined,
  summary: ReturnType<typeof summarizeAssistantOutput>,
) {
  if (finishReason === "length") {
    return "The provider stopped at the output limit before returning visible answer text.";
  }

  if (finishReason === "content-filter") {
    return "The provider reported a content-filter stop before returning visible answer text.";
  }

  if (summary.toolCallCount > 0) {
    return "The model finished after tool work but did not return final answer text.";
  }

  if (summary.hasSubAgentText) {
    return "Only internal verification or tool-progress text was produced; no final answer text was returned.";
  }

  if (summary.hasReasoning) {
    return "The model produced reasoning but no visible answer text.";
  }

  return "The provider ended the turn without returning visible answer text.";
}

function getNoReplyReason(
  finishReason: FinishReason | undefined,
  summary: ReturnType<typeof summarizeAssistantOutput>,
) {
  const reason = finishReason ?? "unknown";

  if (summary.toolCallCount > 0) {
    return `Finish reason: ${reason}. Tool calls in the final step: ${summary.toolCallCount}.`;
  }

  return `Finish reason: ${reason}.`;
}

function maxRetryWarning(
  decision: Extract<GuardDecision<ToolSet>, { action: "retry" }>,
  maxRetries: number,
): GuardrailEvent {
  return {
    kind: decision.guard,
    status: "warning",
    title: "Guardrail retry limit reached",
    message: "The agent kept missing this guardrail, so the latest output is shown.",
    reason: decision.event.reason,
    attempt: maxRetries,
  };
}
