import { tool, zodSchema } from "ai";
import {
  AGGREGATABLE_PROVIDER_NAMES,
  DEFAULT_AGGREGATE_NUM_RESULTS,
  createBraveSearch,
  createExaSearch,
  createSearXNGFetchSearch,
  createSerperSearch,
  createTavilySearch,
  formatSearchResults,
  mergeResults,
  searchQueryInputSchema,
  type AggregatableProviderName,
  type SearchResult,
} from "deep-search-core/search-extract";
import {
  AggregateSearchError,
  SearchProviderConfigError,
} from "deep-search-core/search-extract/core";
import { fetch } from "@/lib/tauri-bridge";
import { isValidServiceUrl } from "@/lib/url-validation";

export const aggregateSearchInputSchema = searchQueryInputSchema;
const DEFAULT_PROVIDER_TIMEOUT_MS = 20_000;

export interface AggregateSearchToolKeys {
  braveApiKey?: string | null;
  exaApiKey?: string | null;
  serperApiKey?: string | null;
  tavilyApiKey?: string | null;
  searxngBaseUrl?: string | null;
}

interface AggregateSearchToolOptions {
  providerTimeoutMs?: number;
}

type SearchFn = (
  query: string,
  signal?: AbortSignal,
) => Promise<SearchResult[]>;

type ConfiguredSearchProviders = {
  name: AggregatableProviderName;
  search: SearchFn;
};

function getConfiguredSearchProviders(
  searchKeys: AggregateSearchToolKeys | undefined,
): ConfiguredSearchProviders[] {
  const providers: ConfiguredSearchProviders[] = [];

  if (searchKeys?.braveApiKey) {
    providers.push({
      name: "brave",
      search: createBraveSearch({
        apiKey: searchKeys.braveApiKey,
        fetch,
      }),
    });
  }
  if (searchKeys?.exaApiKey) {
    providers.push({
      name: "exa",
      search: createExaSearch({
        apiKey: searchKeys.exaApiKey,
        fetch,
      }),
    });
  }
  if (searchKeys?.serperApiKey) {
    providers.push({
      name: "serper",
      search: createSerperSearch({
        apiKey: searchKeys.serperApiKey,
        fetch,
      }),
    });
  }
  if (searchKeys?.tavilyApiKey) {
    providers.push({
      name: "tavily",
      search: createTavilySearch({
        apiKey: searchKeys.tavilyApiKey,
        fetch,
      }),
    });
  }
  if (
    searchKeys?.searxngBaseUrl &&
    isValidServiceUrl(searchKeys.searxngBaseUrl)
  ) {
    providers.push({
      name: "searxng",
      search: createSearXNGFetchSearch({
        baseUrl: searchKeys.searxngBaseUrl,
        fetch,
      }),
    });
  }

  const byName = new Map(providers.map((provider) => [provider.name, provider]));
  return AGGREGATABLE_PROVIDER_NAMES.flatMap((providerName) => {
    const provider = byName.get(providerName);
    return provider ? [provider] : [];
  });
}

export function createAggregateSearchTool(
  searchKeys: AggregateSearchToolKeys | undefined,
  options: AggregateSearchToolOptions = {},
) {
  const providers = getConfiguredSearchProviders(searchKeys);

  if (providers.length === 0) {
    return undefined;
  }
  const providerTimeoutMs =
    options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;

  return tool({
    description:
      "Search the web using all configured providers and merge the results. " +
      "Results that appear across multiple providers are deduplicated and ranked by " +
      "how many engines returned them, then by best per-engine rank. Use this when a " +
      "single provider's coverage is insufficient or when cross-source corroboration " +
      "matters more than latency.",
    strict: true,
    inputSchema: zodSchema(aggregateSearchInputSchema),
    execute: async ({ query }, ctx) => {
      if (providers.length === 0) {
        throw new SearchProviderConfigError(
          "Aggregate",
          "requires at least one underlying search provider to be configured",
        );
      }

      const engineResults: SearchResult[][] = [];
      const errors: Error[] = [];

      const settled = await Promise.allSettled(
        providers.map((provider) =>
          runProviderSearchWithTimeout(
            provider,
            query,
            ctx?.abortSignal,
            providerTimeoutMs,
          ),
        ),
      );

      if (ctx?.abortSignal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      for (const result of settled) {
        if (result.status === "fulfilled") {
          engineResults.push(result.value);
        } else {
          errors.push(result.reason as Error);
        }
      }

      if (engineResults.length === 0 && errors.length > 0) {
        throw new AggregateSearchError(
          errors,
          `Aggregate search failed: all underlying providers failed for query "${query}"`,
        );
      }

      return formatSearchResults(
        mergeResults(engineResults, DEFAULT_AGGREGATE_NUM_RESULTS),
      );
    },
  });
}

async function runProviderSearchWithTimeout(
  provider: ConfiguredSearchProviders,
  query: string,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const { signal, cleanup } = createChildSignalWithTimeout(
    parentSignal,
    timeoutMs,
    provider.name,
  );

  try {
    return await Promise.race([
      provider.search(query, signal),
      rejectOnAbort(signal),
    ]);
  } finally {
    cleanup();
  }
}

function createChildSignalWithTimeout(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  providerName: AggregatableProviderName,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new DOMException(
        `${providerName} search timed out after ${timeoutMs}ms.`,
        "TimeoutError",
      ),
    );
  }, timeoutMs);

  const abortFromParent = () => {
    controller.abort(
      parentSignal?.reason ??
        new DOMException("The operation was aborted.", "AbortError"),
    );
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(getAbortReason(signal));
  }

  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(getAbortReason(signal)), {
      once: true,
    });
  });
}

function getAbortReason(signal: AbortSignal) {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }
  return new DOMException("The operation was aborted.", "AbortError");
}
