import {
  streamText,
  convertToModelMessages,
  isToolUIPart,
  type ChatTransport,
  type FinishReason,
  type LanguageModel,
  type ModelMessage,
  type ToolChoice,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { questionsTool } from "@/tools/questions-tool";
import {
  braveSearchTool,
  setBraveApiKey,
} from "@/tools/brave-search-tool";
import { createDisambiguateTool } from "@/tools/disambiguate-tool";
import {
  exaSearchTool,
  setExaApiKey,
} from "@/tools/exa-search-tool";
import {
  serperSearchTool,
  setSerperApiKey,
} from "@/tools/serper-search-tool";
import {
  tavilySearchTool,
  setTavilyApiKey,
} from "@/tools/tavily-search-tool";
import {
  searxngSearchTool,
  setSearXNGBaseUrl,
} from "@/tools/searxng-search-tool";
import { createExtractPageContentTool } from "@/tools/extract-page-content-tool";
import { saveResearchFileTool } from "@/tools/research-file-tool";
import { createResearchCheckpointTool } from "@/tools/research-checkpoint-tool";
import {
  evaluateAssistantStep,
  type GuardName,
  type GuardrailEvent,
  type GuardDecision,
} from "@/lib/agent-guards";
import systemPrompt from "./system-prompt.md?raw";

export { setBraveApiKey, setExaApiKey, setSerperApiKey, setTavilyApiKey, setSearXNGBaseUrl };

const MAX_GUARD_RETRIES = 2;

export class DirectTransport implements ChatTransport<UIMessage> {
  constructor(
    private getApiKey: () => string,
    private getModel: () => string,
  ) {}

  async sendMessages({
    messages,
    abortSignal,
  }: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
    headers?: Record<string, string> | Headers;
    body?: object;
    metadata?: unknown;
  }) {
    const openrouter = createOpenRouter({ apiKey: this.getApiKey() });
    const model = openrouter(this.getModel());
    return createGuardedStream({
      model,
      messages,
      abortSignal,
    });
  }

  reconnectToStream(): Promise<ReadableStream | null> {
    return Promise.resolve(null);
  }
}

function createTools(model: LanguageModel) {
  return {
    ask_questions: questionsTool,
    brave_search: braveSearchTool,
    disambiguate: createDisambiguateTool(model),
    exa_search: exaSearchTool,
    serper_search: serperSearchTool,
    tavily_search: tavilySearchTool,
    searxng_search: searxngSearchTool,
    extract_page_content: createExtractPageContentTool(model),
    save_research_file: saveResearchFileTool,
    research_checkpoint: createResearchCheckpointTool(model),
  } as const satisfies ToolSet;
}

type AppToolSet = ReturnType<typeof createTools>;

type AttemptFinish = {
  messages: UIMessage[];
  responseMessage: UIMessage;
  finishReason?: FinishReason;
};

export function createGuardedStream({
  model,
  messages,
  abortSignal,
}: {
  model: LanguageModel;
  messages: UIMessage[];
  abortSignal: AbortSignal | undefined;
}): ReadableStream<UIMessageChunk> {
  const tools = createTools(model);

  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
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

export function shouldContinueAfterToolResult({
  messages,
}: {
  messages: UIMessage[];
}) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;

  let lastToolPartIndex = -1;
  for (let index = last.parts.length - 1; index >= 0; index -= 1) {
    if (isToolUIPart(last.parts[index])) {
      lastToolPartIndex = index;
      break;
    }
  }
  if (lastToolPartIndex === -1) return false;

  const partsAfterTool = last.parts.slice(lastToolPartIndex + 1);
  const hasTextAfterTool = partsAfterTool.some(
    (part) => part.type === "text" && part.text.length > 0,
  );
  if (hasTextAfterTool) return false;

  const toolParts = last.parts.filter(isToolUIPart);
  return toolParts.every(
    (part) =>
      part.state === "output-available" || part.state === "output-error",
  );
}
