import { tool, zodSchema } from "ai";
import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import {
  searchQueryInputSchema,
  formatSearchResults,
  type SearchResult,
} from "./search-result";

const API_BASE_URL = "https://api.tavily.com";

const TavilyWebResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
    }),
  ),
});

export const tavilySearchInputSchema = searchQueryInputSchema;

export const tavilySearchOutputSchema = z.string();

export function createTavilySearchTool(apiKey: string) {
  const normalizedApiKey = apiKey.trim();

  async function search(
    query: string,
    abortSignal?: AbortSignal,
  ): Promise<SearchResult[]> {
    return rateLimit(async () => {
      const response = await fetch(`${API_BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${normalizedApiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: 5,
        }),
        signal: abortSignal,
      });

      if (!response.ok) {
        throw new Error(await formatTavilyHttpError(response));
      }

      const raw = await parseJsonResponse(response);
      const parsed = TavilyWebResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          "Tavily search response did not match the expected format.",
        );
      }

      return parsed.data.results.map((r) => ({
        title: r.title,
        url: r.url,
        description: r.content,
      }));
    }, abortSignal);
  }

  return tool({
    description: "Search the web with Tavily Search",
    strict: true,
    inputSchema: zodSchema(tavilySearchInputSchema),
    execute: async ({ query }, options) => {
      return formatSearchResults(await search(query, options?.abortSignal));
    },
  });
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Tavily search response was not valid JSON.");
  }
}

async function formatTavilyHttpError(response: Response): Promise<string> {
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  const body = await readResponseText(response);
  return `Tavily search failed with HTTP ${response.status}${statusText}${body ? `: ${body}` : ""}`;
}

async function readResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return truncateForError(text.trim());
  } catch {
    return "";
  }
}

function truncateForError(text: string): string {
  const maxLength = 300;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}
