import { tool, zodSchema, type LanguageModel } from "ai";
import { z } from "zod";
import { listAppSubfolders } from "@/lib/app-file-storage";
import { SEARCH_RESULTS_SUBFOLDER } from "@/lib/research-history";
import { searchFoldersWithLLMSafe } from "@/lib/folder-search";

const ResearchFolderMatchSchema = z.object({
  folder_name: z.string(),
  relevant_memories: z.array(z.string()),
});

export const searchResearchInputSchema = z.object({
  query: z
    .union([z.string(), z.array(z.string())])
    .describe("Natural language search query, or multiple queries to search in parallel"),
  limit: z
    .number()
    .optional()
    .describe("Max results (default 8)"),
});

export function createSearchResearchTool(model: LanguageModel) {
  return tool({
    description:
      "Search your past research history for previously completed research sessions matching the query. This searches research folders you have already saved — it does NOT search the web. Returns relevant folders by asking an LLM to match the query against the list of saved research folder names.",
    strict: true,
    inputSchema: zodSchema(searchResearchInputSchema),
    outputSchema: zodSchema(z.array(ResearchFolderMatchSchema)),
    execute: async ({ query }, options) => {
      const folderNames = await listAppSubfolders({
        subfolder: SEARCH_RESULTS_SUBFOLDER,
      }).catch((err) => {
        console.error("[search-research-tool] failed to list folders:", err);
        return [];
      });

      if (folderNames.length === 0) return [];

      const retrievalQuery = Array.isArray(query) ? query.join(" ") : query;

      const matched = await searchFoldersWithLLMSafe(
        retrievalQuery,
        folderNames,
        model,
        options?.abortSignal,
      );

      return matched.map((folder_name) => ({
        folder_name,
        relevant_memories: [],
      }));
    },
  });
}
