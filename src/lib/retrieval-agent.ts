import {
  streamText,
  tool,
  zodSchema,
  stepCountIs,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import { readAppFile, listAppFiles, SafePathSegmentSchema } from "@/lib/app-file-storage";
import { isAbortError } from "@/lib/abort";
import { isRecord } from "@/lib/json";
import type { SearchResult } from "@/lib/research-search";
import { SEARCH_RESULTS_SUBFOLDER } from "@/lib/research-history";
import retrievalAgentPrompt from "./retrieval-agent-prompt.md?raw";
import { createSubAgentId } from "./sub-agent-types";
import { emitSubAgentEvent } from "./sub-agent-emitter";

const LOG_PREFIX = "[retrieval-agent]";

function logDebug(message: string, ...args: unknown[]) {
  console.debug(`${LOG_PREFIX} ${message}`, ...args);
}

function logWarn(message: string, ...args: unknown[]) {
  console.warn(`${LOG_PREFIX} ${message}`, ...args);
}

export interface RetrievalResult {
  relevant_folders: string[];
  relevant_memories: string[];
}

interface RunRetrievalAgentDeps {
  readAppFile: typeof readAppFile;
  listAppFiles: typeof listAppFiles;
}

const SNIPPET_MAX_LENGTH = 300;
const MAX_SNIPPETS_PER_FOLDER = 3;

function buildFolderContexts(results: SearchResult[]): Map<string, string[]> {
  const grouped = new Map<string, SearchResult[]>();
  for (const r of results) {
    const existing = grouped.get(r.folder_name) ?? [];
    existing.push(r);
    grouped.set(r.folder_name, existing);
  }

  const contexts = new Map<string, string[]>();
  for (const [folder, chunks] of grouped) {
    const snippets = chunks
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SNIPPETS_PER_FOLDER)
      .map(
        (c) =>
          `  [score: ${c.score.toFixed(3)}, file: ${c.filename}${c.header_path ? `, section: ${c.header_path}` : ""}]\n  "${c.content.slice(0, SNIPPET_MAX_LENGTH)}${c.content.length > SNIPPET_MAX_LENGTH ? "..." : ""}"`,
      );
    contexts.set(folder, snippets);
  }
  return contexts;
}

function buildUserPrompt(query: string, contexts: Map<string, string[]>): string {
  const folderEntries = [...contexts.entries()]
    .map(
      ([folder, snippets]) =>
        `Folder: "${folder}"\nSnippets:\n${snippets.join("\n")}`,
    )
    .join("\n\n");

  return `User query: "${query}"\n\nCandidate results:\n\n${folderEntries}`;
}

