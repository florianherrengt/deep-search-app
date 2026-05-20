import { tool, zodSchema } from "ai";
import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import Bottleneck from "bottleneck";

const API_BASE_URL = "https://google.serper.dev";
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

let apiKey: string | null = null;

export function setSerperApiKey(key: string) {
  apiKey = key;
}

export function getSerperApiKey(): string | null {
  return apiKey;
}

async function search(query: string): Promise<SearchResult[]> {
  return limiter.schedule(async () => {
    const response = await fetch(`${API_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey ?? "",
      },
      body: JSON.stringify({ q: query }),
    });

    if (!response.ok) {
      return [];
    }

    const parsed = SerperWebResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return [];
    }

    return parsed.data.organic.map((r) => ({
      title: r.title,
      url: r.link,
      description: r.snippet,
    }));
  });
}

export const serperSearchTool = tool({
  description: "Search the web with Serper (Google Search API)",
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
