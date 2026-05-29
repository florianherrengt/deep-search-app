import { tool, zodSchema } from "ai";
import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const API_BASE_URL = "https://api.exa.ai";

const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string(),
});

const ExaWebResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      text: z.string(),
    }),
  ),
});

type SearchResult = z.infer<typeof SearchResultSchema>;

export const exaSearchInputSchema = z.object({
  query: z.string().min(1).describe("Search query"),
});

export const exaSearchOutputSchema = z.object({
  results: z.array(SearchResultSchema),
});

export function createExaSearchTool(apiKey: string) {
  async function search(query: string): Promise<SearchResult[]> {
    return rateLimit(async () => {
      const response = await fetch(`${API_BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          query,
          type: "auto",
          numResults: 5,
          contents: { text: true },
        }),
      });

      if (!response.ok) return [];

      const parsed = ExaWebResponseSchema.safeParse(await response.json());
      if (!parsed.success) return [];

      return parsed.data.results.map((r) => ({
        title: r.title,
        url: r.url,
        description: r.text,
      }));
    });
  }

  return tool({
    description: "Search the web with Exa",
    strict: true,
    inputSchema: zodSchema(exaSearchInputSchema),
    outputSchema: zodSchema(exaSearchOutputSchema),
    execute: async ({ query }) => {
      return { results: await search(query) };
    },
  });
}
