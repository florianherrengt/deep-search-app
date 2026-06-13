import {
  streamText,
  convertToModelMessages,
  type FinishReason,
  type LanguageModel,
  type ModelMessage,
  type ToolChoice,
  type UIMessage,
  type UIMessageChunk,
  isToolUIPart,
} from "ai";
import { SafePathSegmentSchema } from "@/lib/app-file-storage";
import {
  type AgentDiagnosticEvent,
} from "@/lib/agent-diagnostics";
import {
  evaluateAssistantStep,
  type GuardName,
  type GuardrailEvent,
  type GuardDecision,
} from "@/lib/agent-guards";
import { getActiveToolNamesForMessages } from "@/lib/tool-call-requirements";
import systemPrompt from "../system-prompt.md?raw";
import { createTools, type AppToolSet, type SearchToolKeys } from "./tool-registry";
import type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";
import { isSubAgentOutputTextPart } from "@/lib/sub-agent-stream";
import { skillsStore } from "@/lib/skills-store";

const MAX_GUARD_RETRIES = 2;

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
  embeddingConfig,
  rerankerConfig,
  messages,
  abortSignal,
  onResearchFolderChange,
  searchKeys,
  controller,
}: {
  model: LanguageModel;
  researchFolder: string | null;
  embeddingConfig: EmbeddingConfig;
  rerankerConfig: RerankerConfig;
  messages: UIMessage[];
  abortSignal: AbortSignal | undefined;
  onResearchFolderChange?: (folderName: string) => void | Promise<void>;
  searchKeys?: SearchToolKeys;
  controller: ReadableStreamDefaultController<UIMessageChunk>;
}): Promise<void> {
  return (async () => {
    let activeResearchFolder = researchFolder;
      const retries: Record<GuardName, number> = {
        question_tool: 0,
        research_checkpoint: 0,
        tool_call_requirement: 0,
        currency_conversion: 0,
      };
      let currentUiMessages = messages;
      let toolChoice: ToolChoice<AppToolSet> | undefined;
      let sendStart = true;
      let lastFinish: AttemptFinish | undefined;

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
          embeddingConfig,
          rerankerConfig,
          searchKeys,
        });

        const skillsData = await skillsStore.get();
        const effectiveSystemPrompt = buildSystemPrompt(skillsData.skills);

        let currentModelMessages = await convertToModelMessages(
          currentUiMessages,
          { tools },
        );

        while (!abortSignal?.aborted) {
          lastFinish = await runAttempt({
            model,
            tools,
            messages: currentModelMessages,
            activeTools: getActiveToolNamesForMessages(
              tools,
              currentUiMessages,
            ),
            toolChoice,
            originalMessages: currentUiMessages,
            sendStart,
            abortSignal,
            controller,
            systemPrompt: effectiveSystemPrompt,
          });

          if (lastFinish.usage) {
            writeTokenUsageEvent(controller, lastFinish.usage);
          }

          const decision = evaluateAssistantStep<AppToolSet>({
            messages: currentUiMessages,
            responseMessage: lastFinish.responseMessage,
            targetCurrency: searchKeys?.currency,
          });

          if (decision.action === "accept") {
            const diagnostic = getNoReplyDiagnostic(lastFinish);
            if (diagnostic) {
              writeAgentDiagnosticEvent(controller, diagnostic);
            }
            break;
          }

          const guardRetryCount = retries[decision.guard];
          if (guardRetryCount >= MAX_GUARD_RETRIES) {
            writeGuardrailEvent(controller, maxRetryWarning(decision));
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
      } catch (error) {
        if (abortSignal?.aborted) {
          return;
        }
        throw error;
      }
    })();
}

async function runAttempt({
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
}: {
  model: LanguageModel;
  tools: AppToolSet;
  messages: ModelMessage[];
  activeTools: Array<keyof AppToolSet>;
  toolChoice: ToolChoice<AppToolSet> | undefined;
  originalMessages: UIMessage[];
  sendStart: boolean;
  abortSignal: AbortSignal | undefined;
  controller: ReadableStreamDefaultController<UIMessageChunk>;
  systemPrompt: string;
}): Promise<AttemptFinish> {
  let finish: AttemptFinish | undefined;
  const result = streamText({
    model,
    system: effectiveSystemPrompt,
    messages,
    tools,
    activeTools,
    toolChoice,
    abortSignal,
  });
  const stream = result.toUIMessageStream<UIMessage>({
    originalMessages,
    sendStart,
    sendFinish: false,
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
  tools: AppToolSet;
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
  // The `signal` option is passed to pipeTo, which handles abort listening
  // and reader cleanup automatically. We use the `preventClose: true` option
  // because the outer stream's lifecycle is managed by the parent ReadableStream.
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

function getNoReplyDiagnostic(finish: AttemptFinish): AgentDiagnosticEvent | null {
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
  decision: Extract<GuardDecision<AppToolSet>, { action: "retry" }>,
): GuardrailEvent {
  return {
    kind: decision.guard,
    status: "warning",
    title: "Guardrail retry limit reached",
    message: "The agent kept missing this guardrail, so the latest output is shown.",
    reason: decision.event.reason,
    attempt: MAX_GUARD_RETRIES,
  };
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
