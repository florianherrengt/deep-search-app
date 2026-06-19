import { isToolUIPart, type ChatTransport, type UIMessage, type UIMessageChunk } from "ai";
import {
  createChatLanguageModel,
  type ChatModelConfig,
} from "@/lib/chat-providers";
import { SafePathSegmentSchema } from "@/lib/app-file-storage";
import { throwIfAborted } from "@/lib/abort";
import { isSubAgentOutputTextPart } from "@/lib/sub-agent-stream";
import {
  emitSubAgentEventToChat,
  setActiveSubAgentEmitter,
} from "@/lib/sub-agent-emitter";
import type { SubAgentEvent } from "@/lib/sub-agent-types";
import { createGuardedStream } from "./guarded-stream";
import type { SearchToolKeys } from "./tool-registry";
import {
  initializeResearchFolder,
  moveResearchChatToFolder,
  saveResearchChatMessages,
} from "@/lib/research-history";
import { extractAndStoreMemories } from "@/lib/memory-agent";
import { isRecord } from "@/lib/json";
import { generateFolderSlug } from "./folder-namer";
import { slugifyFolderName } from "./research-folder";

export { createGuardedStream } from "./guarded-stream";
export type { SearchToolKeys } from "./tool-registry";

export type MemoryExtractionCandidate = {
  id: string;
  source: "user-message" | "tool-answer";
  toolName?: "ask_questions";
  content: string;
  messageIndex: number;
  metadata?: Record<string, unknown>;
};

/**
 * Collects memory-extraction candidates from the message history.
 *
 * Pure and stateless: it inspects `messages` and returns 0–2 candidates; it
 * performs no I/O, no logging, and never throws. Deduplication of already-
 * extracted messages is handled separately by `processedMemoryMessageIds` in
 * the `sendMessages` trigger block — this function simply reports what is
 * eligible right now.
 *
 * Returns at most ONE candidate per source type:
 *   - "user-message": the latest user message containing non-empty text.
 *   - "tool-answer":  the latest assistant message with `ask_questions`
 *                     answers in `output-available` state.
 *
 * Scan order is end → start so each source resolves to its MOST RECENT
 * eligible message (matches the old "find last user message" semantics). Once
 * a source is resolved it is not replaced by an older occurrence.
 *
 * A source is only marked "found" when a valid, non-empty candidate exists for
 * it. An unanswered (`input-available`) or errored (`output-error`)
 * ask_questions part, or one whose answers are all empty/malformed, does NOT
 * mark "tool-answer" as found — so an earlier assistant message can still
 * supply the tool-answer candidate instead.
 *
 * Candidates are returned sorted by `messageIndex` ascending (oldest-first)
 * so extraction runs in conversation order: each extraction lets the LLM
 * rewrite the full memory list, and oldest-first gives the most natural merge
 * progression.
 *
 * The design is intentionally generic: new candidate sources (other tools,
 * onboarding, forms) can be added by appending another source block without
 * changing the extraction engine or the trigger block.
 *
 * Spec: specs/memory-extraction-ask-questions.md §9.1, §12.3.
 */
