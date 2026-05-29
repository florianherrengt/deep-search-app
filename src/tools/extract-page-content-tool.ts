import { tool, zodSchema, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { writeAppFile } from "@/lib/app-file-storage";
import { validateUrl, UrlValidationError } from "@/lib/url-validation";
import { registry, setWebViewExtractor, type WebViewExtractorOptions } from "./extractors";

const MIN_CONTENT_LENGTH = 200;
const DEFAULT_WEBVIEW_RETRY_INTERVAL_MS = 5_000;
const DEFAULT_WEBVIEW_MAX_WAIT_MS = 5 * 60_000;

type ExtractionMethod = "auto" | "fetch" | "webview";

interface ExtractPageContentOptions {
  query?: string;
  summarize?: boolean;
  method?: ExtractionMethod;
  model?: LanguageModel;
  getResearchFolder?: () => Promise<string | null | undefined>;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function pathSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function pageSlugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const base = pathSlug(u.pathname.replace(/\/$/, "") || "index");
    return base || "page";
  } catch {
    return "page";
  }
}

export async function fetchHtml(url: string): Promise<string | null> {
  try {
    validateUrl(url);
    return await invoke<string | null>("fetch_html", { url });
  } catch {
    return null;
  }
}

async function summarizeContent(
  model: LanguageModel,
  markdown: string,
  query?: string,
): Promise<string> {
  if (!markdown.trim()) return "";
  const { text } = await generateText({
    model,
    system:
      "You are a research assistant. Extract and summarize the key information from this page content. Be concise but thorough. Preserve factual details, names, dates, and numbers.",
    prompt: `${markdown}${query ? `\n\nFocus on information related to: ${query}` : ""}`,
  });
  return text;
}

const STRIP_TAGS = [
  "script",
  "style",
  "link",
  "noscript",
  "iframe",
  "svg",
  "nav",
  "footer",
  "aside",
  "header",
];

export function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  for (const tag of STRIP_TAGS) {
    doc.querySelectorAll(tag).forEach((el) => el.remove());
  }
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith("on") || attr.name === "style") {
        el.removeAttribute(attr.name);
      }
    }
  });
  const body = doc.body;
  if (!body) return html;
  return body.innerHTML.replace(/\n{3,}/g, "\n\n").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWebviewHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed.startsWith('"') && !trimmed.startsWith("{")) return html;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") return parsed;
    if (
      parsed &&
      typeof parsed === "object" &&
      "value" in parsed &&
      typeof parsed.value === "string"
    ) {
      return parsed.value;
    }
  } catch {}

  return html;
}

async function extractViaWebview(
  url: string,
  options?: WebViewExtractorOptions,
): Promise<string | null> {
  validateUrl(url);
  const id = `tab-${Date.now()}`;
  try {
    await invoke("open_tab", { url, id });
    const startedAt = Date.now();

    while (true) {
      const rawHtml: string = await invoke("extract_content", { id });
      const html = normalizeWebviewHtml(rawHtml);
      const shouldRetry = options?.shouldRetry?.(html) ?? false;

      if (!shouldRetry) return html;

      const maxWaitMs = options?.maxWaitMs ?? DEFAULT_WEBVIEW_MAX_WAIT_MS;
      if (Date.now() - startedAt >= maxWaitMs) return html;

      await sleep(options?.retryIntervalMs ?? DEFAULT_WEBVIEW_RETRY_INTERVAL_MS);
    }
  } catch {
    return null;
  } finally {
    try {
      await invoke("close_tab", { id });
    } catch {}
  }
}

setWebViewExtractor(extractViaWebview);

export async function extractPageContent(
  url: string,
  options: ExtractPageContentOptions = {},
): Promise<string> {
  const forced = options.method ?? "auto";
  let html: string | null = null;
  let content = "";
  let usedCustomExtractor = false;

  const extractor = registry.find(url);
  if (extractor) {
    usedCustomExtractor = true;
    content = await extractor.extract(url);
  } else if (forced === "webview") {
    html = await extractViaWebview(url);
    content = html ? sanitizeHtml(html) : "";
  } else {
    html = await fetchHtml(url);
    content = html ? sanitizeHtml(html) : "";
    if (forced === "auto" && content.length < MIN_CONTENT_LENGTH) {
      html = await extractViaWebview(url);
      content = html ? sanitizeHtml(html) : "";
    }
  }

  if (html || content) {
    const shouldSummarize =
      options.summarize === true ||
      (!usedCustomExtractor && options.summarize !== false);
    const researchFolder = await options.getResearchFolder?.();
    if (researchFolder) {
      const domain = domainFromUrl(url);
      const page = pageSlugFromUrl(url);
      const rawPath = `search-results/${researchFolder}/raw/${domain}`;

      if (html) {
        await writeAppFile({
          subfolder: rawPath,
          filename: `${page}.html`,
          content: html,
        });
      }

      if (content) {
        await writeAppFile({
          subfolder: rawPath,
          filename: `${page}-content.html`,
          content,
        });
      }

      if (shouldSummarize && content.trim() && options.model) {
        try {
          const summary = await summarizeContent(options.model, content, options.query);
          if (summary) {
            await writeAppFile({
              subfolder: rawPath,
              filename: `${page}-summary.md`,
              content: summary,
            });
          }
          return summary;
        } catch {}
      }
    } else if (
      shouldSummarize &&
      content.trim() &&
      options.model
    ) {
      try {
        return await summarizeContent(options.model, content, options.query);
      } catch {}
    }
  }

  return content;
}

export const extractPageContentInputSchema = z.object({
  url: z.string().describe("URL to extract content from"),
  query: z
    .string()
    .optional()
    .describe("What to look for on the page (focuses the summary)"),
  summarize: z
    .boolean()
    .optional()
    .describe(
      "Summarize the content before returning it. Set to false if you need the full page information.",
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
) {
  return tool({
    description:
      "Extract the HTML content of a web page with scripts, styles, and non-content elements stripped. Use this to read the full content of a URL found during research. Raw HTML and sanitized content are automatically saved to the research folder.",
    strict: true,
    inputSchema: zodSchema(extractPageContentInputSchema),
    outputSchema: zodSchema(z.string().describe("Extracted page content")),
    execute: async ({ url, query, summarize: doSummarize, method }) => {
      try {
        validateUrl(url);
      } catch (e) {
        if (e instanceof UrlValidationError) return `Error: ${e.message}`;
        throw e;
      }
      return extractPageContent(url, {
        query,
        summarize: doSummarize,
        method,
        model,
        getResearchFolder,
      });
    },
  });
}
