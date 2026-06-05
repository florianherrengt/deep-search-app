import { tool, zodSchema } from "ai";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { abortablePromise } from "@/lib/abort";
import { tryParseJson } from "@/lib/json";
import { rateLimit } from "@/lib/rate-limit";
import { validateServiceUrl } from "@/lib/url-validation";
import {
  searchQueryInputSchema,
  formatSearchResults,
  type SearchResult,
} from "./search-result";

const DEFAULT_BASE_URL = "http://localhost:8080";

const SearXNGResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
    }),
  ),
});

export const searxngSearchInputSchema = searchQueryInputSchema;

export const searxngSearchOutputSchema = z.string();

export function createSearXNGSearchTool(baseUrl: string = DEFAULT_BASE_URL) {
  validateServiceUrl(baseUrl);

  async function search(
    query: string,
    abortSignal?: AbortSignal,
  ): Promise<SearchResult[]> {
    return rateLimit(async () => {
      const responseText = await abortablePromise(
        invoke<string | null>("fetch_searxng_json", {
          baseUrl,
          query,
        }),
        abortSignal,
      );

      if (!responseText) return [];

      const raw = tryParseJson(responseText);
      const parsed = SearXNGResponseSchema.safeParse(raw);
      if (!parsed.success) return [];

      return parsed.data.results.map((r) => ({
        title: r.title,
        url: r.url,
        description: r.content,
      }));
    }, abortSignal);
  }

  return tool({
    description: "Search the web with SearXNG (self-hosted meta search engine)",
    strict: true,
    inputSchema: zodSchema(searxngSearchInputSchema),
    execute: async ({ query }, options) => {
      return formatSearchResults(await search(query, options?.abortSignal));
    },
  });
}
