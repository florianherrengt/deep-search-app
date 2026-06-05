import { tool, zodSchema } from "ai";
import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import {
  searchQueryInputSchema,
  searchResultSchema,
  formatSearchResults,
  type SearchResult,
} from "./search-result";

const API_BASE_URL = "https://api.search.brave.com/res/v1";

const BraveWebResponseSchema = z.object({
  web: z
    .object({
      results: z.array(searchResultSchema).optional(),
    })
    .optional(),
});

export const braveSearchInputSchema = searchQueryInputSchema;

export const braveSearchOutputSchema = z.string();

export function createBraveSearchTool(apiKey: string) {
  async function search(
    query: string,
    abortSignal?: AbortSignal,
  ): Promise<SearchResult[]> {
    return rateLimit(async () => {
      const url = new URL(`${API_BASE_URL}/web/search`);
      url.searchParams.set("q", query);

      const response = await fetch(url.toString(), {
        headers: {
          accept: "application/json",
          "x-subscription-token": apiKey,
        },
        signal: abortSignal,
      });

      if (!response.ok) return [];

      const parsed = BraveWebResponseSchema.safeParse(await response.json());
      if (!parsed.success) return [];

      return parsed.data.web?.results ?? [];
    }, abortSignal);
  }

  return tool({
    description: "Search the web with Brave Search",
    strict: true,
    inputSchema: zodSchema(braveSearchInputSchema),
    execute: async ({ query }, options) => {
      return formatSearchResults(await search(query, options?.abortSignal));
    },
  });
}
