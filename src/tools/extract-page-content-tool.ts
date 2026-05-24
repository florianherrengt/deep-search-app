import { tool, zodSchema, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { fetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";
import { writeAppFile } from "@/lib/app-file-storage";
import { registry } from "./extractors";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

const MIN_CONTENT_LENGTH = 200;
const FETCH_TIMEOUT_MS = 10_000;

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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (response.status >= 400) return null;
    const ct = response.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml"))
      return null;
    return await response.text();
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

function extractReadableContent(html: string, url: string): string | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const base = doc.createElement("base");
  base.href = url;
  doc.head.prepend(base);
  const reader = new Readability(doc);
  const article = reader.parse();
  return article?.content ?? null;
}

function htmlToMarkdown(html: string): string {
  return turndown
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function processHtml(html: string, url: string): string {
  const content = extractReadableContent(html, url);
  if (content) return htmlToMarkdown(content);
  return htmlToMarkdown(html);
}

async function extractViaWebview(url: string): Promise<string | null> {
  const id = `tab-${Date.now()}`;
  try {
    await invoke("open_tab", { url, id });
    const html: string = await invoke("extract_content", { id });
    return html;
  } catch {
    return null;
  } finally {
    try {
      await invoke("close_tab", { id });
    } catch {}
  }
}

export function createExtractPageContentTool(
  model: LanguageModel,
  getResearchFolder: () => Promise<string>,
) {
  return tool({
    description:
      "Extract and summarize the text content of a web page. Use this to read the full content of a URL found during research. Raw HTML, markdown, and summary are automatically saved to the research folder.",
    strict: true,
    inputSchema: zodSchema(
      z.object({
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
      }),
    ),
    outputSchema: zodSchema(z.string().describe("Extracted page content")),
    execute: async ({ url, query, summarize: doSummarize, method }) => {
      const forced = method ?? "auto";
      let html: string | null = null;
      let markdown = "";

      const extractor = registry.find(url);
      if (extractor) {
        markdown = await extractor.extract(url);
      }

      if (!markdown) {
        if (forced === "webview") {
          html = await extractViaWebview(url);
          markdown = html ? processHtml(html, url) : "";
        } else {
          html = await fetchHtml(url);
          markdown = html ? processHtml(html, url) : "";
          if (forced === "auto" && markdown.length < MIN_CONTENT_LENGTH) {
            html = await extractViaWebview(url);
            markdown = html ? processHtml(html, url) : "";
          }
        }
      }

      if (html || markdown) {
        const researchFolder = await getResearchFolder();
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

        if (markdown) {
          await writeAppFile({
            subfolder: rawPath,
            filename: `${page}.md`,
            content: markdown,
          });
        }

        if (doSummarize !== false && markdown.trim()) {
          try {
            const summary = await summarizeContent(model, markdown, query);
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
      }

      return markdown;
    },
  });
}
