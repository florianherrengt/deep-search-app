import { fetch } from "@/lib/tauri-bridge";
import {
  createSearchExtractEngine,
  createAiSdkSearchTool,
  searchQueryInputSchema,
} from "deep-search-core/search-extract";

export const tavilySearchInputSchema = searchQueryInputSchema;

export function createTavilySearchTool(apiKey: string) {
  const engine = createSearchExtractEngine({
    fetch,
    searchProviders: {
      tavily: { apiKey },
    },
  });
  return createAiSdkSearchTool(engine, "tavily", "Search the web with Tavily Search");
}
