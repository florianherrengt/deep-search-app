import { tool, zodSchema, streamText, type LanguageModel } from "ai";
import { z } from "zod";
import { fetch as bridgeFetch, invoke } from "@/lib/tauri-bridge";
import {
  emitSubAgentEvent,
  type SubAgentEmitter,
} from "@/lib/sub-agent-emitter";
import { createSubAgentId } from "@/lib/sub-agent-types";
import {
  abortablePromise,
  isAbortError,
  throwIfAborted,
} from "@/lib/abort";
import { writeAppFile } from "@/lib/app-file-storage";
import { renderWithManagedWebview } from "@/lib/managed-webview";
import type { HumanVerificationDetection } from "@/lib/human-verification";
import slugify from "slugify";
import { validateUrl, UrlValidationError } from "@/lib/url-validation";
// Type-only imports for `deep-search-core/search-extract/core` — the runtime
// values are loaded lazily via `loadCore()` on the first extraction call.
// This keeps cheerio + parse5 + the extractors (hundreds of KB) out of the
// main bundle so app startup and chat rendering don't pay for code that
// only runs when a page extraction is invoked.
import type {
  PageLoader,
  YouTubeSubtitlesResult,
  PageExtractor,
} from "deep-search-core/search-extract/core";
import { createAppPageLoader, createChromeMcpPageLoader } from "./extraction-page-loader";
import type { ChromeMcpConnectionMode, WebExtractionBackend } from "@/lib/settings-store";

type CoreModule = typeof import("deep-search-core/search-extract");
let corePromise: Promise<CoreModule> | null = null;
function loadCore(): Promise<CoreModule> {
  if (!corePromise) corePromise = import("deep-search-core/search-extract");
  return corePromise;
}

type ExtractionMethod = "auto" | "fetch" | "webview" | "chrome" | "scrape.do";

interface ExtractPageContentOptions {
  query?: string;
  summarize?: boolean;
  method?: ExtractionMethod;
  model?: LanguageModel;
  getResearchFolder?: () => Promise<string | null | undefined>;
  abortSignal?: AbortSignal;
  chromeMcp?: {
    enabled: boolean;
    connectionMode?: ChromeMcpConnectionMode;
    browserUrl?: string;
    nodePath?: string;
    backend: WebExtractionBackend;
  };
  scrapeDoApiKey?: string | null;
  youtubeSubtitleDownload?: YouTubeSubtitleDownloadConfig;
  emitEvent?: SubAgentEmitter;
}

export interface YouTubeSubtitleDownloadConfig {
  ytDlpPath?: string | null;
}

type RawContentLocation = {
  rawPath: string;
  page: string;
};

function createPageExtractors(
  core: CoreModule,
  youtubeSubtitleDownload?: YouTubeSubtitleDownloadConfig,
): PageExtractor[] {
  return [
    new core.RedditExtractor(),
    new core.AmazonExtractor(),
    new core.ShopifyExtractor(),
    new core.TrustpilotExtractor(),
    new core.GithubExtractor(),
    new core.YouTubeExtractor({
      subtitleDownloader: createYouTubeSubtitleDownloader(youtubeSubtitleDownload),
    }),
  ];
}

function createYouTubeSubtitleDownloader(
  config: YouTubeSubtitleDownloadConfig | undefined,
) {
  const ytDlpPath = config?.ytDlpPath?.trim() ?? "";
  if (!ytDlpPath) return undefined;

  return async ({
    url,
    signal,
  }: {
    url: string;
    videoId: string;
    reason: string;
    signal?: AbortSignal;
  }) => {
    return await abortablePromise(
      invoke<YouTubeSubtitlesResult>("download_youtube_subtitles_with_ytdlp", {
        ytDlpPath,
        url,
      }),
      signal,
    );
  };
}

function hasUsefulContent(core: CoreModule, html: string | null): html is string {
  if (!html) return false;
  return core.sanitizeHtml(html).length >= core.MIN_CONTENT_LENGTH;
}

