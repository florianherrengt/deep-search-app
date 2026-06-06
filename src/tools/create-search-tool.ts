import { tool, zodSchema, type Tool } from "ai";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { tryParseJson } from "@/lib/json";
import {
  searchQueryInputSchema,
  formatSearchResults,
  type SearchResult,
} from "./search-result";

export interface CreateSearchToolOptions<TResponse> {
  /** Human-readable provider name used in error messages (e.g. "Tavily"). */
  providerName: string;
  /** Description for the AI tool. */
  description: string;
  /** Schema to validate the response. Can be the full envelope or the array. */
  responseSchema: z.ZodType<TResponse>;
  /** Map a parsed response to SearchResult[]. */
  mapResults: (response: TResponse) => SearchResult[];
  /**
   * Execute the HTTP request. Return the response body as a string.
   * Return "" if the response should be treated as no results.
   * Throw if the error is fatal and should propagate.
   */
  execute: (query: string, abortSignal?: AbortSignal) => Promise<string>;
  /**
   * If true (default false), throw on response parse failure.
   * If false, return [] on parse failure (matches Brave/Exa/SearXNG behavior).
   */
  throwOnParseError?: boolean;
}

export function createSearchTool<TResponse>(
  options: CreateSearchToolOptions<TResponse>,
): Tool<{ query: string }, string> {
  return tool({
    description: options.description,
    strict: true,
    inputSchema: zodSchema(searchQueryInputSchema),
    execute: async ({ query }, ctx) => {
      return formatSearchResults(
        await rateLimit(async () => {
          const raw = await options.execute(query, ctx?.abortSignal);
          const parsed = tryParseJson(raw);
          const result = options.responseSchema.safeParse(parsed);
          if (!result.success) {
            if (options.throwOnParseError) {
              throw new Error(
                `${options.providerName} search response did not match the expected format.`,
              );
            }
            return [];
          }
          return options.mapResults(result.data);
        }, ctx?.abortSignal),
      );
    },
  });
}
