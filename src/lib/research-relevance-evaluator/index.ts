import { generateText, tool, zodSchema, stepCountIs, type LanguageModel } from "ai";
import { z } from "zod";
import { readAppFile, listAppFiles, SafePathSegmentSchema } from "@/lib/app-file-storage";
import type { SearchResult } from "@/lib/research-search";
import { SEARCH_RESULTS_SUBFOLDER } from "@/lib/research-history";
import evaluatorPrompt from "./prompt.md?raw";

const SNIPPET_MAX_LENGTH = 300;
const MAX_SNIPPETS_PER_FOLDER = 3;

function subfolderFor(folder: string) {
  return `${SEARCH_RESULTS_SUBFOLDER}/${folder}`;
}

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
          `  [score: ${c.score.toFixed(3)}${c.header_path ? `, section: ${c.header_path}` : ""}]\n  "${c.content.slice(0, SNIPPET_MAX_LENGTH)}${c.content.length > SNIPPET_MAX_LENGTH ? "..." : ""}"`,
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

  return `User query: "${query}"\n\nCandidate folders:\n\n${folderEntries}`;
}

function createEvaluatorTools(candidateFolders: Set<string>) {
  return {
    list_files: tool({
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
          return await listAppFiles({ subfolder: subfolderFor(folder) });
        } catch {
          return [];
        }
      },
    }),
    read_file: tool({
      description:
        "Read a file from a research folder. Returns the file content, or null if the file does not exist.",
      inputSchema: zodSchema(z.object({
        folder: z.string().describe("The folder name."),
        filename: SafePathSegmentSchema.describe("The filename to read."),
      })),
      execute: async ({ folder, filename }: { folder: string; filename: string }) => {
        if (!candidateFolders.has(folder)) {
          return `Error: folder "${folder}" is not in the candidate list.`;
        }
        try {
          const content = await readAppFile({
            subfolder: subfolderFor(folder),
            filename,
          });
          return content ?? null;
        } catch {
          return null;
        }
      },
    }),
  };
}

function parseRelevantFolders(output: string, candidates: Set<string>): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && candidates.has(line));
}

export async function evaluateResearchRelevance(
  query: string,
  results: SearchResult[],
  model: LanguageModel,
  abortSignal?: AbortSignal,
): Promise<SearchResult[]> {
  if (results.length === 0) return results;

  const contexts = buildFolderContexts(results);
  const candidateFolders = new Set(contexts.keys());
  const userPrompt = buildUserPrompt(query, contexts);

  const { text } = await generateText({
    model,
    system: evaluatorPrompt,
    prompt: userPrompt,
    tools: createEvaluatorTools(candidateFolders),
    stopWhen: stepCountIs(5),
    abortSignal,
  });

  const relevantFolders = new Set(parseRelevantFolders(text, candidateFolders));

  if (relevantFolders.size === 0) return [];
  if (relevantFolders.size === candidateFolders.size) return results;

  return results.filter((r) => relevantFolders.has(r.folder_name));
}
