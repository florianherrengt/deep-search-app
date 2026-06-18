import { tool, zodSchema, streamText, type LanguageModel } from "ai";
import { z } from "zod";
import { invoke } from "@/lib/tauri-bridge";
import { emitSubAgentEvent } from "@/lib/sub-agent-emitter";
import { createSubAgentId } from "@/lib/sub-agent-types";
import {
  abortableDelay,
  abortablePromise,
  isAbortError,
  throwIfAborted,
} from "@/lib/abort";
import { writeAppFile } from "@/lib/app-file-storage";
import {
  emitBrowserTabClosed,
  emitBrowserTabOpened,
} from "@/lib/browser-tab-events";
import { tryParseJson } from "@/lib/json";
import slugify from "slugify";
import { validateUrl, UrlValidationError } from "@/lib/url-validation";
import {
  sanitizeHtml,
  extractVisibleTextFromHtml,
  createSearchExtractEngine,
  RedditExtractor,
  AmazonExtractor,
  ShopifyExtractor,
  isRedditChallengeHtml,
  isAmazonChallengePage,
  type SearchExtractEngine,
} from "@deep-search/search-extract";
import { createAppPageLoader, createChromeMcpPageLoader } from "./extraction-page-loader";
import type { ChromeMcpConnectionMode, WebExtractionBackend } from "@/lib/settings-store";

const DEFAULT_WEBVIEW_RETRY_INTERVAL_MS = 5_000;
const DEFAULT_WEBVIEW_MAX_WAIT_MS = 5 * 60_000;

type ExtractionMethod = "auto" | "fetch" | "webview";

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
    backend: WebExtractionBackend;
  };
}

type RawContentLocation = {
  rawPath: string;
  page: string;
};

let webviewExtractionQueue: Promise<void> = Promise.resolve();
let nextWebviewTabId = 0;

let _engine: SearchExtractEngine | null = null;
let _engineKey: string | undefined;

function getEngine(
  chromeMcp?: {
    enabled: boolean;
    connectionMode?: ChromeMcpConnectionMode;
    browserUrl?: string;
    backend: WebExtractionBackend;
  },
): SearchExtractEngine {
  const backend = chromeMcp?.backend ?? "tauri-webview";
  const shouldUseChromeMcp = backend === "chrome-mcp" && chromeMcp?.enabled;
  const engineKey = shouldUseChromeMcp ? `chrome-mcp:${chromeMcp?.connectionMode ?? ""}` : "tauri-webview";

  if (_engine && _engineKey === engineKey) return _engine;

  const pageLoader = shouldUseChromeMcp
    ? createChromeMcpPageLoader({
        connectionMode: chromeMcp!.connectionMode,
        browserUrl: chromeMcp!.browserUrl,
      })
    : createAppPageLoader({ fetchHtml, extractViaWebview });

  _engine = createSearchExtractEngine({
    pageLoader,
    extractors: [new RedditExtractor(), new AmazonExtractor(), new ShopifyExtractor()],
  });
  _engineKey = engineKey;
  return _engine;
}

function createWebviewTabId(): string {
  nextWebviewTabId += 1;
  return `tab-${Date.now()}-${nextWebviewTabId}`;
}

async function runExclusiveWebviewExtraction<T>(
  task: () => Promise<T>,
): Promise<T> {
  const previous = webviewExtractionQueue;
  let release!: () => void;
  webviewExtractionQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    release();
  }
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

function waitForBrowserPaint(): Promise<void> {
  if (
    typeof window === "undefined" ||
    typeof window.requestAnimationFrame !== "function"
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function openWebviewTab(
  id: string,
  url: string,
  abortSignal?: AbortSignal,
) {
  await abortablePromise(invoke("open_tab", { url, id }), abortSignal);
}

async function switchWebviewTab(
  id: string,
  abortSignal?: AbortSignal,
) {
  await abortablePromise(
    invoke("switch_tab", { id }).catch(() => undefined),
    abortSignal,
  );
}

async function extractWebviewContent(
  id: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  return abortablePromise(
    invoke<string>("extract_content", { id }),
    abortSignal,
  );
}

async function closeWebviewTab(id: string) {
  await invoke("close_tab", { id }).catch(() => undefined);
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
      emitSubAgentEvent({ type: "text-delta", id: subAgentId, delta: textPart });
    }
  }
  return result.text;
}

function normalizeWebviewHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed.startsWith('"') && !trimmed.startsWith("{")) return html;

  const parsed = tryParseJson(trimmed);
  if (typeof parsed === "string") return parsed;
  if (
    parsed &&
    typeof parsed === "object" &&
    "value" in parsed &&
    typeof parsed.value === "string"
  ) {
    return parsed.value;
  }

  return html;
}

