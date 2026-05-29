import { tool, zodSchema } from "ai";
import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const API_BASE_URL = "https://api.tavily.com";

const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string(),
});

const TavilyWebResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
    }),
  ),
});

type SearchResult = z.infer<typeof SearchResultSchema>;

export const tavilySearchInputSchema = z.object({
  query: z.string().min(1).describe("Search query"),
});

export const tavilySearchOutputSchema = z.object({
  results: z.array(SearchResultSchema),
});

export function createTavilySearchTool(apiKey: string) {
  const normalizedApiKey = apiKey.trim();

  async function search(query: string): Promise<SearchResult[]> {
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
    });
  }

  return tool({
    description: "Search the web with Tavily Search",
    strict: true,
    inputSchema: zodSchema(tavilySearchInputSchema),
    outputSchema: zodSchema(tavilySearchOutputSchema),
    execute: async ({ query }) => {
      return { results: await search(query) };
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
