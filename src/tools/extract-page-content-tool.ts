import { tool, zodSchema, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { fetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import {
  stripNoise,
  htmlToMarkdown,
  extractTitle,
} from "@/lib/content-extraction";

const MIN_CONTENT_LENGTH = 200;
const FETCH_TIMEOUT_MS = 10_000;

const ExtractResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  content: z.string(),
  strategy: z.enum(["fetch", "webview"]),
});

async function fetchHtml(url: string): Promise<string | null> {
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

function processHtml(html: string): string {
  return htmlToMarkdown(stripNoise(html));
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

export function createExtractPageContentTool(model: LanguageModel) {
  return tool({
    description:
      "Extract and summarize the text content of a web page. Use this to read the full content of a URL found during research.",
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
      }),
    ),
    outputSchema: zodSchema(ExtractResultSchema),
    execute: async ({ url, query, summarize: doSummarize }) => {
      let html = await fetchHtml(url);
      let strategy: "fetch" | "webview" = "fetch";

      let markdown = html ? processHtml(html) : "";

      if (markdown.length < MIN_CONTENT_LENGTH) {
        html = await extractViaWebview(url);
        strategy = "webview";
        markdown = html ? processHtml(html) : "";
      }

      const title = html ? extractTitle(html) : "";
      let content = markdown;

      if (doSummarize !== false && markdown.trim()) {
        try {
          content = await summarizeContent(model, markdown, query);
        } catch {}
      }

      return { url, title, content, strategy };
    },
  });
}
