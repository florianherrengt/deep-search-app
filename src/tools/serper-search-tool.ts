import { fetch } from "@/lib/tauri-bridge";
import { z } from "zod";
import { createSearchTool, formatSearchHttpError } from "./create-search-tool";
import { searchQueryInputSchema } from "./search-result";

const API_BASE_URL = "https://google.serper.dev";

const SerperWebResponseSchema = z.object({
  organic: z
    .array(
      z.object({
        title: z.string(),
        link: z.string(),
        snippet: z.string().optional(),
      }),
    )
    .optional(),
});

export const serperSearchInputSchema = searchQueryInputSchema;

export function createSerperSearchTool(apiKey: string) {
  const normalizedApiKey = apiKey.trim();

  return createSearchTool({
    providerName: "Serper",
    description: "Search the web with Serper (Google Search API)",
    responseSchema: SerperWebResponseSchema,
    throwOnParseError: true,
    mapResults: (r) =>
      (r.organic ?? []).map((r) => ({
        title: r.title,
        url: r.link,
        description: r.snippet ?? "",
      })),
    execute: async (query, abortSignal) => {
      const response = await fetch(`${API_BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": normalizedApiKey,
        },
        body: JSON.stringify({ q: query }),
        signal: abortSignal,
      });

      if (!response.ok) {
        throw new Error(await formatSearchHttpError("Serper", response));
      }

      return await response.text();
    },
  });
}
