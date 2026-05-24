import { load, type CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { PageExtractor } from "./base-extractor";
import { parseRedditJson, type RedditComment, type RedditPost } from "./reddit-json-parser";

export interface WebViewExtractorOptions {
  shouldRetry?: (html: string) => boolean;
  maxWaitMs?: number;
  retryIntervalMs?: number;
}

type WebViewExtractor = (
  url: string,
  options?: WebViewExtractorOptions,
) => Promise<string | null>;

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

async function extractViaWebview(
  url: string,
  options?: WebViewExtractorOptions,
): Promise<string | null> {
  if (!getExtractViaWebview) return null;
  return getExtractViaWebview(url, options);
}

function normalizeText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseScore(text: string | undefined, fallback = 0): number {
  if (!text) return fallback;
  const score = Number.parseInt(text, 10);
  return Number.isFinite(score) ? score : fallback;
}

function directCommentElements(
  $: CheerioAPI,
  el: Element,
) {
  return $(el).children(".child").children(".sitetable").children(".thing.comment");
}

function findPostElement($: CheerioAPI) {
  return $(
    ".thing.link, .thing.self, .thing[data-fullname^='t3_'], .thing[id^='thing_t3_']",
  ).first();
}

function findPostTitle($: CheerioAPI, postEl = findPostElement($)): string {
  return normalizeText(
    postEl.find("p.title a.title, a.title").first().text() ||
      $("p.title a.title, a.title").first().text() ||
      $("meta[property='og:title']").attr("content") ||
      $("title").first().text().replace(/\s*:\s*.+$/, ""),
  );
}

function hasOldRedditPostContent(html: string): boolean {
  const $ = load(html);
  return findPostTitle($).length > 0 && $(".commentarea, .thing.comment").length > 0;
}

export function isRedditChallengeHtml(html: string): boolean {
  if (hasOldRedditPostContent(html)) return false;

  const $ = load(html);
  const bodyText = normalizeText($("body").text()).toLowerCase();
  const hasChallengeElement =
    $("#challenge-form").length > 0 ||
    $(".g-recaptcha, .h-captcha").length > 0 ||
    $("[class*='cf-challenge']").length > 0 ||
    $("iframe[src*='recaptcha'], iframe[src*='hcaptcha']").length > 0;

  if (hasChallengeElement) return true;

  return [
    "captcha challenge",
    "captcha required",
    "verify you are human",
    "checking if the site connection is secure",
    "checking your browser",
    "are you a robot",
    "security check",
  ].some((marker) => bodyText.includes(marker));
}

function parseOldRedditHtml(html: string): string | null {
  const $ = load(html);

  const postEl = findPostElement($);
  const title = findPostTitle($, postEl);
  if (!title) return null;

  const author =
    postEl.attr("data-author") ||
    normalizeText(postEl.find(".tagline .author").first().text());
  const score = parseScore(
    postEl.attr("data-score") ||
      normalizeText(postEl.find(".score.unvoted").first().text()),
  );
  const selftext = normalizeText(
    postEl.find(".expando .usertext-body, .entry .usertext-body, .usertext-body").first().text(),
  );

  function parseComment(el: Element): RedditComment {
    const commentEl = $(el);
    const entry = commentEl.children(".entry").first();
    const cAuthor =
      commentEl.attr("data-author") ||
      normalizeText(entry.find(".tagline .author").first().text());
    const cBody = normalizeText(
      entry.find(".usertext-body .md, .usertext-body").first().text(),
    );
    const cScore = parseScore(
      commentEl.attr("data-score") ||
        normalizeText(entry.find(".score.unvoted").first().text()),
    );
    const replies: RedditComment[] = [];

    directCommentElements($, el).each((_, child) => {
      replies.push(parseComment(child));
    });

    return {
      author: cAuthor || "[deleted]",
      body: cBody || "[deleted]",
      score: cScore,
      created_utc: 0,
      replies,
    };
  }

  let topLevelComments = $(".commentarea > .sitetable > .thing.comment");
  if (topLevelComments.length === 0) {
    topLevelComments = $(".thing.comment").filter(
      (_, el) => $(el).parents(".thing.comment").length === 0,
    );
  }

  const comments: RedditComment[] = [];
  topLevelComments.each((_, el) => {
    comments.push(parseComment(el));
  });

  const post: RedditPost = {
    title,
    selftext,
    author: author || "[unknown]",
    score,
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

    const html = await extractViaWebview(toOldRedditUrl(url), {
      shouldRetry: isRedditChallengeHtml,
      maxWaitMs: 5 * 60_000,
      retryIntervalMs: 5_000,
    });
    if (!html) return "";

    const result = parseOldRedditHtml(html);
    return result ?? "";
  }
}
