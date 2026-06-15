import { fetch } from "@/lib/tauri-bridge";
import {
  createSearchExtractEngine,
  createAiSdkSearchTool,
  searchQueryInputSchema,
} from "@deep-search/search-extract";

export const braveSearchInputSchema = searchQueryInputSchema;

export function createBraveSearchTool(apiKey: string) {
  const engine = createSearchExtractEngine({
    fetch,
    searchProviders: {
      brave: { apiKey },
    },
  });
  return createAiSdkSearchTool(engine, "brave", "Search the web with Brave Search");
}
