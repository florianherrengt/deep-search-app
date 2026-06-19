import { fetch } from "@/lib/tauri-bridge";
import {
  createSearchExtractEngine,
  createAiSdkSearchTool,
  searchQueryInputSchema,
} from "deep-search-core/search-extract";

export const exaSearchInputSchema = searchQueryInputSchema;

export function createExaSearchTool(apiKey: string) {
  const engine = createSearchExtractEngine({
    fetch,
    searchProviders: {
      exa: { apiKey },
    },
  });
  return createAiSdkSearchTool(engine, "exa", "Search the web with Exa");
}
