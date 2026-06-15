import { fetch } from "@/lib/tauri-bridge";
import {
  createSearchExtractEngine,
  createAiSdkSearchTool,
  searchQueryInputSchema,
} from "@deep-search/search-extract";

export const serperSearchInputSchema = searchQueryInputSchema;

export function createSerperSearchTool(apiKey: string) {
  const engine = createSearchExtractEngine({
    fetch,
    searchProviders: {
      serper: { apiKey },
    },
  });
  return createAiSdkSearchTool(engine, "serper", "Search the web with Serper (Google Search API)");
}
