import { isToolUIPart, type ChatTransport, type UIMessage, type UIMessageChunk } from "ai";
import {
  createChatLanguageModel,
  type ChatModelConfig,
} from "@/lib/chat-providers";
import { SafePathSegmentSchema } from "@/lib/app-file-storage";
import { isAbortError, throwIfAborted } from "@/lib/abort";
import { isSubAgentOutputTextPart } from "@/lib/sub-agent-stream";
import {
  emitSubAgentEventToChat,
} from "@/lib/sub-agent-emitter";
import type { SubAgentEvent } from "@/lib/sub-agent-types";
import { createGuardedStream } from "./guarded-stream";
import type { SearchToolKeys } from "./tool-registry";
import {
  deleteResearchFolderIfDisposable,
  initializeResearchFolder,
  isResearchChatProvisional,
  moveResearchChatToFolder,
  saveResearchChatMessages,
} from "@/lib/research-history";
import { extractAndStoreMemories } from "@/lib/memory-agent";
import { isRecord } from "@/lib/json";
import { generateFolderSlug } from "./folder-namer";
import { slugifyFolderName } from "./research-folder";
import {
  createInterruptedToolRepairDiagnostic,
  logInterruptedToolCallRepair,
  repairInterruptedToolCallMessages,
} from "@/lib/tool-call-repair";
import {
  mergeResearchMemoriesWithLockedCleanup,
} from "@/lib/research-memory";
import {
  getAuthorizedResearchFolderSwitches,
  getResearchContinuationCandidates,
} from "@/lib/research-recall";

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

type PendingMemoryCandidate = {
  candidate: MemoryExtractionCandidate;
  attempts: number;
};

