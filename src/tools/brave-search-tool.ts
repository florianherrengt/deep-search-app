import { tool, zodSchema } from "ai";
import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const API_BASE_URL = "https://api.search.brave.com/res/v1";

const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string(),
});

const BraveWebResponseSchema = z.object({
  web: z
    .object({
      results: z.array(SearchResultSchema).optional(),
    })
    .optional(),
});

type SearchResult = z.infer<typeof SearchResultSchema>;

export const braveSearchInputSchema = z.object({
  query: z.string().min(1).describe("Search query"),
});

export const braveSearchOutputSchema = z.object({
  results: z.array(SearchResultSchema),
});

export function createBraveSearchTool(apiKey: string) {
  async function search(query: string): Promise<SearchResult[]> {
    return rateLimit(async () => {
      const url = new URL(`${API_BASE_URL}/web/search`);
      url.searchParams.set("q", query);

      const response = await fetch(url.toString(), {
        headers: {
          accept: "application/json",
          "x-subscription-token": apiKey,
        },
      });

      if (!response.ok) return [];

      const parsed = BraveWebResponseSchema.safeParse(await response.json());
      if (!parsed.success) return [];

      return parsed.data.web?.results ?? [];
    });
  }

  return tool({
    description: "Search the web with Brave Search",
    strict: true,
    inputSchema: zodSchema(braveSearchInputSchema),
    outputSchema: zodSchema(braveSearchOutputSchema),
    execute: async ({ query }) => {
      return { results: await search(query) };
    },
  });
}
