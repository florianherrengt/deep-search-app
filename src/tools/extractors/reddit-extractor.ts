import { fetch } from "@tauri-apps/plugin-http";
import { PageExtractor } from "./base-extractor";
import { parseRedditJson, type RedditComment, type RedditPost } from "./reddit-json-parser";

const FETCH_TIMEOUT_MS = 10_000;

function isRedditUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "reddit.com" || host.endsWith(".reddit.com");
  } catch {
    return false;
  }
}

function toJsonUrl(url: string): string {
  const u = new URL(url);
  u.hostname = "www.reddit.com";
  const path = u.pathname.replace(/\/$/, "");
  return `https://www.reddit.com${path}.json`;
}

function toOldRedditUrl(url: string): string {
  const u = new URL(url);
  u.hostname = "old.reddit.com";
  return u.toString();
}

interface RawComment {
  kind: string;
  data: {
    author: string;
    body: string;
    score: number;
    created_utc: number;
    replies: unknown;
  };
}

function parseReplies(replies: unknown): RedditComment[] {
  if (!replies || typeof replies === "string") return [];
  const listing = replies as { data: { children: RawComment[] } };
  if (!listing.data?.children) return [];
  return listing.data.children
    .filter((c) => c.kind === "t1")
    .map((c) => ({
      author: c.data.author,
      body: c.data.body,
      score: c.data.score,
      created_utc: c.data.created_utc,
      replies: parseReplies(c.data.replies),
    }));
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchJson(url: string): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch {
    return null;
  }
}

function isChallengePage(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("please wait for verification") ||
    lower.includes("are you a robot") ||
    lower.includes("are you human") ||
    lower.includes("cf-challenge") ||
    lower.includes("captcha") ||
    lower.includes("blocked") ||
    lower.includes("access denied")
  );
}

async function extractViaJson(url: string): Promise<string | null> {
  const jsonUrl = toJsonUrl(url);
  const response = await fetchJson(jsonUrl);
  if (!response || response.status !== 200) return null;

  try {
    const text = await response.text();
    if (isChallengePage(text)) return null;

    const data = JSON.parse(text) as Array<{
      data: { children: Array<{ kind: string; data: Record<string, unknown> }> };
    }>;

    const postData = data[0]?.data?.children?.[0]?.data;
    if (!postData || !postData.title) return null;

    const post: RedditPost = {
      title: postData.title as string,
      selftext: (postData.selftext as string) ?? "",
      author: (postData.author as string) ?? "[deleted]",
      score: (postData.score as number) ?? 0,
      created_utc: (postData.created_utc as number) ?? 0,
      num_comments: (postData.num_comments as number) ?? 0,
    };

    const rawComments = (data[1]?.data?.children ?? []) as RawComment[];
    const comments: RedditComment[] = rawComments
      .filter((c) => c.kind === "t1")
      .map((c) => ({
        author: c.data.author || "[deleted]",
        body: c.data.body || "[deleted]",
        score: c.data.score,
        created_utc: c.data.created_utc,
        replies: parseReplies(c.data.replies),
      }));

    return parseRedditJson(post, comments);
  } catch {
    return null;
  }
}

async function extractViaOldReddit(url: string): Promise<string | null> {
  const oldUrl = toOldRedditUrl(url);
  const response = await fetchHtml(oldUrl);
  if (!response) return null;

  try {
    const html = await response.text();
    if (!html || isChallengePage(html)) return null;

    const { load } = await import("cheerio");
    const $ = load(html);

    const title = $("p.title > a.title").first().text().trim();
    const author = $(".tagline .author").first().text().trim();
    const selftext = $(".expando .usertext-body").first().text().trim();

    if (!title) return null;

    interface OldComment {
      author: string;
      body: string;
      score: number;
    }

    const comments: OldComment[] = [];
    $(".comment").each((_, el) => {
      const cAuthor = $(el).find(".tagline .author").first().text().trim();
      const cBody = $(el).find(".usertext-body").first().text().trim();
      const cScore = parseInt($(el).find(".score.unvoted").first().text(), 10) || 0;
      comments.push({ author: cAuthor, body: cBody, score: cScore });
    });

    const post: RedditPost = {
      title,
      selftext,
      author: author || "[unknown]",
      score: 0,
      created_utc: 0,
      num_comments: comments.length,
    };

    const redditComments: RedditComment[] = comments.map((c) => ({
      author: c.author || "[deleted]",
      body: c.body,
      score: c.score,
      created_utc: 0,
      replies: [],
    }));

    return parseRedditJson(post, redditComments);
  } catch {
    return null;
  }
}

export class RedditExtractor extends PageExtractor {
  canHandle(url: string): boolean {
    return isRedditUrl(url);
  }

  async extract(url: string): Promise<string> {
    if (url.includes(".json")) return "";

    const jsonResult = await extractViaJson(url);
    if (jsonResult) return jsonResult;

    const oldResult = await extractViaOldReddit(url);
    if (oldResult) return oldResult;

    return "";
  }
}
