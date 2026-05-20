import { tool, zodSchema } from "ai";
import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import Bottleneck from "bottleneck";

const DEFAULT_BASE_URL = "http://localhost:8080";
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

let baseUrl: string = DEFAULT_BASE_URL;

export function setSearXNGBaseUrl(url: string) {
  baseUrl = url;
}

export function getSearXNGBaseUrl(): string {
  return baseUrl;
}

async function search(query: string): Promise<SearchResult[]> {
  return limiter.schedule(async () => {
    const url = new URL("/search", baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");

    const response = await fetch(url.toString());

    if (!response.ok) {
      return [];
    }

    const parsed = SearXNGResponseSchema.safeParse(await response.json());
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

export const searxngSearchTool = tool({
  description: "Search the web with SearXNG (self-hosted meta search engine)",
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
