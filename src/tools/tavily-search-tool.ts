import { tool, zodSchema } from "ai";
import { z } from "zod";
import Bottleneck from "bottleneck";

const API_BASE_URL = "https://api.tavily.com";
const DEFAULT_REQUESTS_PER_SECOND = 1;

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000 / DEFAULT_REQUESTS_PER_SECOND,
});

const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string(),
});

const TavilyWebResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
    }),
  ),
});

type SearchResult = z.infer<typeof SearchResultSchema>;

let apiKey: string | null = null;

export function setTavilyApiKey(key: string) {
  apiKey = key;
}

export function getTavilyApiKey(): string | null {
  return apiKey;
}

async function search(query: string): Promise<SearchResult[]> {
  if (!apiKey) {
    throw new Error("Tavily Search API key not set");
  }

  return limiter.schedule(async () => {
    const response = await fetch(`${API_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: 5,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const parsed = TavilyWebResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return [];
    }

    return parsed.data.results.map((r) => ({
      title: r.title,
      url: r.url,
      description: r.content,
    }));
  });
}

export const tavilySearchTool = tool({
  description: "Search the web with Tavily Search",
  strict: true,
  inputSchema: zodSchema(
    z.object({
      query: z.string().min(1).describe("Search query"),
    }),
  ),
  outputSchema: zodSchema(
    z.object({
      results: z.array(SearchResultSchema),
    }),
  ),
  execute: async ({ query }) => {
    return { results: await search(query) };
  },
});