export async function runRetrievalAgent(
  query: string,
  results: SearchResult[],
  model: LanguageModel,
  abortSignal?: AbortSignal,
  deps?: RunRetrievalAgentDeps,
): Promise<RetrievalResult> {
  if (results.length === 0) {
    return { relevant_folders: [], relevant_memories: [] };
  }

  const _readAppFile = deps?.readAppFile ?? readAppFile;
  const _listAppFiles = deps?.listAppFiles ?? listAppFiles;
  const saId = createSubAgentId();

  emitSubAgentEvent({
    type: "start",
    id: saId,
    source: "sub-agent",
    name: "Research Recall",
    toolName: "retrieval_agent",
    parentMessageId: "transport",
  });

  try {
    const contexts = buildFolderContexts(results);
    const candidateFolders = new Set(contexts.keys());
    const userPrompt = buildUserPrompt(query, contexts);

    const scopedListFiles = tool({
      description:
        "List files in a research folder. Returns filenames only.",
      inputSchema: zodSchema(z.object({
        folder: z.string().describe("The folder name to list files in."),
      })),
      execute: async ({ folder }: { folder: string }) => {
        if (!candidateFolders.has(folder)) {
          return `Error: folder "${folder}" is not in the candidate list.`;
        }
        try {
          return await _listAppFiles({
            subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${folder}`,
          });
        } catch (error) {
          logWarn("list_files failed for folder", {
            folder,
            error: error instanceof Error ? error.message : "unknown",
          });
          return `Error: could not list files in folder "${folder}".`;
        }
      },
    });

    const scopedReadFile = tool({
      description:
        "Read a file from a research folder. Returns the file content.",
      inputSchema: zodSchema(z.object({
        folder: z.string().describe("The folder name."),
        filename: SafePathSegmentSchema.describe("The filename to read."),
      })),
      execute: async ({ folder, filename }: { folder: string; filename: string }) => {
        if (!candidateFolders.has(folder)) {
          return `Error: folder "${folder}" is not in the candidate list.`;
        }
        try {
          const content = await _readAppFile({
            subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${folder}`,
            filename,
          });
          return content ?? null;
        } catch (error) {
          logWarn("read_file failed", {
            folder,
            filename,
            error: error instanceof Error ? error.message : "unknown",
          });
          return `Error: could not read file "${filename}" in folder "${folder}".`;
        }
      },
    });

    const scopedTools = {
      list_files: scopedListFiles,
      read_file: scopedReadFile,
    };

    const toolCallIndices = new Map<string, number>();
    let nextToolCallIndex = 0;

    const result = streamText({
      model,
      system: retrievalAgentPrompt,
      prompt: userPrompt,
      tools: scopedTools,
      stopWhen: stepCountIs(5),
      abortSignal,
      onChunk({ chunk }) {
        if (chunk.type === "text-delta") {
          emitSubAgentEvent({ type: "text-delta", id: saId, delta: chunk.text });
        } else if (chunk.type === "tool-call") {
          const toolCallIndex = nextToolCallIndex++;
          toolCallIndices.set(chunk.toolCallId, toolCallIndex);
          emitSubAgentEvent({
            type: "tool-call",
            id: saId,
            toolCall: {
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              args: chunk.input,
              status: "running",
            },
          });
        } else if (chunk.type === "tool-result") {
          const toolCallIndex = toolCallIndices.get(chunk.toolCallId) ?? nextToolCallIndex++;
          emitSubAgentEvent({
            type: "tool-result",
            id: saId,
            toolCallId: chunk.toolCallId,
            toolCallIndex,
            result: chunk.output,
            status: "complete",
          });
        }
      },
    });

    const text = await result.text;

    logDebug("stream completed", {
      textLength: text.length,
      toolCallCount: nextToolCallIndex,
    });

    const parsed = parseRetrievalResult(text, candidateFolders);
    emitSubAgentEvent({ type: "complete", id: saId });
    return parsed;
  } catch (error) {
    if (isAbortError(error) || abortSignal?.aborted) {
      logDebug("retrieval agent cancelled by user");
      emitSubAgentEvent({ type: "cancelled", id: saId });
      return { relevant_folders: [], relevant_memories: [] };
    }
    logWarn("retrieval agent failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    emitSubAgentEvent({ type: "error", id: saId, error: "Retrieval agent failed" });
    return { relevant_folders: [], relevant_memories: [] };
  }
}

function extractFirstJsonObject(text: string): string | null {
  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) return text.slice(firstBrace, i + 1);
    }
  }
  return null;
}

function parseRetrievalResult(text: string, candidates: Set<string>): RetrievalResult {
  const empty: RetrievalResult = { relevant_folders: [], relevant_memories: [] };

  try {
    const jsonStr = extractFirstJsonObject(text);
    if (!jsonStr) {
      logWarn("no JSON object found in retrieval agent output", { textLength: text.length });
      return empty;
    }

    const parsed = JSON.parse(jsonStr);
    if (!isRecord(parsed)) {
      logWarn("retrieval agent output is not a JSON object", { type: typeof parsed });
      return empty;
    }

    if (!Array.isArray(parsed.relevant_folders) || !Array.isArray(parsed.relevant_memories)) {
      logWarn("retrieval agent output has missing or wrong-type keys", {
        keys: Object.keys(parsed),
        foldersType: typeof parsed.relevant_folders,
        memoriesType: typeof parsed.relevant_memories,
      });
    }

    const folders: string[] = Array.isArray(parsed.relevant_folders)
      ? parsed.relevant_folders.filter((f: unknown) => typeof f === "string" && candidates.has(f as string))
      : [];

    const memories: string[] = Array.isArray(parsed.relevant_memories)
      ? parsed.relevant_memories.filter((m: unknown) => typeof m === "string")
      : [];

    if (folders.length === 0 && memories.length === 0 && Object.keys(parsed).length > 0) {
      logWarn("retrieval agent returned JSON but produced no usable results", {
        keys: Object.keys(parsed),
        folderCount: Array.isArray(parsed.relevant_folders) ? parsed.relevant_folders.length : "not-array",
        memoryCount: Array.isArray(parsed.relevant_memories) ? parsed.relevant_memories.length : "not-array",
      });
    }

    return { relevant_folders: folders, relevant_memories: memories };
  } catch (err) {
    logWarn("failed to parse retrieval agent JSON", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return empty;
  }
}
