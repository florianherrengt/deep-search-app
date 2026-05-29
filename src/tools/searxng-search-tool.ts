import { tool, zodSchema } from "ai";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { validateServiceUrl } from "@/lib/url-validation";

const DEFAULT_BASE_URL = "http://localhost:8080";

const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string(),
});

const SearXNGResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
    }),
  ),
});

type SearchResult = z.infer<typeof SearchResultSchema>;

export const searxngSearchInputSchema = z.object({
  query: z.string().min(1).describe("Search query"),
});

export const searxngSearchOutputSchema = z.object({
  results: z.array(SearchResultSchema),
});

export function createSearXNGSearchTool(baseUrl: string = DEFAULT_BASE_URL) {
  validateServiceUrl(baseUrl);

  async function search(query: string): Promise<SearchResult[]> {
    return rateLimit(async () => {
      const responseText = await invoke<string | null>("fetch_searxng_json", {
        baseUrl,
        query,
      });

      if (!responseText) return [];

      let raw: unknown;
      try {
        raw = JSON.parse(responseText);
      } catch {
        return [];
      }

      const parsed = SearXNGResponseSchema.safeParse(raw);
      if (!parsed.success) return [];

      return parsed.data.results.map((r) => ({
        title: r.title,
        url: r.url,
        description: r.content,
      }));
    });
  }

  return tool({
    description: "Search the web with SearXNG (self-hosted meta search engine)",
    strict: true,
    inputSchema: zodSchema(searxngSearchInputSchema),
    outputSchema: zodSchema(searxngSearchOutputSchema),
    execute: async ({ query }) => {
      return { results: await search(query) };
    },
  });
}
