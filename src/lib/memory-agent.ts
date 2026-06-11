import { generateText, type LanguageModel } from "ai";
import {
  readAppFile,
  writeAppFile,
} from "@/lib/app-file-storage";
import { SEARCH_RESULTS_SUBFOLDER } from "@/lib/research-history";
import memoryAgentPrompt from "./memory-agent-prompt.md?raw";
import { createSubAgentId } from "./sub-agent-types";
import { emitSubAgentEvent } from "./sub-agent-emitter";

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

  emitSubAgentEvent({
    type: "start",
    id: saId,
    name: "Memory Extraction",
    toolName: "memory_agent",
    parentMessageId: "transport",
  });

  try {
    const { text } = await generateText({
      model,
      system: memoryAgentPrompt,
      prompt: userMessage,
      abortSignal,
    });

    emitSubAgentEvent({ type: "text-delta", id: saId, delta: text });

    let newFacts: string[];
    try {
      const parsed = JSON.parse(text.trim());
      if (!Array.isArray(parsed)) return { memoriesStored: 0 };
      newFacts = parsed.filter(
        (f): f is string => typeof f === "string" && f.trim().length > 0,
      );
    } catch {
      return { memoriesStored: 0 };
    }

    if (newFacts.length === 0) return { memoriesStored: 0 };

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

    emitSubAgentEvent({ type: "complete", id: saId });
    return { memoriesStored: merged.length - existingFacts.length };
  } catch {
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
