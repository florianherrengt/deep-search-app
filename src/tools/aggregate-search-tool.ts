import {
  createAggregateSearchTool as createCoreAggregateSearchTool,
  hasAggregatableSearchProviders,
  normalizeSearchKeys,
  type CreateAggregateSearchToolOptions,
  type SearchKeys,
} from "deep-search-core/research-orchestrator";
import { searchQueryInputSchema } from "deep-search-core/search-extract/core";
import { fetch } from "@/lib/tauri-bridge";

export const aggregateSearchInputSchema = searchQueryInputSchema;

export interface AggregateSearchToolKeys {
  braveApiKey?: string | null;
  exaApiKey?: string | null;
  serperApiKey?: string | null;
  tavilyApiKey?: string | null;
  searxngBaseUrl?: string | null;
}

function toCoreSearchKeys(
  searchKeys: AggregateSearchToolKeys | undefined,
): SearchKeys | undefined {
  if (!searchKeys) return undefined;
  return normalizeSearchKeys({
    braveApiKey: searchKeys.braveApiKey ?? undefined,
    exaApiKey: searchKeys.exaApiKey ?? undefined,
    serperApiKey: searchKeys.serperApiKey ?? undefined,
    tavilyApiKey: searchKeys.tavilyApiKey ?? undefined,
    searxngBaseUrl: searchKeys.searxngBaseUrl ?? undefined,
  });
}

export function createAggregateSearchTool(
  searchKeys: AggregateSearchToolKeys | undefined,
  options: CreateAggregateSearchToolOptions = {},
) {
  const coreSearchKeys = toCoreSearchKeys(searchKeys);
  if (!coreSearchKeys || !hasAggregatableSearchProviders(coreSearchKeys)) {
    return undefined;
  }
  return createCoreAggregateSearchTool(coreSearchKeys, fetch, options);
}
