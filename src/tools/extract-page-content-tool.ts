import { tool, zodSchema, generateText, type LanguageModel } from "ai";
import { load, type CheerioAPI } from "cheerio";
import type { AnyNode, Element, Text } from "domhandler";
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

const STRUCTURAL_PRUNE_TAGS = [
  "audio",
  "base",
  "canvas",
  "embed",
  "footer",
  "head",
  "header",
  "iframe",
  "link",
  "map",
  "meta",
  "nav",
  "noscript",
  "object",
  "picture",
  "script",
  "source",
  "style",
  "svg",
  "template",
  "title",
  "track",
  "video",
  "aside",
] as const;

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "blockquote",
  "body",
  "caption",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "html",
  "li",
  "main",
  "menu",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
  "ul",
]);

const TABLE_CELL_TAGS = new Set(["td", "th"]);
const PRUNED_ROLE_VALUES = new Set([
  "alertdialog",
  "banner",
  "complementary",
  "contentinfo",
  "dialog",
  "navigation",
]);

const NOISE_ATTRIBUTE_PATTERN =
  /\b(cookie|cookies|consent|gdpr|ccpa|privacy[-_\s]?choices|popup|pop[-_\s]?up|popover|modal|overlay|newsletter|captcha|recaptcha|hcaptcha|interstitial|tracking|tracker|beacon|pixel|ad[-_\s]?(slot|container|banner|unit)|advertisement)\b/i;

const MAX_REPEATED_LINE_OCCURRENCES = 2;

function isTextNode(node: AnyNode): node is Text {
  return node.type === "text";
}

function isElementNode(node: AnyNode): node is Element {
  return "tagName" in node && "children" in node;
}

function tagName(node: Element): string {
  return node.tagName.toLowerCase();
}

function normalizeInlineWhitespace(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/[^\S\n]+/g, " ").trim();
}

function shouldAddSpace(previous: string | undefined, next: string): boolean {
  if (!previous || previous === "\n") return false;
  if (/\s$/.test(previous)) return false;
  if (/^[,.;:!?%)\]}]/.test(next)) return false;
  if (/[([{]$/.test(previous)) return false;
  return true;
}

function appendText(parts: string[], text: string) {
  const normalized = normalizeInlineWhitespace(text);
  if (!normalized) return;

  const previous = parts[parts.length - 1];
  if (shouldAddSpace(previous, normalized)) {
    parts.push(" ");
  }
  parts.push(normalized);
}

function appendBreak(parts: string[]) {
  if (parts.length === 0 || parts[parts.length - 1] === "\n") return;
  parts.push("\n");
}

function appendLine(parts: string[], line: string) {
  const normalized = normalizeInlineWhitespace(line);
  if (!normalized) return;
  appendBreak(parts);
  parts.push(normalized);
  appendBreak(parts);
}

function isHiddenByStyle(style: string | undefined): boolean {
  if (!style) return false;
  const compact = style.replace(/\s+/g, "").toLowerCase();
  return (
    compact.includes("display:none") ||
    compact.includes("visibility:hidden") ||
    compact.includes("visibility:collapse") ||
    compact.includes("opacity:0") ||
    compact.includes("width:0") ||
    compact.includes("height:0")
  );
}

function attributeText($: CheerioAPI, element: Element): string {
  const el = $(element);
  return [
    el.attr("id"),
    el.attr("class"),
    el.attr("role"),
    el.attr("aria-label"),
    el.attr("data-testid"),
    el.attr("data-test"),
    el.attr("name"),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function shouldPruneElement($: CheerioAPI, element: Element): boolean {
  const el = $(element);
  const role = el.attr("role")?.toLowerCase().trim();

  return (
    el.attr("hidden") !== undefined ||
    el.attr("aria-hidden")?.toLowerCase() === "true" ||
    el.attr("type")?.toLowerCase() === "hidden" ||
    isHiddenByStyle(el.attr("style")) ||
    (role !== undefined && PRUNED_ROLE_VALUES.has(role)) ||
    NOISE_ATTRIBUTE_PATTERN.test(attributeText($, element))
  );
}

function pruneDom($: CheerioAPI) {
  $(STRUCTURAL_PRUNE_TAGS.join(",")).remove();
  $("*").each((_, element) => {
    if (isElementNode(element) && shouldPruneElement($, element)) {
      $(element).remove();
    }
  });
}

function collectInlineText($: CheerioAPI, node: AnyNode): string {
  if (isTextNode(node)) {
    return normalizeInlineWhitespace(node.data);
  }
  if (!isElementNode(node)) return "";

  const name = tagName(node);
  if (name === "br") return " ";
  if (name === "tr") {
    const cells = node.children
      .filter(
        (child): child is Element =>
          isElementNode(child) && TABLE_CELL_TAGS.has(tagName(child)),
      )
      .map((cell) => collectInlineText($, cell))
      .filter(Boolean);
    return cells.join(" | ");
  }

  return node.children
    .map((child) => collectInlineText($, child))
    .filter(Boolean)
    .join(" ");
}

function walkTextNode($: CheerioAPI, node: AnyNode, parts: string[]) {
  if (isTextNode(node)) {
    appendText(parts, node.data);
    return;
  }
  if (!isElementNode(node)) return;

  const name = tagName(node);
  if (name === "br") {
    appendBreak(parts);
    return;
  }
  if (name === "hr") {
    appendBreak(parts);
    return;
  }
  if (name === "tr") {
    const cells = node.children
      .filter(
        (child): child is Element =>
          isElementNode(child) && TABLE_CELL_TAGS.has(tagName(child)),
      )
      .map((cell) => collectInlineText($, cell))
      .filter(Boolean);

    if (cells.length > 0) {
      appendLine(parts, cells.join(" | "));
      return;
    }
  }

  const isBlock = BLOCK_TAGS.has(name);
  if (isBlock) appendBreak(parts);
  for (const child of node.children) {
    walkTextNode($, child, parts);
  }
  if (isBlock) appendBreak(parts);
}

function normalizeExtractedText(text: string): string {
  const lines = text
    .replace(/\u00a0/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const occurrences = new Map<string, number>();
  const cappedLines: string[] = [];

  for (const line of lines) {
    const key = line.toLowerCase().replace(/\s+/g, " ");
    const count = occurrences.get(key) ?? 0;
    occurrences.set(key, count + 1);
    if (count >= MAX_REPEATED_LINE_OCCURRENCES) continue;
    cappedLines.push(line);
  }

  return cappedLines.join("\n").trim();
}

export function extractVisibleTextFromHtml(html: string): string {
  const $ = load(html);
  pruneDom($);

  const roots =
    $("body").length > 0
      ? $("body").contents().toArray()
      : $.root().contents().toArray();
  const parts: string[] = [];

  for (const node of roots) {
    walkTextNode($, node, parts);
  }

  return normalizeExtractedText(parts.join(""));
}

export function sanitizeHtml(html: string): string {
  return extractVisibleTextFromHtml(html);
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
      "Extract the plain-text content of a web page with scripts, styles, hidden UI, and obvious boilerplate stripped. Use this to read the content of a URL found during research. Raw HTML and cleaned text are automatically saved to the research folder.",
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
