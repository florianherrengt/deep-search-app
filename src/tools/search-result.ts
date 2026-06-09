import { z } from "zod";

export const searchQueryInputSchema = z.object({
  query: z.string().min(1).describe("Search query"),
});

export const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string(),
  snippet: z.string().optional(),
});

export type SearchResult = z.infer<typeof searchResultSchema>;

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results
    .map((r) => `${r.title}: ${r.url}\n${r.description}`)
    .join("\n-\n");
}
