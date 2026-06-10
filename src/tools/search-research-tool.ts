import { tool, zodSchema, type LanguageModel } from "ai";
import { z } from "zod";
import { isAbortError } from "@/lib/abort";
import { searchResearch, type EmbeddingConfig, type RerankerConfig } from "@/lib/research-search";
import { runRetrievalAgent } from "@/lib/retrieval-agent";

const ResearchFolderMatchSchema = z.object({
  folder_name: z.string(),
  relevant_memories: z.array(z.string()),
});

export const searchResearchInputSchema = z.object({
  query: z
    .union([z.string(), z.array(z.string())])
    .describe("Natural language search query, or multiple queries to search in parallel"),
  folder: z
    .string()
    .optional()
    .describe("Limit to a specific research folder"),
  limit: z
    .number()
    .optional()
    .describe("Max results (default 8)"),
});

export function createSearchResearchTool(
  embeddingConfig: EmbeddingConfig,
  rerankerConfig: RerankerConfig,
  model: LanguageModel,
) {
  return tool({
    description:
      "Search your past research history for previously completed research sessions matching the query. This searches research folders you have already saved — it does NOT search the web. Returns relevant folders and any relevant stored user facts (relevant_memories) from those folders' memories.md files.",
    strict: true,
    inputSchema: zodSchema(searchResearchInputSchema),
    outputSchema: zodSchema(z.array(ResearchFolderMatchSchema)),
    execute: async ({ query, folder, limit }, options) => {
      const results = await searchResearch(embeddingConfig, rerankerConfig, query, {
        folder,
        limit,
        abortSignal: options?.abortSignal,
      }).catch((err) => {
        if (isAbortError(err)) throw err;
        console.error("[search-research-tool] invoke failed:", err);
        return [];
      });

      if (results.length === 0) return [];

      const retrievalQuery = Array.isArray(query) ? query.join(" ") : query;
      const retrievalResult = await runRetrievalAgent(
        retrievalQuery,
        results,
        model,
        options?.abortSignal,
      ).catch((err) => {
        if (isAbortError(err)) throw err;
        console.error("[search-research-tool] retrieval agent failed:", err);
        return { relevant_folders: [], relevant_memories: [] };
      });

      if (retrievalResult.relevant_folders.length === 0) {
        if (retrievalResult.relevant_memories.length === 0) return [];
        return [{ folder_name: "", relevant_memories: retrievalResult.relevant_memories }];
      }

      return retrievalResult.relevant_folders.map((folderName) => ({
        folder_name: folderName,
        relevant_memories: retrievalResult.relevant_memories,
      }));
    },
  });
}
