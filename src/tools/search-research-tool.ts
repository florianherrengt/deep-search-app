import { tool, zodSchema } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";

const ResearchFolderMatchSchema = z.object({
  folder_name: z.string(),
});

type RawResearchSearchResult = {
  folder_name: string;
};

export function createSearchResearchTool(apiKey: string) {
  return tool({
    description:
      "Search across all past research sessions for matching research folders. Returns only folder names, not saved research content.",
    inputSchema: zodSchema(
      z.object({
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
      }),
    ),
    outputSchema: zodSchema(z.array(ResearchFolderMatchSchema)),
    execute: async ({ query, folder, limit }) => {
      const results = await invoke<RawResearchSearchResult[]>(
        "search_research",
        {
          apiKey,
          query,
          folder: folder ?? null,
          limit: limit ?? 8,
        },
      ).catch(() => []);

      const seen = new Set<string>();
      return results.flatMap((result) => {
        if (seen.has(result.folder_name)) return [];
        seen.add(result.folder_name);
        return [{ folder_name: result.folder_name }];
      });
    },
  });
}
