import { streamText, type LanguageModel } from "ai";
import {
  readAppFile,
  writeAppFile,
} from "@/lib/app-file-storage";
import memoryAgentPrompt from "./memory-agent-prompt.md?raw";
import { isAbortError } from "./abort";
import { createSubAgentId } from "./sub-agent-types";
import { emitSubAgentEvent } from "./sub-agent-emitter";
import {
  formatResearchMemoriesForRewrite,
  researchMemorySubfolder,
  withResearchMemoryLock,
} from "./research-memory";

const LOG_PREFIX = "[memory-extraction]";
const MAX_EXISTING_MEMORY_CHARACTERS = 48_000;
const MAX_NEW_MEMORY_CANDIDATE_CHARACTERS = 16_000;

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
    const memorySubfolder = researchMemorySubfolder(folder);

    const stored = await withResearchMemoryLock(folder, async () => {
      // Read existing memories INSIDE serializedWrite
      const existingContent = await _readAppFile({
        subfolder: memorySubfolder,
        filename: "memories.md",
      });

      if ((existingContent?.length ?? 0) > MAX_EXISTING_MEMORY_CHARACTERS) {
        throw new Error(
          "memories.md is too large for safe automatic extraction; existing memories were preserved.",
        );
      }
      if (userMessage.length > MAX_NEW_MEMORY_CANDIDATE_CHARACTERS) {
        throw new Error(
          "The memory candidate is too large for safe automatic extraction; existing memories were preserved.",
        );
      }

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
      const content = formatResearchMemoriesForRewrite(
        existingContent,
        facts,
      );
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
