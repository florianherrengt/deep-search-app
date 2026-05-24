import { load } from "cheerio";
import { PageExtractor } from "./base-extractor";
import { parseRedditJson, type RedditComment, type RedditPost } from "./reddit-json-parser";

type WebViewExtractor = (url: string) => Promise<string | null>;

let getExtractViaWebview: WebViewExtractor | null = null;

export function setWebViewExtractor(fn: WebViewExtractor): void {
  getExtractViaWebview = fn;
}

function isRedditUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "reddit.com" || host.endsWith(".reddit.com");
  } catch {
    return false;
  }
}

function toOldRedditUrl(url: string): string {
  const u = new URL(url);
  u.hostname = "old.reddit.com";
  return u.toString();
}

async function extractViaWebview(url: string): Promise<string | null> {
  if (!getExtractViaWebview) return null;
  return getExtractViaWebview(url);
}

function parseOldRedditHtml(html: string): string | null {
  const $ = load(html);

  const title = $("p.title > a.title").first().text().trim();
  if (!title) return null;

  const author = $(".tagline .author").first().text().trim();
  const selftext = $(".expando .usertext-body").first().text().trim();

  const comments: RedditComment[] = [];
  $(".comment").each((_, el) => {
    const cAuthor = $(el).find(".tagline .author").first().text().trim();
    const cBody = $(el).find(".usertext-body").first().text().trim();
    const cScore = parseInt($(el).find(".score.unvoted").first().text(), 10) || 0;
    comments.push({
      author: cAuthor || "[deleted]",
      body: cBody,
      score: cScore,
      created_utc: 0,
      replies: [],
    });
  });

  const post: RedditPost = {
    title,
    selftext,
    author: author || "[unknown]",
    score: 0,
    created_utc: 0,
    num_comments: comments.length,
  };

  return parseRedditJson(post, comments);
}

export class RedditExtractor extends PageExtractor {
  canHandle(url: string): boolean {
    return isRedditUrl(url);
  }

  async extract(url: string): Promise<string> {
    if (url.includes(".json")) return "";

    const html = await extractViaWebview(toOldRedditUrl(url));
    if (!html) return "";

    const result = parseOldRedditHtml(html);
    return result ?? "";
  }
}
