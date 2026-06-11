import { fetch } from "@/lib/tauri-bridge";
import { z } from "zod";
import { createSearchTool } from "./create-search-tool";
import { searchQueryInputSchema } from "./search-result";

const API_BASE_URL = "https://api.exa.ai";

const ExaWebResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      text: z.string(),
    }),
  ),
});

export const exaSearchInputSchema = searchQueryInputSchema;

export function createExaSearchTool(apiKey: string) {
  return createSearchTool({
    providerName: "Exa",
    description: "Search the web with Exa",
    responseSchema: ExaWebResponseSchema,
    mapResults: (r) =>
      r.results.map((r) => ({
        title: r.title,
        url: r.url,
        description: r.text,
      })),
    execute: async (query, abortSignal) => {
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
        signal: abortSignal,
      });

      if (!response.ok) return "";
      return await response.text();
    },
  });
}
