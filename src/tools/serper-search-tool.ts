import { tool, zodSchema } from "ai";
import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const API_BASE_URL = "https://google.serper.dev";

const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string(),
});

const SerperWebResponseSchema = z.object({
  organic: z.array(
    z.object({
      title: z.string(),
      link: z.string(),
      snippet: z.string(),
    }),
  ),
});

type SearchResult = z.infer<typeof SearchResultSchema>;

export const serperSearchInputSchema = z.object({
  query: z.string().min(1).describe("Search query"),
});

export const serperSearchOutputSchema = z.object({
  results: z.array(SearchResultSchema),
});

export function createSerperSearchTool(apiKey: string) {
  async function search(query: string): Promise<SearchResult[]> {
    return rateLimit(async () => {
      const response = await fetch(`${API_BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({ q: query }),
      });

      if (!response.ok) return [];

      const parsed = SerperWebResponseSchema.safeParse(await response.json());
      if (!parsed.success) return [];

      return parsed.data.organic.map((r) => ({
        title: r.title,
        url: r.link,
        description: r.snippet,
      }));
    });
  }

  return tool({
    description: "Search the web with Serper (Google Search API)",
    strict: true,
    inputSchema: zodSchema(serperSearchInputSchema),
    outputSchema: zodSchema(serperSearchOutputSchema),
    execute: async ({ query }) => {
      return { results: await search(query) };
    },
  });
}
