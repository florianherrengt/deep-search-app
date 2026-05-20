import * as cheerio from "cheerio";
import TurndownService from "turndown";

const NOISE =
  "script,style,nav,footer,header,aside,noscript,iframe,svg";
const MAIN_SELECTORS = ["article", "main", "[role='main']", "body"];

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim() ?? "";
}

export function stripNoise(html: string): string {
  const $ = cheerio.load(html);
  $(NOISE).remove();
  for (const sel of MAIN_SELECTORS) {
    const el = $(sel);
    if (el.length) return el.first().html() ?? "";
  }
  return html;
}

export function htmlToMarkdown(html: string): string {
  return turndown
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
