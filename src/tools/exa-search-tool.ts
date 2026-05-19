import { tool, zodSchema } from "ai";
import { z } from "zod";
import Bottleneck from "bottleneck";

const API_BASE_URL = "https://api.exa.ai";
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

let apiKey: string | null = null;

export function setExaApiKey(key: string) {
  apiKey = key;
}

export function getExaApiKey(): string | null {
  return apiKey;
}

async function search(query: string): Promise<SearchResult[]> {
  return limiter.schedule(async () => {
    const response = await fetch(`${API_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey ?? "",
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: 5,
        contents: { text: true },
      }),
    });

    if (!response.ok) {
      return [];
    }

    const parsed = ExaWebResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return [];
    }

    return parsed.data.results.map((r) => ({
      title: r.title,
      url: r.url,
      description: r.text,
    }));
  });
}

export const exaSearchTool = tool({
  description: "Search the web with Exa",
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
