import {
  streamText,
  convertToModelMessages,
  type FinishReason,
  type LanguageModel,
  type ModelMessage,
  type ToolChoice,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { SafePathSegmentSchema } from "@/lib/app-file-storage";
import {
  evaluateAssistantStep,
  type GuardName,
  type GuardrailEvent,
  type GuardDecision,
} from "@/lib/agent-guards";
import systemPrompt from "../system-prompt.md?raw";
import { generateResearchFolder } from "./research-folder";
import { createTools, type AppToolSet } from "./tool-registry";

const MAX_GUARD_RETRIES = 2;

type AttemptFinish = {
  messages: UIMessage[];
  responseMessage: UIMessage;
  finishReason?: FinishReason;
};

export function createGuardedStream({
  model,
  researchFolder,
  apiKey,
  messages,
  abortSignal,
  onResearchFolderChange,
}: {
  model: LanguageModel;
  researchFolder: string | null;
  apiKey: string;
  messages: UIMessage[];
  abortSignal: AbortSignal | undefined;
  onResearchFolderChange?: (folderName: string) => void;
}): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      let activeResearchFolder = researchFolder;
      let researchFolderPromise: Promise<string> | null = null;
      const retries: Record<GuardName, number> = {
        question_tool: 0,
        research_checkpoint: 0,
      };
      let currentUiMessages = messages;
      let currentModelMessages: ModelMessage[];
      let toolChoice: ToolChoice<AppToolSet> | undefined;
      let sendStart = true;
      let lastFinish: AttemptFinish | undefined;

      try {
        const tools = createTools({
          model,
          getResearchFolder: async () => {
            if (activeResearchFolder) return activeResearchFolder;

            researchFolderPromise ??= generateResearchFolder(
              model,
              messages,
              apiKey,
            ).then((folderName) => {
              if (!activeResearchFolder) {
                activeResearchFolder = folderName;
                onResearchFolderChange?.(activeResearchFolder);
              }

              return activeResearchFolder;
            }).finally(() => {
              researchFolderPromise = null;
            });

            return researchFolderPromise;
          },
          switchResearchFolder: (folderName) => {
            activeResearchFolder = SafePathSegmentSchema.parse(folderName);
            onResearchFolderChange?.(activeResearchFolder);
          },
          apiKey,
        });

        currentModelMessages = await convertToModelMessages(currentUiMessages, {
          tools,
        });

        while (!abortSignal?.aborted) {
          lastFinish = await runAttempt({
            model,
            tools,
            messages: currentModelMessages,
            toolChoice,
            originalMessages: currentUiMessages,
            sendStart,
            abortSignal,
            controller,
          });

          const decision = evaluateAssistantStep<AppToolSet>({
            messages,
            responseMessage: lastFinish.responseMessage,
          });

          if (decision.action === "accept") break;

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

        if (abortSignal?.aborted) {
          controller.enqueue({ type: "abort", reason: "aborted" });
        } else {
          controller.enqueue({
            type: "finish",
            finishReason: lastFinish?.finishReason ?? "stop",
          });
        }
      } catch (error) {
        if (abortSignal?.aborted) {
          controller.enqueue({ type: "abort", reason: "aborted" });
        } else {
          controller.enqueue({
            type: "error",
            errorText:
              error instanceof Error
                ? error.message
                : "Agent guardrail stream failed.",
          });
          controller.enqueue({ type: "finish", finishReason: "error" });
        }
      } finally {
        controller.close();
      }
    },
  });
}

async function runAttempt({
  model,
  tools,
  messages,
  toolChoice,
  originalMessages,
  sendStart,
  abortSignal,
  controller,
}: {
  model: LanguageModel;
  tools: AppToolSet;
  messages: ModelMessage[];
  toolChoice: ToolChoice<AppToolSet> | undefined;
  originalMessages: UIMessage[];
  sendStart: boolean;
  abortSignal: AbortSignal | undefined;
  controller: ReadableStreamDefaultController<UIMessageChunk>;
}): Promise<AttemptFinish> {
  let finish: AttemptFinish | undefined;
  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools,
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

  if (!finish) {
    throw new Error("Model attempt finished without a response message.");
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
  const reader = stream.getReader();
  const cancel = () => {
    void reader.cancel();
  };
  abortSignal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      controller.enqueue(value);
    }
  } finally {
    abortSignal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
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
