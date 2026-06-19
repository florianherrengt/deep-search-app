import { createTauriPageLoader } from "deep-search-core/search-extract";
import { createChromeMcpPageLoader } from "./chrome-mcp-page-loader";

export { createChromeMcpPageLoader };

export function createAppPageLoader(opts: {
  fetchHtml: (url: string, signal?: AbortSignal) => Promise<string | null>;
  extractViaWebview: (url: string, options?: unknown, abortSignal?: AbortSignal) => Promise<string | null>;
}) {
  return createTauriPageLoader({
    fetchHtml: opts.fetchHtml,
    renderHtml: (url, signal) => opts.extractViaWebview(url, undefined, signal),
  });
}
