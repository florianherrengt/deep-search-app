import {
  streamText,
  generateObject,
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
import { zodSchema } from "ai";
import { z } from "zod";
import { questionsTool } from "@/tools/questions-tool";
import {
  braveSearchTool,
  setBraveApiKey,
  getBraveApiKey,
} from "@/tools/brave-search-tool";
import { disambiguateTool } from "@/tools/disambiguate-tool";
import {
  exaSearchTool,
  setExaApiKey,
  getExaApiKey,
} from "@/tools/exa-search-tool";
import {
  serperSearchTool,
  setSerperApiKey,
  getSerperApiKey,
} from "@/tools/serper-search-tool";
import {
  tavilySearchTool,
  setTavilyApiKey,
  getTavilyApiKey,
} from "@/tools/tavily-search-tool";
import {
  searxngSearchTool,
  setSearXNGBaseUrl,
  getSearXNGBaseUrl,
} from "@/tools/searxng-search-tool";
import { createExtractPageContentTool } from "@/tools/extract-page-content-tool";
import { createSaveResearchFileTool } from "@/tools/research-file-tool";
import { createResearchCheckpointTool } from "@/tools/research-checkpoint-tool";
import { createSequentialThinkingTool } from "@/tools/sequential-thinking-tool";
import { createSearchResearchTool } from "@/tools/search-research-tool";
import { createSwitchResearchFolderTool } from "@/tools/switch-research-folder-tool";
import {
  registerResearchFolder,
} from "@/lib/research-search";
import {
  SafePathSegmentSchema,
  writeAppFile,
} from "@/lib/app-file-storage";
import {
  evaluateAssistantStep,
  type GuardName,
  type GuardrailEvent,
  type GuardDecision,
} from "@/lib/agent-guards";
import systemPrompt from "./system-prompt.md?raw";

export { setBraveApiKey, setExaApiKey, setSerperApiKey, setTavilyApiKey, setSearXNGBaseUrl };

const MAX_GUARD_RETRIES = 2;

const FolderNameSchema = z.object({
  folderName: z
    .string()
    .describe(
      "Short kebab-case folder name for this research, e.g. 'how-llms-work' or 'acme-market-map'. Max 5 words.",
    ),
});

function getFirstUserMessage(messages: UIMessage[]): string | null {
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = msg.parts
        .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join(" ")
        .trim();
      if (text) return text;
    }
  }
  return null;
}

async function generateResearchFolder(
  model: LanguageModel,
  messages: UIMessage[],
): Promise<string> {
  const firstMessage = getFirstUserMessage(messages);
  if (!firstMessage) return "research";

  const { object } = await generateObject({
    model,
    schema: zodSchema(FolderNameSchema),
    system:
      "You name research folders. Given a user question, produce a short, descriptive kebab-case folder name. Use at most 5 words. Focus on the core topic, not the phrasing.",
    prompt: firstMessage,
  });

  const slug = object.folderName
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  const folderName = SafePathSegmentSchema.parse(slug);

  await writeAppFile({
    subfolder: `search-results/${folderName}`,
    filename: "README.md",
    content: `# ${folderName}\n\nQuery: ${firstMessage}\n`,
  });

  await registerResearchFolder(folderName, firstMessage).catch(() => {});

  return folderName;
}

export class DirectTransport implements ChatTransport<UIMessage> {
  private researchFolder: string | null = null;

  constructor(
    private getApiKey: () => string,
    private getModel: () => string,
    researchFolder?: string | null,
    private onResearchFolderChange?: (folderName: string) => void,
  ) {
    this.researchFolder = researchFolder
      ? SafePathSegmentSchema.parse(researchFolder)
      : null;
  }

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
      researchFolder: this.researchFolder,
      apiKey: this.getApiKey(),
      messages,
      abortSignal,
      onResearchFolderChange: (folderName) => {
        this.researchFolder = folderName;
        this.onResearchFolderChange?.(folderName);
      },
    });
  }

  reconnectToStream(): Promise<ReadableStream | null> {
    return Promise.resolve(null);
  }
}

function createTools({
  model,
  getResearchFolder,
  switchResearchFolder,
  apiKey,
}: {
  model: LanguageModel;
  getResearchFolder: () => Promise<string>;
  switchResearchFolder: (folderName: string) => void;
  apiKey: string;
}) {
  return {
    ask_questions: questionsTool,
    disambiguate: disambiguateTool,
    ...(getBraveApiKey() ? { brave_search: braveSearchTool } : {}),
    ...(getExaApiKey() ? { exa_search: exaSearchTool } : {}),
    ...(getSerperApiKey() ? { serper_search: serperSearchTool } : {}),
    ...(getTavilyApiKey() ? { tavily_search: tavilySearchTool } : {}),
    ...(getSearXNGBaseUrl() ? { searxng_search: searxngSearchTool } : {}),
    extract_page_content: createExtractPageContentTool(model, getResearchFolder),
    save_research_file: createSaveResearchFileTool(getResearchFolder, apiKey),
    research_checkpoint: createResearchCheckpointTool(model),
    sequential_thinking: createSequentialThinkingTool(),
    search_research: createSearchResearchTool(apiKey),
    switch_research_folder: createSwitchResearchFolderTool(switchResearchFolder),
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
      let activeResearchFolder = researchFolder
        ? SafePathSegmentSchema.parse(researchFolder)
        : null;
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
            ).then((folderName) => {
              if (!activeResearchFolder) {
                activeResearchFolder = SafePathSegmentSchema.parse(folderName);
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
