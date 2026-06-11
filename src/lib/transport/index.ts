import { isToolUIPart, type ChatTransport, type UIMessage, type UIMessageChunk } from "ai";
import {
  createChatLanguageModel,
  type ChatModelConfig,
} from "@/lib/chat-providers";
import { SafePathSegmentSchema } from "@/lib/app-file-storage";
import { throwIfAborted } from "@/lib/abort";
import { isSubAgentOutputTextPart } from "@/lib/sub-agent-stream";
import { setActiveSubAgentEmitter } from "@/lib/sub-agent-emitter";
import type { SubAgentEvent } from "@/lib/sub-agent-types";
import { createGuardedStream } from "./guarded-stream";
import type { SearchToolKeys } from "./tool-registry";
import type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";
import {
  initializeResearchFolder,
  moveResearchChatToFolder,
  saveResearchChatMessages,
} from "@/lib/research-history";
import { extractAndStoreMemories } from "@/lib/memory-agent";
import { isRecord } from "@/lib/json";
import { nameFolderFromMessage } from "./folder-namer";

export { createGuardedStream } from "./guarded-stream";
export type { SearchToolKeys } from "./tool-registry";
export type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";

export interface ResearchFolderChangeOptions {
  previousFolderName?: string;
}

export class DirectTransport implements ChatTransport<UIMessage> {
  private researchFolder: string | null = null;

  constructor(
    private getChatModel: () => ChatModelConfig | null,
    private getEmbeddingConfig: () => EmbeddingConfig,
    private getRerankerConfig: () => RerankerConfig,
    private getSearchKeys: () => SearchToolKeys,
    private researchChatId: string,
    researchFolder?: string | null,
    private onResearchFolderChange?: (
      folderName: string,
      options: ResearchFolderChangeOptions,
    ) => void,
  ) {
    if (researchFolder) {
      this.researchFolder = SafePathSegmentSchema.parse(researchFolder);
    }
  }