function preferMoreUsefulHtml(
  core: CoreModule,
  primaryHtml: string | null,
  fallbackHtml: string | null,
): string | null {
  if (!primaryHtml) return fallbackHtml;
  if (!fallbackHtml) return primaryHtml;

  return core.sanitizeHtml(fallbackHtml).length >=
    core.sanitizeHtml(primaryHtml).length
    ? fallbackHtml
    : primaryHtml;
}

function withScrapeDoFallback(
  pageLoader: PageLoader,
  apiKey: string,
): PageLoader {
  return {
    ...pageLoader,
    renderHtml: async (url, options) => {
      const core = await loadCore();
      const remoteHtml = await core.fetchScrapeDoHtml(
        url,
        { apiKey, fetch: bridgeFetch },
        options,
      );
      if (hasUsefulContent(core, remoteHtml)) return remoteHtml;
      return pageLoader.renderHtml?.(url, options) ?? null;
    },
  };
}

function withRenderFallback(
  primary: PageLoader,
  fallback: PageLoader,
  primaryName: string,
): PageLoader {
  return {
    fetchHtml: fallback.fetchHtml ?? primary.fetchHtml,
    renderHtml: async (url, options) => {
      const core = await loadCore();
      let primaryHtml: string | null = null;

      try {
        throwIfAborted(options?.signal);
        const primaryRender = primary.renderHtml?.(url, options);
        primaryHtml = primaryRender
          ? await abortablePromise(primaryRender, options?.signal)
          : null;
        throwIfAborted(options?.signal);
        if (hasUsefulContent(core, primaryHtml)) return primaryHtml;
      } catch (error) {
        if (isAbortError(error) || options?.signal?.aborted) throw error;
        console.warn(
          `[extract] ${primaryName} failed for ${url}; falling back to the Tauri webview:`,
          error instanceof Error ? error.message : error,
        );
      }

      throwIfAborted(options?.signal);
      const fallbackRender = fallback.renderHtml?.(url, options);
      const fallbackHtml = fallbackRender
        ? await abortablePromise(fallbackRender, options?.signal)
        : null;
      return preferMoreUsefulHtml(core, primaryHtml, fallbackHtml);
    },
  };
}

export function createExtractionPageLoader({
  chromeMcp,
  scrapeDoApiKey,
  method = "auto",
  onHumanVerification,
}: {
  chromeMcp?: {
    enabled: boolean;
    connectionMode?: ChromeMcpConnectionMode;
    browserUrl?: string;
    nodePath?: string;
    backend: WebExtractionBackend;
  };
  scrapeDoApiKey?: string | null;
  method?: ExtractionMethod;
  onHumanVerification?: (
    detection: HumanVerificationDetection,
  ) => void | Promise<void>;
} = {}): PageLoader {
  const backend = chromeMcp?.backend ?? "tauri-webview";
  const forceChrome = method === "chrome";
  const forceWebview = method === "webview";
  const shouldUseChromeMcp =
    !forceWebview &&
    Boolean(chromeMcp?.enabled) &&
    (backend === "chrome-mcp" || forceChrome);
  const scrapeDoToken = scrapeDoApiKey?.trim() ?? "";
  const useScrapeDo = (method === "auto" || method === "scrape.do") && scrapeDoToken.length > 0;

  const tauriPageLoader = createAppPageLoader({
    fetchHtml,
    extractViaWebview: (url, _options, signal) =>
      extractViaWebview(url, signal, onHumanVerification),
  });
  const basePageLoader = shouldUseChromeMcp
    ? withRenderFallback(
        createChromeMcpPageLoader({
          connectionMode: chromeMcp!.connectionMode,
          browserUrl: chromeMcp!.browserUrl,
          nodePath: chromeMcp!.nodePath,
          onHumanVerification,
        }),
        tauriPageLoader,
        "Chrome MCP rendering",
      )
    : tauriPageLoader;

  return useScrapeDo
    ? withScrapeDoFallback(basePageLoader, scrapeDoToken)
    : basePageLoader;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function pageSlugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const base = slugify(
      (u.pathname.replace(/\/$/, "") || "index").replace(/_/g, "-"),
      { lower: true, strict: true, trim: true },
    ).slice(0, 120);
    return base || "page";
  } catch {
    return "page";
  }
}

