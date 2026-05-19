import { tool, zodSchema } from "ai";
import { z } from "zod";
import Bottleneck from "bottleneck";

const API_BASE_URL = "https://api.search.brave.com/res/v1";
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

const BraveWebResponseSchema = z.object({
  web: z
    .object({
      results: z.array(SearchResultSchema).optional(),
    })
    .optional(),
});

type SearchResult = z.infer<typeof SearchResultSchema>;

let apiKey: string | null = null;

export function setBraveApiKey(key: string) {
  apiKey = key;
}

export function getBraveApiKey(): string | null {
  return apiKey;
}

async function search(query: string): Promise<SearchResult[]> {
  if (!apiKey) {
    throw new Error("Brave Search API key not set");
  }

  return limiter.schedule(async () => {
    const url = new URL(`${API_BASE_URL}/web/search`);
    url.searchParams.set("q", query);

    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "x-subscription-token": apiKey!,
      },
    });

    if (!response.ok) {
      return [];
    }

    const parsed = BraveWebResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return [];
    }

    return parsed.data.web?.results ?? [];
  });
}

export const braveSearchTool = tool({
  description: "Search the web with Brave Search",
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
