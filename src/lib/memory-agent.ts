import { streamText, type LanguageModel } from "ai";
import {
  readAppFile,
  writeAppFile,
} from "@/lib/app-file-storage";
import { SEARCH_RESULTS_SUBFOLDER } from "@/lib/research-history";
import memoryAgentPrompt from "./memory-agent-prompt.md?raw";
import { isAbortError } from "./abort";
import { createSubAgentId } from "./sub-agent-types";
import { emitSubAgentEvent } from "./sub-agent-emitter";

const LOG_PREFIX = "[memory-extraction]";

const folderQueues = new Map<string, Promise<unknown>>();

function serializedWrite<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = folderQueues.get(key) ?? Promise.resolve();
  const next = prev.then(
    () => fn(),
    (prevError) => {
      logWarn("previous write failed, proceeding with next", {
        key,
        previousError: prevError instanceof Error ? prevError.message : "unknown",
      });
      return fn();
    },
  );
  folderQueues.set(key, next);
  void next.finally(() => {
    if (folderQueues.get(key) === next) folderQueues.delete(key);
  }).catch(() => {});
  return next;
}

function logDebug(message: string, ...args: unknown[]) {
  console.debug(`${LOG_PREFIX} ${message}`, ...args);
}

function logWarn(message: string, ...args: unknown[]) {
  console.warn(`${LOG_PREFIX} ${message}`, ...args);
}

interface ExtractAndStoreMemoriesDeps {
  readAppFile?: typeof readAppFile;
  writeAppFile?: typeof writeAppFile;
  emitEvent?: (event: import("./sub-agent-types").SubAgentEvent) => void;
}

function stripMarkdownJsonFence(text: string): string {
  let stripped = text.trim();
  stripped = stripped.replace(/^```\w*\s*\n?/i, "").replace(/\n\s*```\s*(?:\n.*)?$/i, "");
  return stripped.trim();
}

function buildMemoryExtractionPrompt(
  existingContent: string | null,
  userContent: string,
): string {
  const existing = existingContent && existingContent.trim()
    ? existingContent.trim()
    : "None.";

  return `Here are the existing memories stored about the user:\n\n${existing}\n\nHere is new user content to analyze for additional memories:\n\n${userContent}`;
}

export async function extractAndStoreMemories(
  userMessage: string,
  getResearchFolder: () => Promise<string | null | undefined>,
  model: LanguageModel,
  abortSignal?: AbortSignal,
  deps?: ExtractAndStoreMemoriesDeps,
): Promise<{ memoriesStored: number }> {
  const _readAppFile = deps?.readAppFile ?? readAppFile;
  const _writeAppFile = deps?.writeAppFile ?? writeAppFile;
  const _emitEvent = deps?.emitEvent ?? emitSubAgentEvent;
  const saId = createSubAgentId();

  // Resolve research folder FIRST — throw if unavailable
  const folder = await getResearchFolder();
  if (!folder) {
    throw new Error("No research folder available for memory extraction.");
  }

  logDebug("starting extraction", {
    subAgentId: saId,
    messageLength: userMessage.length,
  });

  _emitEvent({
    type: "start",
    id: saId,
    source: "sub-agent",
    name: "Memory Extraction",
    toolName: "memory_agent",
    parentMessageId: "transport",
  });

  try {
    const memorySubfolder = `${SEARCH_RESULTS_SUBFOLDER}/${folder}`;

    const stored = await serializedWrite(memorySubfolder, async () => {
      // Read existing memories INSIDE serializedWrite
      const existingContent = await _readAppFile({
        subfolder: memorySubfolder,
        filename: "memories.md",
      });

      // Build LLM prompt
      const prompt = buildMemoryExtractionPrompt(existingContent, userMessage);

      // Call LLM
      const result = streamText({
        model,
        system: memoryAgentPrompt,
        prompt,
        abortSignal,
      });

      let chunksReceived = 0;
      for await (const textPart of result.textStream) {
        chunksReceived++;
        _emitEvent({ type: "text-delta", id: saId, delta: textPart });
      }

      const text = await result.text;

      logDebug("stream completed", {
        chunksReceived,
        resultLength: text.length,
        resultPreview: text.slice(0, 200),
      });

      // Parse LLM output
      const stripped = stripMarkdownJsonFence(text);
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch (parseError) {
        throw new Error(
          `LLM returned invalid JSON: ${parseError instanceof Error ? parseError.message : "unknown parse error"}`,
        );
      }

      if (!Array.isArray(parsed)) {
        throw new Error("LLM returned non-array JSON");
      }

      const facts = parsed
        .map((f) => {
          if (typeof f !== "string") {
            throw new Error("LLM returned non-string entry in array");
          }
          return f;
        })
        .map((f) => f.replace(/\n/g, " ").trim())
        .filter((f) => f.length > 0);

      if (facts.length === 0) {
        // No facts to store — do NOT write to disk
        return 0;
      }

      // Write merged memories
      logDebug("writing merged memories", { factCount: facts.length });
      const content = formatMemoriesContent(facts);
      await _writeAppFile({ subfolder: memorySubfolder, filename: "memories.md", content });
      logDebug("memories stored", { stored: facts.length, total: facts.length });
      return facts.length;
    });

    if (stored === 0) {
      _emitEvent({ type: "complete", id: saId });
      return { memoriesStored: 0 };
    }

    _emitEvent({ type: "complete", id: saId });
    return { memoriesStored: stored };
  } catch (error) {
    if (isAbortError(error) || abortSignal?.aborted) {
      logDebug("extraction cancelled by user");
      _emitEvent({ type: "cancelled", id: saId });
      throw error;
    }
    logWarn("extraction failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    _emitEvent({ type: "error", id: saId, error: "Memory extraction failed" });
    throw error;
  }
}

function formatMemoriesContent(facts: string[]): string {
  const lines = ["# Memories", "", ...facts.map((f) => `- ${f}`), ""];
  return lines.join("\n");
}