function rawContentLocation(
  url: string,
  researchFolder: string,
): RawContentLocation {
  const domain = domainFromUrl(url);
  const page = pageSlugFromUrl(url);

  return {
    rawPath: `search-results/${researchFolder}/raw/${domain}`,
    page,
  };
}

export async function fetchHtml(
  url: string,
  abortSignal?: AbortSignal,
): Promise<string | null> {
  try {
    validateUrl(url);
    return await abortablePromise(
      invoke<string | null>("fetch_html", { url }),
      abortSignal,
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  }
}

async function summarizeContent(
  model: LanguageModel,
  markdown: string,
  query?: string,
  abortSignal?: AbortSignal,
  subAgentId?: string,
  emitEvent: SubAgentEmitter = emitSubAgentEvent,
): Promise<string> {
  if (!markdown.trim()) return "";
  const result = streamText({
    model,
    system:
      "You are a research assistant. Extract and summarize the key information from this page content. Be concise but thorough. Preserve factual details, names, dates, and numbers.",
    prompt: `${markdown}${query ? `\n\nFocus on information related to: ${query}` : ""}`,
    abortSignal,
  });
  if (subAgentId) {
    for await (const textPart of result.textStream) {
      emitEvent({ type: "text-delta", id: subAgentId, delta: textPart });
    }
  }
  return result.text;
}

function getRetryOptions(core: CoreModule, url: string) {
  const isReddit = /\.?reddit\.com\//.test(url);
  const isAmazon = /\.?amazon\./.test(url) && /\/dp\//i.test(url);

  if (isReddit) {
    return {
      shouldRetry: core.isRedditChallengeHtml,
      maxWaitMs: 5 * 60_000,
      retryIntervalMs: 5_000,
    };
  }
  if (isAmazon) {
    return {
      shouldRetry: core.isAmazonChallengePage,
      maxWaitMs: 3 * 60_000,
      retryIntervalMs: 3_000,
    };
  }
  return undefined;
}

async function extractViaWebview(
  url: string,
  abortSignal?: AbortSignal,
  onHumanVerification?: (
    detection: HumanVerificationDetection,
  ) => void | Promise<void>,
): Promise<string | null> {
  const core = await loadCore();
  return renderWithManagedWebview(url, {
    signal: abortSignal,
    retry: getRetryOptions(core, url),
    onHumanVerification,
  });
}

function shouldSummarizeContent(
  options: ExtractPageContentOptions,
  usedCustomExtractor: boolean,
): boolean {
  if (options.query) return true;
  return (
    options.summarize === true ||
    (!usedCustomExtractor && options.summarize !== false)
  );
}

async function saveExtractedContent({
  location,
  html,
  content,
}: {
  location: RawContentLocation;
  html: string | null;
  content: string;
}) {
  if (html) {
    await writeAppFile({
      subfolder: location.rawPath,
      filename: `${location.page}.html`,
      content: html,
    });
  }

  if (content) {
    await writeAppFile({
      subfolder: location.rawPath,
      filename: `${location.page}-content.html`,
      content,
    });
  }
}

async function saveSummaryContent(
  location: RawContentLocation,
  summary: string,
) {
  await writeAppFile({
    subfolder: location.rawPath,
    filename: `${location.page}-summary.md`,
    content: summary,
  });
}

async function trySummarizeContent(
  model: LanguageModel | undefined,
  content: string,
  query: string | undefined,
  abortSignal?: AbortSignal,
  subAgentId?: string,
  emitEvent: SubAgentEmitter = emitSubAgentEvent,
): Promise<string | null> {
  if (!model || !content.trim()) return null;

  try {
    return await summarizeContent(
      model,
      content,
      query,
      abortSignal,
      subAgentId,
      emitEvent,
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  }
}

function mapAppMethod(method: ExtractionMethod): "auto" | "fetch" | "render" {
  if (method === "webview" || method === "chrome" || method === "scrape.do") return "render";
  return method;
}

export async function extractPageContent(
  url: string,
  options: ExtractPageContentOptions & { subAgentId?: string } = {},
): Promise<string> {
  const forced = options.method ?? "auto";
  const saId = options.subAgentId;
  const emitEvent = options.emitEvent ?? emitSubAgentEvent;

  throwIfAborted(options.abortSignal);

  if (saId) {
    emitEvent({ type: "text-delta", id: saId, delta: `Extracting content from ${url}...\n\n` });
  }

  const core = await loadCore();
  const extractResult = await core.extractPage(
    url,
    {
      method: mapAppMethod(forced),
      summarize: false,
      signal: options.abortSignal,
    },
    {
      fetch: bridgeFetch,
      pageLoader: createExtractionPageLoader({
        chromeMcp: options.chromeMcp,
        scrapeDoApiKey: options.scrapeDoApiKey,
        method: forced,
        onHumanVerification: (detection) => {
          if (!saId) return;
          emitEvent({
            type: "text-delta",
            id: saId,
            delta: `${detection.message} Complete it in the browser; extraction will resume automatically.\n\n`,
          });
        },
      }),
      extractors: createPageExtractors(core, options.youtubeSubtitleDownload),
    },
  );

  // The core helper takes the signal, but a backend that does not propagate
  // abort (or an abort that fires between the extraction returning and the
  // next await) would otherwise let us save and summarize data the user
  // explicitly cancelled. Re-check before any side effect.
  throwIfAborted(options.abortSignal);

  const { content, html: rawHtml, usedCustomExtractor, warnings } = extractResult;
  const html = rawHtml ?? null;

  if (!html && !content) {
    return appendExtractionWarnings(
      `No content could be extracted from ${url}. The page may be empty, require JavaScript rendering, or be blocked by a paywall or captcha.`,
      warnings,
    );
  }

  const shouldSummarize = shouldSummarizeContent(options, usedCustomExtractor);
  const researchFolder = await options.getResearchFolder?.();
  throwIfAborted(options.abortSignal);

  if (!researchFolder) {
    if (!shouldSummarize) return content;
    return (
      (await trySummarizeContent(
        options.model,
        content,
        options.query,
        options.abortSignal,
        saId,
        emitEvent,
      )) ??
      content
    );
  }

  const location = rawContentLocation(url, researchFolder);
  let saveFailed = false;
  try {
    await saveExtractedContent({ location, html, content });
  } catch (err) {
    console.error("[extract] Failed to save extracted content:", err);
    saveFailed = true;
  }
  throwIfAborted(options.abortSignal);

  if (shouldSummarize) {
    const summary = await trySummarizeContent(
      options.model,
      content,
      options.query,
      options.abortSignal,
      saId,
      emitEvent,
    );
    if (summary) {
      // trySummarizeContent re-throws AbortError, but a backend that completes
      // despite the signal firing could return a summary we no longer want.
      throwIfAborted(options.abortSignal);
      try {
        await saveSummaryContent(location, summary);
      } catch (err) {
        console.error("[extract] Failed to save summary content:", err);
        saveFailed = true;
      }
      return saveFailed
        ? `${summary}\n\n[Warning: Failed to save this content to the research folder. It will not be available for future searches.]`
        : summary;
    }
  }

  return saveFailed
    ? `${content}\n\n[Warning: Failed to save this content to the research folder. It will not be available for future searches.]`
    : content;
}

function appendExtractionWarnings(message: string, warnings?: string[]): string {
  const usefulWarnings = (warnings ?? []).filter((warning) => warning.trim());
  if (usefulWarnings.length === 0) return message;
  return `${message}\n\nWarnings:\n${usefulWarnings.map((warning) => `- ${warning}`).join("\n")}`;
}

export const extractPageContentInputSchema = z.object({
  url: z.string().describe("URL to extract content from"),
  query: z
    .string()
    .optional()
    .describe(
      'What you want from the page — focuses the summary on specific information (e.g. "price", "ingredients list", "author biography").',
    ),
  summarize: z
    .boolean()
    .optional()
    .describe(
      "Set to false to get the full page content. By default the page is summarized.",
    ),
  method: z
    .enum(["auto", "fetch", "webview", "chrome", "scrape.do"])
    .optional()
    .describe(
      "Extraction method. 'auto' tries fetch, then remote extraction (Scrape.do if configured), then browser rendering. 'fetch' forces HTTP-only. 'webview' forces the built-in browser renderer. 'chrome' prefers your local Chrome via Chrome DevTools MCP (falls back to the webview if unavailable). 'scrape.do' prefers the Scrape.do remote renderer (falls back if no API key).",
    ),
});

export function createExtractPageContentTool(
  model: LanguageModel,
  getResearchFolder: () => Promise<string>,
  chromeMcp?: {
    enabled: boolean;
    connectionMode?: ChromeMcpConnectionMode;
    browserUrl?: string;
    nodePath?: string;
    backend: WebExtractionBackend;
  },
  scrapeDoApiKey?: string | null,
  youtubeSubtitleDownload?: YouTubeSubtitleDownloadConfig,
  deps?: { emitEvent?: SubAgentEmitter },
) {
  const emitEvent = deps?.emitEvent ?? emitSubAgentEvent;
  return tool({
    description:
      "Extract the plain-text content of a web page with scripts, styles, hidden UI, and obvious boilerplate stripped. Use this to read the content of a URL found during research. Raw HTML and cleaned text are automatically saved to the research folder.\n\nBy default the page is summarized. Provide a `query` to focus the summary on specific information — for example `query: \"price and availability\"` returns a summary centered on those details. Set `summarize: false` when you need the full page content.",
    strict: true,
    inputSchema: zodSchema(extractPageContentInputSchema),
    outputSchema: zodSchema(z.string().describe("Extracted page content")),
    execute: async ({ url, query, summarize: doSummarize, method }, options) => {
      try {
        validateUrl(url);
      } catch (e) {
        if (e instanceof UrlValidationError) return `Error: ${e.message}`;
        throw e;
      }

      const saId = createSubAgentId();
      const toolCallId = options?.toolCallId;
      emitEvent({
        type: "start",
        id: saId,
        source: "sub-agent",
        name: "Content Extraction",
        toolName: "extract_page_content",
        parentMessageId: "tool",
        displayTarget: toolCallId
          ? { type: "toolCall", toolCallId }
          : { type: "sidebar" },
      });

      try {
        const result = await extractPageContent(url, {
          query,
          summarize: doSummarize,
          method,
          model,
          getResearchFolder,
          abortSignal: options?.abortSignal,
          subAgentId: saId,
          chromeMcp,
          scrapeDoApiKey,
          youtubeSubtitleDownload,
          emitEvent,
        });

        emitEvent({ type: "complete", id: saId });
        return result;
      } catch (error) {
        // Distinguish cancellation from real failures so the sub-agent UI
        // shows a "cancelled" state instead of an error when the user stops
        // the run. The underlying error is still re-thrown so the abort
        // propagates to the orchestrator.
        if (isAbortError(error) || options?.abortSignal?.aborted) {
          emitEvent({ type: "cancelled", id: saId });
        } else {
          emitEvent({
            type: "error",
            id: saId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    },
  });
}
