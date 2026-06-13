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

export async function extractAndStoreMemories(
  userMessage: string,
  getResearchFolder: () => Promise<string>,
  model: LanguageModel,
  abortSignal?: AbortSignal,
  deps?: ExtractAndStoreMemoriesDeps,
): Promise<{ memoriesStored: number }> {
  const _readAppFile = deps?.readAppFile ?? readAppFile;
  const _writeAppFile = deps?.writeAppFile ?? writeAppFile;
  const _emitEvent = deps?.emitEvent ?? emitSubAgentEvent;
  const saId = createSubAgentId();

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
    const result = streamText({
      model,
      system: memoryAgentPrompt,
      prompt: userMessage,
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

    let newFacts: string[];
    try {
      const parsed = JSON.parse(stripMarkdownJsonFence(text));
      if (!Array.isArray(parsed)) {
        logWarn("LLM returned non-array", { type: typeof parsed });
        _emitEvent({ type: "complete", id: saId });
        return { memoriesStored: 0 };
      }
      newFacts = parsed
        .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
        .map((f) => f.replace(/\n/g, " ").trim())
        .filter((f) => f.length > 0);
    } catch (parseError) {
      logWarn("LLM output is not valid JSON", {
        error: parseError instanceof Error ? parseError.message : "unknown",
        rawPreview: text.slice(0, 100),
      });
      _emitEvent({ type: "complete", id: saId });
      return { memoriesStored: 0 };
    }

    if (newFacts.length === 0) {
      logDebug("no facts extracted");
      _emitEvent({ type: "complete", id: saId });
      return { memoriesStored: 0 };
    }

    logDebug("parsed facts", { factCount: newFacts.length, facts: newFacts });

    const folder = await getResearchFolder();
    const subfolder = `${SEARCH_RESULTS_SUBFOLDER}/${folder}`;

    const stored = await serializedWrite(subfolder, async () => {
      const existing = await _readAppFile({
        subfolder,
        filename: "memories.md",
      });

      const existingFacts = parseMemoriesContent(existing);
      const merged = [...new Set([...existingFacts, ...newFacts])];

      const content = formatMemoriesContent(merged);
      await _writeAppFile({ subfolder, filename: "memories.md", content });

      const stored = newFacts.filter((f) => !existingFacts.includes(f)).length;
      logDebug("memories stored", { stored, total: merged.length });
      return stored;
    });

    _emitEvent({ type: "complete", id: saId });
    return { memoriesStored: stored };
  } catch (error) {
    if (isAbortError(error) || abortSignal?.aborted) {
      logDebug("extraction cancelled by user");
      _emitEvent({ type: "cancelled", id: saId });
      return { memoriesStored: 0 };
    }
    logWarn("extraction failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    _emitEvent({ type: "error", id: saId, error: "Memory extraction failed" });
    return { memoriesStored: 0 };
  }
}

function parseMemoriesContent(content: string | null): string[] {
  if (!content) return [];
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*+]\s/.test(line))
    .map((line) => line.replace(/^[-*+]\s+/, "").trim())
    .filter((line) => line.length > 0);
}

function formatMemoriesContent(facts: string[]): string {
  const lines = ["# Memories", "", ...facts.map((f) => `- ${f}`), ""];
  return lines.join("\n");
}
