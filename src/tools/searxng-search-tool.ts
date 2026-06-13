import { invoke } from "@/lib/tauri-bridge";
import { z } from "zod";
import { abortablePromise } from "@/lib/abort";
import { createSearchTool } from "./create-search-tool";
import { validateServiceUrl } from "@/lib/url-validation";
import { searchQueryInputSchema } from "./search-result";

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

export function createSearXNGSearchTool(baseUrl: string = DEFAULT_BASE_URL) {
  validateServiceUrl(baseUrl);

  return createSearchTool({
    providerName: "SearXNG",
    description: "Search the web with SearXNG (self-hosted meta search engine)",
    responseSchema: SearXNGResponseSchema,
    throwOnParseError: true,
    mapResults: (r) =>
      r.results.map((r) => ({
        title: r.title,
        url: r.url,
        description: r.content,
      })),
    execute: async (query, abortSignal) => {
      const responseText = await abortablePromise(
        invoke<string | null>("fetch_searxng_json", {
          baseUrl,
          query,
        }),
        abortSignal,
      );
      if (responseText === null) {
        throw new Error("SearXNG search failed: no response from server. Check that SearXNG is running at " + baseUrl);
      }
      return responseText;
    },
  });
}
