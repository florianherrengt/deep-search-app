import {
  createAggregateSearchTool as createCoreAggregateSearchTool,
  hasAggregatableSearchProviders,
  type CreateAggregateSearchToolOptions,
  type SearchKeys,
} from "deep-search-core/research-orchestrator";
import { z } from "zod";
import { fetch } from "@/lib/tauri-bridge";

export const aggregateSearchInputSchema = z.object({
  query: z.string().min(1).describe("Search query"),
});

export interface AggregateSearchToolKeys {
  braveApiKey?: string | null;
  exaApiKey?: string | null;
  serperApiKey?: string | null;
  tavilyApiKey?: string | null;
  searxngBaseUrl?: string | null;
}

export function createAggregateSearchTool(
  searchKeys: AggregateSearchToolKeys | undefined,
  options: CreateAggregateSearchToolOptions = {},
) {
  const keys: SearchKeys = {
    braveApiKey: searchKeys?.braveApiKey ?? undefined,
    exaApiKey: searchKeys?.exaApiKey ?? undefined,
    serperApiKey: searchKeys?.serperApiKey ?? undefined,
    tavilyApiKey: searchKeys?.tavilyApiKey ?? undefined,
    searxngBaseUrl: searchKeys?.searxngBaseUrl ?? undefined,
  };

  if (!hasAggregatableSearchProviders(keys)) return undefined;

  return createCoreAggregateSearchTool(keys, fetch, options);
}