  setResearchFolder(researchFolder: string | null) {
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
    throwIfAborted(abortSignal);

    const chatModel = this.getChatModel();
    if (!chatModel) {
      throw new Error("No chat model is configured.");
    }

    const model = createChatLanguageModel(chatModel);
    const embeddingConfig = this.getEmbeddingConfig();
    const rerankerConfig = this.getRerankerConfig();
    const firstMessage = getFirstUserMessage(messages);
    const transport = this;

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        const subAgentEmitter = (event: SubAgentEvent) => {
          controller.enqueue({
            type: "data-subagent_event" as const,
            id: `subagent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            data: event,
          });
        };

        setActiveSubAgentEmitter(subAgentEmitter, null);

        try {
          let initialMessagesSaved = false;

          if (!transport.researchFolder) {
            if (firstMessage) {
              const folderName = await nameFolderFromMessage(model, firstMessage, {
                abortSignal,
              });

              await initializeResearchFolderOrThrow(folderName, "created");
              await saveInitialResearchChatOrThrow(
                folderName,
                transport.researchChatId,
                messages,
              );

              transport.researchFolder = folderName;
              transport.onResearchFolderChange?.(folderName, {});
              initialMessagesSaved = true;
            } else {
              throw new Error(
                "Research could not start because the research folder name could not be generated. No user message was available for folder naming.",
              );
            }
          } else {
            await initializeResearchFolderOrThrow(
              transport.researchFolder,
              "initialized",
            );

            const previousResearchChoice = getPreviousResearchChoice(messages);
            if (previousResearchChoice.type === "continue") {
              await transport.switchResearchFolder(previousResearchChoice.folder, messages);
            }
          }

          if (transport.researchFolder) {
            if (!initialMessagesSaved) {
              void saveResearchChatMessages(
                transport.researchFolder,
                transport.researchChatId,
                messages,
              ).catch(() => {});
            }

            const lastUserMessage = getLastUserMessage(messages);
            if (lastUserMessage) {
              void extractAndStoreMemories(
                lastUserMessage,
                async () => transport.researchFolder!,
                model,
                abortSignal,
              ).catch(() => {});
            }
          }

          await createGuardedStream({
            model,
            researchFolder: transport.researchFolder,
            embeddingConfig,
            rerankerConfig,
            messages,
            abortSignal,
            searchKeys: transport.getSearchKeys(),
            onResearchFolderChange: async (folderName) => {
              await transport.switchResearchFolder(folderName, messages);
            },
            controller,
          });

          if (abortSignal?.aborted) {
            controller.enqueue({ type: "abort", reason: "aborted" });
          } else {
            controller.enqueue({ type: "finish", finishReason: "stop" });
          }
        } catch (error) {
          if (abortSignal?.aborted) {
            controller.enqueue({ type: "abort", reason: "aborted" });
          } else {
            controller.enqueue({
              type: "error",
              errorText: error instanceof Error ? error.message : "Transport failed.",
            });
            controller.enqueue({ type: "finish", finishReason: "error" });
          }
        } finally {
          setActiveSubAgentEmitter(null, null);
          controller.close();
        }
      },
    });
  }

  reconnectToStream(): Promise<ReadableStream | null> {
    return Promise.resolve(null);
  }

  private async switchResearchFolder(
    folderName: string,
    messages: UIMessage[],
  ) {
    const parsedFolderName = SafePathSegmentSchema.parse(folderName);
    const previousFolderName = this.researchFolder;

    if (previousFolderName && previousFolderName !== parsedFolderName) {
      await moveResearchChatToFolder({
        fromFolderName: previousFolderName,
        toFolderName: parsedFolderName,
        chatId: this.researchChatId,
        messages,
      });
    }

    this.researchFolder = parsedFolderName;
    this.onResearchFolderChange?.(parsedFolderName, {
      ...(previousFolderName && previousFolderName !== parsedFolderName
        ? { previousFolderName }
        : {}),
    });
  }
}

export function shouldContinueAfterToolResult({
  messages,
}: {
  messages: UIMessage[];
}) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;

  const parts = last.parts;
  const lastStepStartIndex = parts.reduce(
    (found, part, i) => (part.type === "step-start" ? i : found),
    -1,
  );
  const lastStepParts = parts.slice(lastStepStartIndex + 1);
  const lastStepToolIndex = lastStepParts.reduceRight(
    (found, part, i) => (found === -1 && isToolUIPart(part) ? i : found),
    -1,
  );
  if (lastStepToolIndex === -1) return false;

  const hasAssistantOutputAfterTool = lastStepParts
    .slice(lastStepToolIndex + 1)
    .some(
      (p) =>
        isAssistantOutputPart(p) &&
        !isSubAgentOutputTextPart(p),
    );
  if (hasAssistantOutputAfterTool) return false;

  return lastStepParts
    .filter(isToolUIPart)
    .every((p) => p.state === "output-available" || p.state === "output-error");
}

function isAssistantOutputPart(part: UIMessage["parts"][number]): boolean {
  if (part.type === "text" || part.type === "reasoning") {
    return part.text.trim().length > 0;
  }

  return (
    part.type === "source-url" ||
    part.type === "source-document" ||
    part.type === "file"
  );
}

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

async function initializeResearchFolderOrThrow(
  folderName: string,
  action: "created" | "initialized",
): Promise<void> {
  try {
    await initializeResearchFolder(folderName);
  } catch (error) {
    throw new Error(
      `Research could not start because the research folder "${folderName}" could not be ${action}. ${errorMessage(error)}`,
    );
  }
}

async function saveInitialResearchChatOrThrow(
  folderName: string,
  chatId: string,
  messages: UIMessage[],
): Promise<void> {
  try {
    await saveResearchChatMessages(folderName, chatId, messages);
  } catch (error) {
    throw new Error(
      `Research could not start because the research folder "${folderName}" could not be initialized. ${errorMessage(error)}`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function getLastUserMessage(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
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

type PreviousResearchChoice =
  | { type: "none" }
  | { type: "answered" }
  | { type: "new" }
  | { type: "continue"; folder: string };

function getPreviousResearchChoice(
  messages: UIMessage[],
): PreviousResearchChoice {
  let sawAnswer = false;

  for (const message of messages) {
    if (message.role !== "assistant") continue;

    for (const part of message.parts) {
      const answers = getAskQuestionsAnswers(part);
      if (!answers) continue;

      sawAnswer = true;
      for (const answer of answers) {
        if (answer === "new") {
          return { type: "new" };
        }

        if (answer.startsWith("continue:")) {
          const folder = answer.slice("continue:".length).trim();
          if (SafePathSegmentSchema.safeParse(folder).success) {
            return { type: "continue", folder };
          }
        }
      }
    }
  }

  return sawAnswer ? { type: "answered" } : { type: "none" };
}

function getAskQuestionsAnswers(
  part: UIMessage["parts"][number],
): string[] | null {
  if (!isRecord(part) || part.type !== "tool-ask_questions") return null;
  if (part.state !== "output-available") return null;
  if (!isRecord(part.output) || !Array.isArray(part.output.answers)) {
    return null;
  }

  return part.output.answers.flatMap((answer) => {
    if (!isRecord(answer) || typeof answer.answer !== "string") return [];
    return [answer.answer.trim()];
  });
}