const MAX_PENDING_MEMORY_CANDIDATES = 50;
const MAX_MEMORY_EXTRACTIONS_PER_TURN = 2;
const MAX_MEMORY_EXTRACTION_ATTEMPTS = 3;

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
        if (isRecord(part.output) && part.output.skipped === true) continue;
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
  private autoCreatedResearchFolder: string | null = null;
  private processedMemoryMessageIds = new Set<string>();
  private abandonedMemoryMessageIds = new Set<string>();
  private pendingMemoryCandidates = new Map<string, PendingMemoryCandidate>();

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
    const parsedResearchFolder = researchFolder
      ? SafePathSegmentSchema.parse(researchFolder)
      : null;
    this.researchFolder = parsedResearchFolder;

    if (
      !parsedResearchFolder ||
      (this.autoCreatedResearchFolder &&
        this.autoCreatedResearchFolder !== parsedResearchFolder)
    ) {
      this.autoCreatedResearchFolder = null;
    }
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
    const repair = repairInterruptedToolCallMessages(messages);
    const effectiveMessages = repair.repaired ? repair.messages : messages;
    if (repair.repaired) {
      logInterruptedToolCallRepair("direct-transport-before-send", repair);
    }

    const firstMessage = getFirstUserMessage(effectiveMessages);
    const transport = this;

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        const subAgentEmitter = (event: SubAgentEvent) => {
          emitSubAgentEventToChat(transport.researchChatId, event);
        };

        try {
          if (!transport.researchFolder) {
            if (firstMessage) {
              const chatTitle = slugifyFolderName(firstMessage);

              const folderName = await generateFolderSlug(
                model,
                firstMessage,
                { abortSignal, emitEvent: subAgentEmitter },
              );

              await initializeResearchFolderOrThrow(folderName, "created");
              await saveInitialResearchChatOrThrow(
                folderName,
                transport.researchChatId,
                effectiveMessages,
                { title: chatTitle || undefined, provisional: true },
              );

              transport.researchFolder = folderName;
              transport.autoCreatedResearchFolder = folderName;
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

            const previousResearchChoice = getPreviousResearchChoice(effectiveMessages);
            if (previousResearchChoice.type === "continue") {
              if (
                !transport.autoCreatedResearchFolder &&
                transport.researchFolder &&
                (await isResearchChatProvisional(
                  transport.researchFolder,
                  transport.researchChatId,
                ))
              ) {
                transport.autoCreatedResearchFolder = transport.researchFolder;
              }
              await transport.switchResearchFolder(
                previousResearchChoice.folder,
                effectiveMessages,
                { deleteAutoCreatedPreviousFolder: true },
              );
            } else if (previousResearchChoice.type === "new") {
              await saveResearchChatMessages(
                transport.researchFolder,
                transport.researchChatId,
                effectiveMessages,
                { provisional: false },
              );
              transport.autoCreatedResearchFolder = null;
            }
          }

          if (transport.researchFolder && trigger === "submit-message") {
            const correlationId = crypto.randomUUID();

            const latestCandidates = collectMemoryCandidates(effectiveMessages);
            for (const candidate of latestCandidates) {
              if (
                transport.processedMemoryMessageIds.has(candidate.id) ||
                transport.abandonedMemoryMessageIds.has(candidate.id)
              ) {
                continue;
              }
              const pending = transport.pendingMemoryCandidates.get(candidate.id);
              if (pending) {
                pending.candidate = candidate;
                continue;
              }
              if (
                transport.pendingMemoryCandidates.size >=
                MAX_PENDING_MEMORY_CANDIDATES
              ) {
                const oldestId = transport.pendingMemoryCandidates.keys().next().value;
                if (typeof oldestId === "string") {
                  transport.pendingMemoryCandidates.delete(oldestId);
                  transport.abandonedMemoryMessageIds.add(oldestId);
                  console.warn("[memory-extraction] Dropping oldest pending candidate", {
                    candidateId: oldestId,
                    reason: "pending queue limit reached",
                  });
                }
              }
              transport.pendingMemoryCandidates.set(candidate.id, {
                candidate,
                attempts: 0,
              });
            }
            const candidates = [...transport.pendingMemoryCandidates.values()]
              .sort(
                (left, right) =>
                  left.candidate.messageIndex - right.candidate.messageIndex,
              )
              .slice(0, MAX_MEMORY_EXTRACTIONS_PER_TURN);

            if (candidates.length === 0) {
              console.debug("[memory-extraction]", {
                correlationId,
                decision: "skip-no-candidate",
              });
            }

            for (const pending of candidates) {
              const candidate = pending.candidate;
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

              try {
                await extractAndStoreMemories(
                  candidate.content,
                  async () => transport.researchFolder,
                  model,
                  abortSignal,
                  { emitEvent: subAgentEmitter },
                );
                transport.processedMemoryMessageIds.add(candidate.id);
                transport.pendingMemoryCandidates.delete(candidate.id);
              } catch (error) {
                if (isAbortError(error) || abortSignal?.aborted) throw error;
                pending.attempts += 1;
                if (pending.attempts >= MAX_MEMORY_EXTRACTION_ATTEMPTS) {
                  transport.pendingMemoryCandidates.delete(candidate.id);
                  transport.abandonedMemoryMessageIds.add(candidate.id);
                }
                console.warn("[memory-extraction] Continuing research after memory failure", {
                  candidateId: candidate.id,
                  source: candidate.source,
                  attempt: pending.attempts,
                  abandoned:
                    pending.attempts >= MAX_MEMORY_EXTRACTION_ATTEMPTS,
                  error: error instanceof Error ? error.message : "unknown",
                });
              }
            }
          }

          if (repair.repaired) {
            controller.enqueue({
              type: "data-agent_diagnostic",
              id: `agent-diagnostic-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              data: createInterruptedToolRepairDiagnostic(repair),
            });
          }

          await createGuardedStream({
            model,
            researchFolder: transport.researchFolder,
            messages: effectiveMessages,
            abortSignal,
            searchKeys: transport.getSearchKeys(),
            onResearchFolderChange: async (folderName) => {
              await transport.switchResearchFolder(folderName, effectiveMessages);
            },
            emitEvent: subAgentEmitter,
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
    options?: { deleteAutoCreatedPreviousFolder?: boolean },
  ) {
    const parsedFolderName = SafePathSegmentSchema.parse(folderName);
    const previousFolderName = this.researchFolder;
    const shouldDeletePreviousFolder =
      options?.deleteAutoCreatedPreviousFolder === true &&
      previousFolderName !== null &&
      previousFolderName === this.autoCreatedResearchFolder &&
      previousFolderName !== parsedFolderName;

    if (previousFolderName && previousFolderName !== parsedFolderName) {
      await moveResearchChatToFolder({
        fromFolderName: previousFolderName,
        toFolderName: parsedFolderName,
        chatId: this.researchChatId,
        messages,
        requireExistingDestination: true,
      });
    }

    let cleanupResult:
      | Awaited<ReturnType<typeof deleteResearchFolderIfDisposable>>
      | undefined;
    if (shouldDeletePreviousFolder && previousFolderName) {
      try {
        const result = await mergeResearchMemoriesWithLockedCleanup(
          previousFolderName,
          parsedFolderName,
          () =>
            deleteResearchFolderIfDisposable(previousFolderName, {
              ignoredRootFiles: ["memories.md"],
            }),
        );
        cleanupResult = result.cleanupResult;
      } catch (error) {
        console.warn(
          `[transport] Failed to merge memories or safely clean up auto-created research folder "${previousFolderName}" after switching to "${parsedFolderName}". The source folder was retained:`,
          error,
        );
      }
    }

    this.researchFolder = parsedFolderName;
    this.autoCreatedResearchFolder = null;

    if (cleanupResult && !cleanupResult.deleted && previousFolderName) {
      console.warn(
        `[transport] Retaining auto-created research folder "${previousFolderName}" because it still contains research data:`,
        {
          rootFiles: cleanupResult.remainingRootFiles,
          chatFiles: cleanupResult.remainingChatFiles,
          subfolders: cleanupResult.remainingSubfolders,
        },
      );
    }

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
  options?: { title?: string; provisional?: boolean },
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
  const latestUserIndex = messages.reduce(
    (latest, message, index) => (message.role === "user" ? index : latest),
    -1,
  );
  const currentTurnMessages =
    latestUserIndex === -1 ? messages : messages.slice(latestUserIndex);
  const authorizedFolders = getAuthorizedResearchFolderSwitches(
    currentTurnMessages,
  );

  for (let messageIndex = currentTurnMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = currentTurnMessages[messageIndex];
    if (message.role !== "assistant") continue;

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      const answers = getAskQuestionsAnswers(part);
      if (!answers) continue;
      if (!isRecord(part)) continue;
      const toolPart = part as Record<string, unknown>;
      const continuationCandidates = getResearchContinuationCandidates(
        toolPart.input,
      );
      if (continuationCandidates.folders.size === 0) continue;

      sawAnswer = true;
      for (let answerIndex = answers.length - 1; answerIndex >= 0; answerIndex -= 1) {
        const answer = answers[answerIndex];
        if (answer === "new" && continuationCandidates.allowsNew) {
          return { type: "new" };
        }

        if (answer.startsWith("continue:")) {
          const folder = answer.slice("continue:".length).trim();
          if (
            SafePathSegmentSchema.safeParse(folder).success &&
            continuationCandidates.folders.has(folder) &&
            authorizedFolders.has(folder)
          ) {
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
  if (isRecord(part.output) && part.output.skipped === true) return null;
  if (!isRecord(part.output) || !Array.isArray(part.output.answers)) {
    return null;
  }

  return part.output.answers.flatMap((answer) => {
    if (!isRecord(answer) || typeof answer.answer !== "string") return [];
    return [answer.answer.trim()];
  });
}
