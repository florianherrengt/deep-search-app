import { tool, zodSchema, type LanguageModel } from "ai";
import { z } from "zod";
import { isAbortError } from "@/lib/abort";
import type { HumanVerificationDetection } from "@/lib/human-verification";
import type { ChromeMcpConnectionMode, WebExtractionBackend } from "@/lib/settings-store";
import type { SubAgentEmitter } from "@/lib/sub-agent-emitter";
import { createSubAgentId } from "@/lib/sub-agent-types";
import {
  GOOGLE_SEARCH_MAX_RESULTS,
  GOOGLE_SEARCH_ORIGIN,
  GOOGLE_SEARCH_PATH,
} from "@/tools/google-search-constants";

export { GOOGLE_SEARCH_MAX_RESULTS } from "@/tools/google-search-constants";

export const googleSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).describe("Google search query"),
  })
  .strict();

export interface GoogleSearchRenderOptions {
  signal?: AbortSignal;
  onHumanVerification?: (
    detection: HumanVerificationDetection,
  ) => void | Promise<void>;
}

export type GoogleSearchPageRenderer = (
  url: string,
  options: GoogleSearchRenderOptions,
) => Promise<string | null>;

export interface GoogleSearchBrowserConfig {
  chromeDevToolsMcpEnabled?: boolean | null;
  chromeDevToolsMcpConnectionMode?: ChromeMcpConnectionMode | null;
  chromeDevToolsMcpBrowserUrl?: string | null;
  chromeDevToolsMcpNodePath?: string | null;
  webExtractionBackend?: WebExtractionBackend | null;
}

export function buildGoogleSearchUrl(query: string): string {
  const parsed = googleSearchInputSchema.parse({ query });
  const url = new URL(GOOGLE_SEARCH_PATH, GOOGLE_SEARCH_ORIGIN);
  url.searchParams.set("q", parsed.query);
  url.searchParams.set("num", String(GOOGLE_SEARCH_MAX_RESULTS));
  return url.toString();
}

export function createConfiguredGoogleSearchTool(
  model: LanguageModel,
  config: GoogleSearchBrowserConfig | undefined,
  deps?: { emitEvent?: SubAgentEmitter },
) {
  const useChromeMcp =
    Boolean(config?.chromeDevToolsMcpEnabled) &&
    config?.webExtractionBackend === "chrome-mcp";

  return createGoogleSearchTool(
    model,
    async (url, options) => {
      if (useChromeMcp) {
        const { renderWithManagedChromeMcp } = await import(
          "@/tools/chrome-mcp-page-loader"
        );
        return renderWithManagedChromeMcp(
          url,
          {
            connectionMode:
              config?.chromeDevToolsMcpConnectionMode ?? undefined,
            browserUrl: config?.chromeDevToolsMcpBrowserUrl ?? undefined,
            nodePath: config?.chromeDevToolsMcpNodePath ?? undefined,
          },
          {
            signal: options.signal,
            onHumanVerification: options.onHumanVerification,
          },
        );
      }

      const { renderWithManagedWebview } = await import(
        "@/lib/managed-webview"
      );
      return renderWithManagedWebview(url, {
        signal: options.signal,
        onHumanVerification: options.onHumanVerification,
        throwOnError: true,
      });
    },
    deps,
  );
}

export function createGoogleSearchTool(
  model: LanguageModel,
  renderPage: GoogleSearchPageRenderer,
  { emitEvent }: { emitEvent?: SubAgentEmitter } = {},
) {
  return tool({
    description:
      "Search Google directly in a managed browser, then use the configured language model to extract up to 10 organic web results. This does not require a Google Search API key.",
    strict: true,
    inputSchema: zodSchema(googleSearchInputSchema),
    outputSchema: zodSchema(
      z.string().describe("Formatted Google search results"),
    ),
    execute: async ({ query }, options) => {
      let verificationStatusId: string | undefined;
      try {
        const url = buildGoogleSearchUrl(query);
        const html = await renderPage(url, {
          signal: options?.abortSignal,
          onHumanVerification: (detection) => {
            if (!emitEvent) return;
            verificationStatusId ??= createSubAgentId();
            emitEvent({
              type: "start",
              id: verificationStatusId,
              source: "sub-agent",
              name: "Google Search verification",
              toolName: "google_search",
              parentMessageId: "unknown",
              ...(options?.toolCallId
                ? {
                    displayTarget: {
                      type: "toolCall" as const,
                      toolCallId: options.toolCallId,
                    },
                  }
                : {}),
            });
            emitEvent({
              type: "text-delta",
              id: verificationStatusId,
              delta: `${detection.message} Complete it in the browser; Google search will resume automatically.`,
            });
          },
        });
        if (!html?.trim()) {
          throw new Error("Google search did not return rendered HTML.");
        }

        const { extractAndFormatGoogleSearchHtml } = await import(
          "@/tools/google-search-extractor"
        );
        const result = await extractAndFormatGoogleSearchHtml(
          model,
          query,
          html,
          options?.abortSignal,
        );
        if (verificationStatusId) {
          emitEvent?.({ type: "complete", id: verificationStatusId });
        }
        return result;
      } catch (error) {
        if (verificationStatusId) {
          emitEvent?.(
            isAbortError(error) || options?.abortSignal?.aborted
              ? { type: "cancelled", id: verificationStatusId }
              : {
                  type: "error",
                  id: verificationStatusId,
                  error: error instanceof Error ? error.message : String(error),
                },
          );
        }
        throw error;
      }
    },
  });
}