function getRetryOptions(url: string) {
  const isReddit = /\.?reddit\.com\//.test(url);
  const isAmazon = /\.?amazon\./.test(url) && /\/dp\//i.test(url);

  if (isReddit) {
    return {
      shouldRetry: isRedditChallengeHtml,
      maxWaitMs: 5 * 60_000,
      retryIntervalMs: 5_000,
    };
  }
  if (isAmazon) {
    return {
      shouldRetry: isAmazonChallengePage,
      maxWaitMs: 3 * 60_000,
      retryIntervalMs: 3_000,
    };
  }
  return undefined;
}

async function extractViaWebview(
  url: string,
  _options?: unknown,
  abortSignal?: AbortSignal,
): Promise<string | null> {
  validateUrl(url);
  throwIfAborted(abortSignal);

  return runExclusiveWebviewExtraction(async () => {
    const id = createWebviewTabId();
    let tabAnnounced = false;
    try {
      emitBrowserTabOpened({
        id,
        url,
        title: domainFromUrl(url),
        activate: true,
      });
      tabAnnounced = true;

      await abortablePromise(waitForBrowserPaint(), abortSignal);
      await openWebviewTab(id, url, abortSignal);
      await switchWebviewTab(id, abortSignal);
      const startedAt = Date.now();

      const retryOptions = getRetryOptions(url);

      while (true) {
        throwIfAborted(abortSignal);
        const rawHtml = await extractWebviewContent(id, abortSignal);
        const html = normalizeWebviewHtml(rawHtml);
        const shouldRetry = retryOptions?.shouldRetry?.(html) ?? false;

        if (!shouldRetry) return html;

        const maxWaitMs = retryOptions?.maxWaitMs ?? DEFAULT_WEBVIEW_MAX_WAIT_MS;
        if (Date.now() - startedAt >= maxWaitMs) return html;

        await abortableDelay(
          retryOptions?.retryIntervalMs ?? DEFAULT_WEBVIEW_RETRY_INTERVAL_MS,
          abortSignal,
        );
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn(
        `[extract] extractViaWebview failed for ${url}:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    } finally {
      await closeWebviewTab(id);
      if (tabAnnounced) emitBrowserTabClosed({ id });
    }
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
): Promise<string | null> {
  if (!model || !content.trim()) return null;

  try {
    return await summarizeContent(model, content, query, abortSignal, subAgentId);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  }
}

function mapAppMethod(method: ExtractionMethod): "auto" | "fetch" | "render" {
  if (method === "webview") return "render";
  return method;
}

export async function extractPageContent(
  url: string,
  options: ExtractPageContentOptions & { subAgentId?: string } = {},
): Promise<string> {
  const forced = options.method ?? "auto";
  const saId = options.subAgentId;

  if (saId) {
    emitSubAgentEvent({ type: "text-delta", id: saId, delta: `Extracting content from ${url}...\n\n` });
  }

  const engine = getEngine(options.chromeMcp);
  const extractResult = await engine.extract(url, {
    method: mapAppMethod(forced),
    summarize: false,
    signal: options.abortSignal,
  });

  const { content, html: rawHtml, usedCustomExtractor } = extractResult;
  const html = rawHtml ?? null;

  if (!html && !content) {
    return `No content could be extracted from ${url}. The page may be empty, require JavaScript rendering, or be blocked by a paywall or captcha.`;
  }

  const shouldSummarize = shouldSummarizeContent(options, usedCustomExtractor);
  const researchFolder = await options.getResearchFolder?.();

  if (!researchFolder) {
    if (!shouldSummarize) return content;
    return (
      (await trySummarizeContent(
        options.model,
        content,
        options.query,
        options.abortSignal,
        saId,
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

  if (shouldSummarize) {
    const summary = await trySummarizeContent(
      options.model,
      content,
      options.query,
      options.abortSignal,
      saId,
    );
    if (summary) {
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
    .enum(["auto", "fetch", "webview"])
    .optional()
    .describe(
      "Extraction method. 'auto' tries fetch then falls back to webview. 'fetch' forces HTTP-only. 'webview' forces browser rendering.",
    ),
});

export function createExtractPageContentTool(
  model: LanguageModel,
  getResearchFolder: () => Promise<string>,
  chromeMcp?: {
    enabled: boolean;
    connectionMode?: ChromeMcpConnectionMode;
    browserUrl?: string;
    backend: WebExtractionBackend;
  },
) {
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
      emitSubAgentEvent({
        type: "start",
        id: saId,
        source: "sub-agent",
        name: "Content Extraction",
        toolName: "extract_page_content",
        parentMessageId: "tool",
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
        });

        emitSubAgentEvent({ type: "complete", id: saId });
        return result;
      } catch (error) {
        if (options?.abortSignal?.aborted) {
          emitSubAgentEvent({ type: "error", id: saId, error: "Cancelled" });
        } else {
          emitSubAgentEvent({
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

export { sanitizeHtml, extractVisibleTextFromHtml };
