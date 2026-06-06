import { tool, zodSchema, type LanguageModel } from "ai";
import { z } from "zod";
import { isAbortError } from "@/lib/abort";
import { searchResearch, type EmbeddingConfig, type RerankerConfig } from "@/lib/research-search";
import { evaluateResearchRelevance } from "@/lib/research-relevance-evaluator";

const ResearchFolderMatchSchema = z.object({
  folder_name: z.string(),
});

export const searchResearchInputSchema = z.object({
  query: z
    .string()
    .describe("Natural language search query"),
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
      "Search your past research history for previously completed research sessions matching the query. This searches research folders you have already saved — it does NOT search the web. Use this to find and revisit earlier research on a topic before starting a new one.",
    strict: true,
    inputSchema: zodSchema(searchResearchInputSchema),
    outputSchema: zodSchema(z.array(ResearchFolderMatchSchema)),
    execute: async ({ query, folder, limit }, options) => {
      let results = await searchResearch(embeddingConfig, rerankerConfig, query, {
        folder,
        limit,
        abortSignal: options?.abortSignal,
      }).catch((err) => {
        if (isAbortError(err)) throw err;
        console.error("[search-research-tool] invoke failed:", err);
        return [];
      });

      if (results.length > 0) {
        results = await evaluateResearchRelevance(
          query,
          results,
          model,
          options?.abortSignal,
        ).catch((err) => {
          if (isAbortError(err)) throw err;
          console.error("[search-research-tool] relevance evaluation failed:", err);
          return results;
        });
      }

      const seen = new Set<string>();
      return results.flatMap((result) => {
        if (seen.has(result.folder_name)) return [];
        seen.add(result.folder_name);
        return [{ folder_name: result.folder_name }];
      });
    },
  });
}
