import { createTauriPageLoader } from "@deep-search/search-extract";

export function createAppPageLoader(opts: {
  fetchHtml: (url: string, signal?: AbortSignal) => Promise<string | null>;
  extractViaWebview: (url: string, options?: unknown, abortSignal?: AbortSignal) => Promise<string | null>;
}) {
  return createTauriPageLoader({
    fetchHtml: opts.fetchHtml,
    renderHtml: (url, signal) => opts.extractViaWebview(url, undefined, signal),
  });
}
