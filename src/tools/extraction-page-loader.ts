import type { PageLoader } from "deep-search-core/search-extract/core";
import type { HumanVerificationDetection } from "@/lib/human-verification";
import type { ChromeMcpConnection } from "./chrome-mcp-page-loader";

export function createAppPageLoader(opts: {
  fetchHtml: (url: string, signal?: AbortSignal) => Promise<string | null>;
  extractViaWebview: (url: string, options?: unknown, abortSignal?: AbortSignal) => Promise<string | null>;
}): PageLoader {
  return {
    fetchHtml: (url, options) => opts.fetchHtml(url, options?.signal),
    renderHtml: (url, options) =>
      opts.extractViaWebview(url, undefined, options?.signal),
  };
}

export function createChromeMcpPageLoader(
  connection: ChromeMcpConnection & {
    onHumanVerification?: (
      detection: HumanVerificationDetection,
    ) => void | Promise<void>;
  },
): PageLoader {
  return {
    fetchHtml: undefined,
    renderHtml: async (url, options) => {
      const { renderWithManagedChromeMcp } = await import(
        "./chrome-mcp-page-loader"
      );
      return renderWithManagedChromeMcp(url, connection, {
        signal: options?.signal,
        onHumanVerification: connection.onHumanVerification,
      });
    },
  };
}
