import { tool, zodSchema } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";

const ResearchFolderMatchSchema = z.object({
  folder_name: z.string(),
});

type RawResearchSearchResult = {
  folder_name: string;
};

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

export function createSearchResearchTool(apiKey: string) {
  return tool({
    description:
      "Search your past research history for previously completed research sessions matching the query. This searches research folders you have already saved — it does NOT search the web. Use this to find and revisit earlier research on a topic before starting a new one.",
    strict: true,
    inputSchema: zodSchema(searchResearchInputSchema),
    outputSchema: zodSchema(z.array(ResearchFolderMatchSchema)),
    execute: async ({ query, folder, limit }) => {
      let results: RawResearchSearchResult[];
      try {
        results = await invoke<RawResearchSearchResult[]>(
          "search_research",
          {
            apiKey,
            queries: [query],
            folder: folder ?? null,
            limit: limit ?? 8,
          },
        );
      } catch (err) {
        console.error("[search-research-tool] invoke failed:", err);
        return [];
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
