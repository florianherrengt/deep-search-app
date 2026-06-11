import { fetch } from "@/lib/tauri-bridge";
import { z } from "zod";
import { createSearchTool, formatSearchHttpError } from "./create-search-tool";
import { searchQueryInputSchema } from "./search-result";

const API_BASE_URL = "https://api.tavily.com";

const TavilyWebResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
    }),
  ),
});

export const tavilySearchInputSchema = searchQueryInputSchema;

export function createTavilySearchTool(apiKey: string) {
  const normalizedApiKey = apiKey.trim();

  return createSearchTool({
    providerName: "Tavily",
    description: "Search the web with Tavily Search",
    responseSchema: TavilyWebResponseSchema,
    throwOnParseError: true,
    mapResults: (r) =>
      r.results.map((r) => ({
        title: r.title,
        url: r.url,
        description: r.content,
      })),
    execute: async (query, abortSignal) => {
      const response = await fetch(`${API_BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${normalizedApiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: 5,
        }),
        signal: abortSignal,
      });

      if (!response.ok) {
        throw new Error(await formatSearchHttpError("Tavily", response));
      }

      return await response.text();
    },
  });
}
