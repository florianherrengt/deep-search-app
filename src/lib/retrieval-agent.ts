import { generateText, tool, zodSchema, stepCountIs, type LanguageModel } from "ai";
import { z } from "zod";
import { readAppFile, listAppFiles, SafePathSegmentSchema } from "@/lib/app-file-storage";
import { isRecord } from "@/lib/json";
import type { SearchResult } from "@/lib/research-search";
import { SEARCH_RESULTS_SUBFOLDER } from "@/lib/research-history";
import retrievalAgentPrompt from "./retrieval-agent-prompt.md?raw";
import { createSubAgentId } from "./sub-agent-types";
import { emitSubAgentEvent } from "./sub-agent-emitter";

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
        } catch {
          return [];
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
        } catch {
          return null;
        }
      },
    });

    const { text } = await generateText({
      model,
      system: retrievalAgentPrompt,
      prompt: userPrompt,
      tools: {
        list_files: scopedListFiles,
        read_file: scopedReadFile,
      },
      stopWhen: stepCountIs(5),
      abortSignal,
    });

    emitSubAgentEvent({ type: "text-delta", id: saId, delta: text });

    const result = parseRetrievalResult(text, candidateFolders);
    emitSubAgentEvent({ type: "complete", id: saId });
    return result;
  } catch {
    emitSubAgentEvent({ type: "error", id: saId, error: "Retrieval agent failed" });
    return { relevant_folders: [], relevant_memories: [] };
  }
}

function parseRetrievalResult(text: string, candidates: Set<string>): RetrievalResult {
  const empty: RetrievalResult = { relevant_folders: [], relevant_memories: [] };

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return empty;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!isRecord(parsed)) return empty;

    const folders: string[] = Array.isArray(parsed.relevant_folders)
      ? parsed.relevant_folders.filter((f: unknown) => typeof f === "string" && candidates.has(f as string))
      : [];

    const memories: string[] = Array.isArray(parsed.relevant_memories)
      ? parsed.relevant_memories.filter((m: unknown) => typeof m === "string")
      : [];

    return { relevant_folders: folders, relevant_memories: memories };
  } catch {
    return empty;
  }
}
