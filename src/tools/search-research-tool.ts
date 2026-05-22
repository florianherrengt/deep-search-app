import { tool, zodSchema } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";

export function createSearchResearchTool(apiKey: string) {
  return tool({
    description:
      "Search across all past research sessions for relevant information. Use this to find facts, sources, and notes from previous research.",
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
    execute: async ({ query, folder, limit }) => {
      return invoke("search_research", {
        apiKey,
        query,
        folder: folder ?? null,
        limit: limit ?? 8,
      });
    },
  });
}
