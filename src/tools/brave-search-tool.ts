import { fetch } from "@/lib/tauri-bridge";
import { z } from "zod";
import { createSearchTool } from "./create-search-tool";
import {
  searchQueryInputSchema,
  searchResultSchema,
} from "./search-result";

const API_BASE_URL = "https://api.search.brave.com/res/v1";

const BraveWebResponseSchema = z.object({
  web: z
    .object({
      results: z.array(searchResultSchema).optional(),
    })
    .optional(),
});

export const braveSearchInputSchema = searchQueryInputSchema;

export function createBraveSearchTool(apiKey: string) {
  return createSearchTool({
    providerName: "Brave",
    description: "Search the web with Brave Search",
    responseSchema: BraveWebResponseSchema,
    mapResults: (r) => r.web?.results ?? [],
    execute: async (query, abortSignal) => {
      const url = new URL(`${API_BASE_URL}/web/search`);
      url.searchParams.set("q", query);

      const response = await fetch(url.toString(), {
        headers: {
          accept: "application/json",
          "x-subscription-token": apiKey,
        },
        signal: abortSignal,
      });

      if (!response.ok) return "";
      return await response.text();
    },
  });
}