export function collectMemoryCandidates(
  messages: UIMessage[],
): MemoryExtractionCandidate[] {
  const result: MemoryExtractionCandidate[] = [];
  const foundSources = new Set<string>();

  // Scan newest → oldest; pick up at most the latest eligible message per source.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];

    // Source: user-message
    if (msg.role === "user" && !foundSources.has("user-message")) {
      const text = msg.parts
        .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join(" ")
        .trim();
      if (text) {
        result.push({ id: msg.id, source: "user-message", content: text, messageIndex: i });
        foundSources.add("user-message");
      }
    }

    // Source: tool-answer (ask_questions answers)
    if (msg.role === "assistant" && !foundSources.has("tool-answer")) {
      const qaEntries: Array<{ question: string; answer: string }> = [];

      for (const part of msg.parts) {
        if (!isRecord(part) || part.type !== "tool-ask_questions") continue;
        // Only answered questions are eligible; input-available/output-error are not.
        if (part.state !== "output-available") continue;
        if (!isRecord(part.output) || !Array.isArray(part.output.answers)) continue;

        for (const entry of part.output.answers) {
          // Skip malformed entries; the question is kept only as context.
          if (!isRecord(entry)) continue;
          if (typeof entry.question !== "string") continue;
          if (typeof entry.answer !== "string") continue;
          const answerText = entry.answer.trim();
          if (answerText.length === 0) continue;
          qaEntries.push({
            question: entry.question.trim(),
            answer: answerText,
          });
        }
      }

      // Only register the source when at least one valid answer exists; otherwise
      // leave it unmarked so an earlier assistant message can still supply it.
      if (qaEntries.length > 0) {
        const content =
          "The following content contains user-authored answers to app-generated questions.\n\n" +
          JSON.stringify(qaEntries, null, 2);
        result.push({
          id: msg.id,
          source: "tool-answer",
          toolName: "ask_questions",
          content,
          messageIndex: i,
        });
        foundSources.add("tool-answer");
      }
    }

    // Stop scanning once all sources are found
    if (foundSources.size === 2) break;
  }

  // Extraction runs oldest-first so the LLM merge progresses in conversation order.
  return result.sort((a, b) => a.messageIndex - b.messageIndex);
}

export interface ResearchFolderChangeOptions {
  previousFolderName?: string;
}

export class DirectTransport implements ChatTransport<UIMessage> {
  private researchFolder: string | null = null;
  private processedMemoryMessageIds = new Set<string>();

  constructor(
    private getChatModel: () => ChatModelConfig | null,
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
    trigger,
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
    const firstMessage = getFirstUserMessage(messages);
    const transport = this;

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        const subAgentEmitter = (event: SubAgentEvent) => {
          emitSubAgentEventToChat(transport.researchChatId, event);
        };

        setActiveSubAgentEmitter(null, null, transport.researchChatId);

        try {
          if (!transport.researchFolder) {
            if (firstMessage) {
              const chatTitle = slugifyFolderName(firstMessage);

              const folderName = await generateFolderSlug(
                model,
                firstMessage,
                { abortSignal },
              );

              await initializeResearchFolderOrThrow(folderName, "created");
              await saveInitialResearchChatOrThrow(
                folderName,
                transport.researchChatId,
                messages,
                { title: chatTitle || undefined },
              );

              transport.researchFolder = folderName;
              transport.onResearchFolderChange?.(folderName, {});
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

          if (transport.researchFolder && trigger === "submit-message") {
            const correlationId = crypto.randomUUID();

            const candidates = collectMemoryCandidates(messages);

            if (candidates.length === 0) {
              console.debug("[memory-extraction]", {
                correlationId,
                decision: "skip-no-candidate",
              });
            }

            for (const candidate of candidates) {
              if (transport.processedMemoryMessageIds.has(candidate.id)) {
                console.debug("[memory-extraction]", {
                  correlationId,
                  candidateId: candidate.id,
                  source: candidate.source,
                  ...(candidate.toolName ? { toolName: candidate.toolName } : {}),
                  decision: "skip-processed",
                });
                continue;
              }

              console.debug("[memory-extraction]", {
                correlationId,
                candidateId: candidate.id,
                source: candidate.source,
                ...(candidate.toolName ? { toolName: candidate.toolName } : {}),
                decision: "extract",
                contentLength: candidate.content.length,
              });

              await extractAndStoreMemories(
                candidate.content,
                async () => transport.researchFolder,
                model,
                abortSignal,
                { emitEvent: subAgentEmitter },
              );

              transport.processedMemoryMessageIds.add(candidate.id);
            }
          }

          await createGuardedStream({
            model,
            researchFolder: transport.researchFolder,
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
          setActiveSubAgentEmitter(null, null, null);
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
  options?: { title?: string },
): Promise<void> {
  try {
    await saveResearchChatMessages(folderName, chatId, messages, options);
  } catch (error) {
    throw new Error(
      `Research could not start because the research folder "${folderName}" could not be initialized. ${errorMessage(error)}`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

export function isEligibleForMemoryExtraction(message: UIMessage): boolean {
  return message.role === "user";
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
