import { fetch } from "@/lib/tauri-bridge";
import { validateServiceUrl } from "@/lib/url-validation";
import {
  createSearchExtractEngine,
  createAiSdkSearchTool,
  searchQueryInputSchema,
} from "deep-search-core/search-extract";

const DEFAULT_BASE_URL = "http://localhost:8080";

export const searxngSearchInputSchema = searchQueryInputSchema;

export function createSearXNGSearchTool(baseUrl: string = DEFAULT_BASE_URL) {
  validateServiceUrl(baseUrl);

  const engine = createSearchExtractEngine({
    fetch,
    searchProviders: {
      searxng: { baseUrl },
    },
  });
  return createAiSdkSearchTool(engine, "searxng", "Search the web with SearXNG (self-hosted meta search engine)");
}
