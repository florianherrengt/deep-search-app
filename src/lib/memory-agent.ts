import { streamText, type LanguageModel } from "ai";
import {
  readAppFile,
  writeAppFile,
} from "@/lib/app-file-storage";
import { SEARCH_RESULTS_SUBFOLDER } from "@/lib/research-history";
import memoryAgentPrompt from "./memory-agent-prompt.md?raw";
import { createSubAgentId } from "./sub-agent-types";
import { emitSubAgentEvent } from "./sub-agent-emitter";

const LOG_PREFIX = "[memory-extraction]";

function logDebug(message: string, ...args: unknown[]) {
  console.debug(`${LOG_PREFIX} ${message}`, ...args);
}

function logWarn(message: string, ...args: unknown[]) {
  console.warn(`${LOG_PREFIX} ${message}`, ...args);
}

interface ExtractAndStoreMemoriesDeps {
  readAppFile: typeof readAppFile;
  writeAppFile: typeof writeAppFile;
}

export async function extractAndStoreMemories(
  userMessage: string,
  getResearchFolder: () => Promise<string>,
  model: LanguageModel,
  abortSignal?: AbortSignal,
  deps?: ExtractAndStoreMemoriesDeps,
): Promise<{ memoriesStored: number }> {
  const _readAppFile = deps?.readAppFile ?? readAppFile;
  const _writeAppFile = deps?.writeAppFile ?? writeAppFile;
  const saId = createSubAgentId();

  logDebug("starting extraction", {
    subAgentId: saId,
    messageLength: userMessage.length,
  });

  emitSubAgentEvent({
    type: "start",
    id: saId,
    source: "sub-agent",
    name: "Memory Extraction",
    toolName: "memory_agent",
    parentMessageId: "transport",
  });

  try {
    const result = streamText({
      model,
      system: memoryAgentPrompt,
      prompt: userMessage,
      abortSignal,
    });

    let chunksReceived = 0;
    for await (const textPart of result.textStream) {
      chunksReceived++;
      emitSubAgentEvent({ type: "text-delta", id: saId, delta: textPart });
    }

    const text = await result.text;

    logDebug("stream completed", {
      chunksReceived,
      resultLength: text.length,
      resultPreview: text.slice(0, 200),
    });

    let newFacts: string[];
    try {
      const parsed = JSON.parse(text.trim());
      if (!Array.isArray(parsed)) {
        logWarn("LLM returned non-array", { type: typeof parsed });
        emitSubAgentEvent({ type: "complete", id: saId });
        return { memoriesStored: 0 };
      }
      newFacts = parsed.filter(
        (f): f is string => typeof f === "string" && f.trim().length > 0,
      );
    } catch (parseError) {
      logWarn("LLM output is not valid JSON", {
        error: parseError instanceof Error ? parseError.message : "unknown",
        rawPreview: text.slice(0, 100),
      });
      emitSubAgentEvent({ type: "complete", id: saId });
      return { memoriesStored: 0 };
    }

    if (newFacts.length === 0) {
      logDebug("no facts extracted");
      emitSubAgentEvent({ type: "complete", id: saId });
      return { memoriesStored: 0 };
    }

    logDebug("parsed facts", { factCount: newFacts.length, facts: newFacts });

    const folder = await getResearchFolder();
    const subfolder = `${SEARCH_RESULTS_SUBFOLDER}/${folder}`;

    const existing = await _readAppFile({
      subfolder,
      filename: "memories.md",
    });

    const existingFacts = parseMemoriesContent(existing);
    const merged = [...new Set([...existingFacts, ...newFacts])];

    const content = formatMemoriesContent(merged);
    await _writeAppFile({ subfolder, filename: "memories.md", content });

    const stored = merged.length - existingFacts.length;
    logDebug("memories stored", { stored, total: merged.length });

    emitSubAgentEvent({ type: "complete", id: saId });
    return { memoriesStored: stored };
  } catch (error) {
    logWarn("extraction failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    emitSubAgentEvent({ type: "error", id: saId, error: "Memory extraction failed" });
    return { memoriesStored: 0 };
  }
}

function parseMemoriesContent(content: string | null): string[] {
  if (!content) return [];
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

function formatMemoriesContent(facts: string[]): string {
  const lines = ["# Memories", "", ...facts.map((f) => `- ${f}`), ""];
  return lines.join("\n");
}
