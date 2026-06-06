import { isToolUIPart, type ChatTransport, type UIMessage } from "ai";
import {
  createChatLanguageModel,
  type ChatModelConfig,
} from "@/lib/chat-providers";
import { SafePathSegmentSchema } from "@/lib/app-file-storage";
import { isAbortError, throwIfAborted } from "@/lib/abort";
import { isSubAgentOutputTextPart } from "@/lib/sub-agent-stream";
import { createGuardedStream, getResearchFolderContext } from "./guarded-stream";
import type { SearchToolKeys } from "./tool-registry";
import type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";
import {
  createProvisionalResearchFolder,
  moveResearchChatToFolder,
  saveResearchChatMessages,
} from "@/lib/research-history";
import { searchResearch, type SearchResult } from "@/lib/research-search";
import { evaluateResearchRelevance } from "@/lib/research-relevance-evaluator";

export { createGuardedStream } from "./guarded-stream";
export type { SearchToolKeys } from "./tool-registry";
export type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";

export interface ResearchFolderChangeOptions {
  isProvisional: boolean;
  previousFolderName?: string;
}

export class DirectTransport implements ChatTransport<UIMessage> {
  private researchFolder: string | null = null;
  private provisionalResearchFolder: string | null = null;

  constructor(
    private getChatModel: () => ChatModelConfig | null,
    private getEmbeddingConfig: () => EmbeddingConfig,
    private getRerankerConfig: () => RerankerConfig,
    private getSearchKeys: () => SearchToolKeys,
    private researchChatId: string,
    researchFolder?: string | null,
    isProvisionalResearchFolder = false,
    private onResearchFolderChange?: (
      folderName: string,
      options: ResearchFolderChangeOptions,
    ) => void,
  ) {
    this.setResearchFolder(researchFolder ?? null, {
      isProvisional: isProvisionalResearchFolder,
    });
  }

  setResearchFolder(
    researchFolder: string | null,
    options?: { isProvisional?: boolean },
  ) {
    this.researchFolder = researchFolder
      ? SafePathSegmentSchema.parse(researchFolder)
      : null;
    this.provisionalResearchFolder =
      this.researchFolder && options?.isProvisional
        ? this.researchFolder
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

    let upfrontSearchResults: SearchResult[] | undefined;
    if (!this.researchFolder) {
      if (firstMessage) {
        const provisionalFolderName = await createProvisionalResearchFolder(
          this.researchChatId,
          messages,
        );
        this.researchFolder = provisionalFolderName;
        this.provisionalResearchFolder = provisionalFolderName;
        this.onResearchFolderChange?.(provisionalFolderName, {
          isProvisional: true,
        });

        upfrontSearchResults = await searchResearch(
          embeddingConfig,
          rerankerConfig,
          firstMessage,
          { limit: 5, abortSignal },
        ).catch((error) => {
          if (isAbortError(error)) throw error;
          return undefined;
        });

        if (upfrontSearchResults && upfrontSearchResults.length > 0) {
          upfrontSearchResults = await evaluateResearchRelevance(
            firstMessage,
            upfrontSearchResults,
            model,
            abortSignal,
          ).catch((error) => {
            if (isAbortError(error)) throw error;
            console.error("[transport] upfront relevance evaluation failed:", error);
            return upfrontSearchResults!;
          });
        }

      }
    } else if (this.provisionalResearchFolder) {
      throwIfAborted(abortSignal);
      const previousResearchChoice = getPreviousResearchChoice(messages);
      if (previousResearchChoice.type === "continue") {
        await this.switchResearchFolder(previousResearchChoice.folder, messages);
      }
    }

    if (this.researchFolder) {
      void saveResearchChatMessages(
        this.researchFolder,
        this.researchChatId,
        messages,
      ).catch(() => {});
    }

    let folderContext: Awaited<ReturnType<typeof getResearchFolderContext>> | undefined;
    if (this.researchFolder && !this.provisionalResearchFolder) {
      throwIfAborted(abortSignal);
      folderContext = await getResearchFolderContext(this.researchFolder).catch(
        () => undefined,
      );
    }

    return createGuardedStream({
      model,
      researchFolder: this.researchFolder,
      embeddingConfig,
      rerankerConfig,
      messages,
      abortSignal,
      searchKeys: this.getSearchKeys(),
      upfrontSearchResults,
      folderContext,
      onResearchFolderChange: async (folderName) => {
        await this.switchResearchFolder(folderName, messages);
      },
      onProvisionalFolderRenamed: (newName) => {
        const previousFolderName = this.provisionalResearchFolder;
        this.researchFolder = newName;
        this.provisionalResearchFolder = null;
        this.onResearchFolderChange?.(newName, {
          isProvisional: false,
          ...(previousFolderName && previousFolderName !== newName
            ? { previousFolderName }
            : {}),
        });
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
    const provisionalFolderName = this.provisionalResearchFolder;

    if (provisionalFolderName && provisionalFolderName !== parsedFolderName) {
      await moveResearchChatToFolder({
        fromFolderName: provisionalFolderName,
        toFolderName: parsedFolderName,
        chatId: this.researchChatId,
        messages,
      });
    }

      this.researchFolder = parsedFolderName;
      this.provisionalResearchFolder = null;
      this.onResearchFolderChange?.(parsedFolderName, {
      isProvisional: false,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
