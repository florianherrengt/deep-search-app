import { load, type CheerioAPI } from "cheerio";
import { PageExtractor } from "./base-extractor";
import type { WebViewExtractorOptions } from "./reddit-extractor";

type WebViewExtractor = (
  url: string,
  options?: WebViewExtractorOptions,
) => Promise<string | null>;

let getExtractViaWebview: WebViewExtractor | null = null;

export function setAmazonWebViewExtractor(fn: WebViewExtractor): void {
  getExtractViaWebview = fn;
}

const AMAZON_TLDS = [
  "amazon.com",
  "amazon.co.uk",
  "amazon.de",
  "amazon.fr",
  "amazon.it",
  "amazon.es",
  "amazon.nl",
  "amazon.se",
  "amazon.pl",
  "amazon.be",
  "amazon.com.be",
  "amazon.co.jp",
  "amazon.jp",
  "amazon.ca",
  "amazon.com.au",
  "amazon.com.br",
  "amazon.com.mx",
  "amazon.in",
  "amazon.sg",
  "amazon.ae",
  "amazon.sa",
  "amazon.com.tr",
  "amazon.eg",
  "amazon.cn",
];

function isAmazonUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      AMAZON_TLDS.some((tld) => host === tld || host.endsWith(`.${tld}`)) &&
      /\/dp\/[A-Z0-9]{10}/i.test(url)
    );
  } catch {
    return false;
  }
}

async function extractViaWebview(
  url: string,
  options?: Parameters<WebViewExtractor>[1],
): Promise<string | null> {
  if (!getExtractViaWebview) return null;
  return getExtractViaWebview(url, options);
}

function normalizeText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isAmazonChallengePage(html: string): boolean {
  const $ = load(html);
  const bodyText = normalizeText($("body").text()).toLowerCase();

  if ($("#productTitle").length > 0) return false;

  return [
    "enter the characters you see below",
    "sorry, we just need to make sure you're not a robot",
    "type the characters you see in this image",
    "captcha",
    "are you a robot",
    "sorry, something went wrong",
  ].some((marker) => bodyText.includes(marker));
}

function extractPrice($: CheerioAPI): string | null {
  const priceEl = $(
    "#priceblock_ourprice, #priceblock_dealprice, #priceblock_saleprice, .apexPriceToPay .a-price .a-offscreen, #corePrice_feature_div .a-price .a-offscreen, .a-price .a-offscreen",
  ).first();
  if (priceEl.length) return normalizeText(priceEl.text());

  const whole = $("span.a-price-whole").first().text().replace(/\.$/, "").trim();
  const fraction = $("span.a-price-fraction").first().text().trim();
  const symbol = $("span.a-price-symbol").first().text().trim();
  if (whole && fraction) return `${symbol}${whole}.${fraction}`;

  return null;
}

function extractRating($: CheerioAPI): string | null {
  const iconAlt = $("#acrPopover span.a-icon-alt").first().text().trim();
  if (iconAlt) return iconAlt;
  const reviewStars = $('[data-automation-id="reviews-stars"] span').first().text().trim();
  if (reviewStars) return reviewStars;
  return null;
}

function extractReviewCount($: CheerioAPI): string | null {
  const el = $("#acrCustomerReviewText").first();
  return el.length ? normalizeText(el.text()) : null;
}

function extractBrand($: CheerioAPI): string | null {
  const byline = $("a#bylineInfo").first().text().trim();
  if (!byline) return null;
  return byline
    .replace(/^Visit the\s+/i, "")
    .replace(/\s+Store$/i, "")
    .replace(/^Brand:\s*/i, "")
    .trim();
}

function extractBreadcrumbs($: CheerioAPI): string[] {
  return [
    ...$("#wayfinding-breadcrumbs_container ul li a").map(
      (_, el) => normalizeText($(el).text()),
    ),
  ].filter(Boolean);
}

function extractBullets($: CheerioAPI): string[] {
  return [
    ...$(
      "#feature-bullets ul.a-unordered-list li span.a-list-item",
    ).map((_, el) => normalizeText($(el).text())),
  ].filter(Boolean);
}

function extractInlineSpecs($: CheerioAPI): Record<string, string> {
  const specs: Record<string, string> = {};
  $("#productOverview_feature_div table tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length >= 2) {
      const key = normalizeText($(cells[0]).text());
      const value = normalizeText($(cells[1]).text());
      if (key && value) specs[key] = value;
    }
  });
  return specs;
}

const EXPANDER_NOISE = [
  "Brief content visible, double tap to read full content.",
  "Full content visible, double tap to read brief content.",
  "Read more",
  "Read less",
];

function cleanReviewBody(text: string): string {
  let cleaned = text;
  for (const noise of EXPANDER_NOISE) {
    cleaned = cleaned.split(noise).join("");
  }
  return normalizeText(cleaned);
}

interface ExtractedReview {
  rating: string | null;
  title: string | null;
  author: string | null;
  date: string | null;
  body: string | null;
  helpful: string | null;
}

function extractReviews($: CheerioAPI, maxReviews = 10): ExtractedReview[] {
  const reviews: ExtractedReview[] = [];
  $('[data-hook="review"]').each((_, el) => {
    if (reviews.length >= maxReviews) return;
    const review = $(el);
    const rating = review
      .find('[data-hook="review-star-rating"] span.a-icon-alt')
      .first()
      .text()
      .trim() || null;
    const title = normalizeText(
      review
        .find('[data-hook="reviewTitle"], h5[data-hook="reviewTitle"]')
        .first()
        .text(),
    ) || null;
    const author = normalizeText(review.find(".a-profile-name").first().text()) || null;
    const date = normalizeText(
      review.find('[data-hook="review-date"]').first().text(),
    ) || null;
    const rawBody = review.find('[data-hook="reviewText"]').first().text() || "";
    const body = cleanReviewBody(rawBody) || null;
    const helpful = normalizeText(
      review.find('[data-hook="helpful-vote-statement"]').first().text(),
    ) || null;
    reviews.push({ rating, title, author, date, body, helpful });
  });
  return reviews;
}

function isUnavailable($: CheerioAPI): boolean {
  if ($("#outOfStock").length > 0) return true;
  const availabilityText = normalizeText(
    $("#availability .primary-availability-message").first().text(),
  ).toLowerCase();
  if (availabilityText.includes("currently unavailable")) return true;
  return false;
}

function parseAmazonProductHtml(html: string): string | null {
  const $ = load(html);

  if (isUnavailable($)) return "Currently unavailable.";

  const title = normalizeText(
    $("#productTitle").first().text() ||
      $("[data-automation-id='title']").first().text() ||
      $("meta[property='og:title']").attr("content") ||
      "",
  );
  if (!title) return null;

  const price = extractPrice($);
  const rating = extractRating($);
  const reviewCount = extractReviewCount($);
  const brand = extractBrand($);
  const breadcrumbs = extractBreadcrumbs($);
  const bullets = extractBullets($);
  const specs = extractInlineSpecs($);
  const reviews = extractReviews($);

  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push("");

  if (brand) lines.push(`**Brand:** ${brand}`);
  if (price) lines.push(`**Price:** ${price}`);
  if (rating) lines.push(`**Rating:** ${rating}`);
  if (reviewCount) lines.push(`**Reviews:** ${reviewCount}`);
  if (breadcrumbs.length > 0) {
    lines.push(`**Category:** ${breadcrumbs.join(" > ")}`);
  }
  lines.push("");

  const specEntries = Object.entries(specs);
  if (specEntries.length > 0) {
    lines.push("## Specifications");
    lines.push("");
    for (const [key, value] of specEntries) {
      lines.push(`- **${key}** ${value}`);
    }
    lines.push("");
  }

  if (bullets.length > 0) {
    lines.push("## About This Item");
    lines.push("");
    for (const bullet of bullets) {
      lines.push(`- ${bullet}`);
    }
    lines.push("");
  }

  if (reviews.length > 0) {
    lines.push("## Customer Reviews");
    lines.push("");
    for (const review of reviews) {
      const parts: string[] = [];
      if (review.body) parts.push(review.body);
      if (review.helpful) parts.push(`*${review.helpful}*`);
      if (parts.length > 0) lines.push(parts.join("\n\n"));
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

export class AmazonExtractor extends PageExtractor {
  canHandle(url: string): boolean {
    return isAmazonUrl(url);
  }

  async extract(url: string): Promise<string> {
    const html = await extractViaWebview(url, {
      shouldRetry: isAmazonChallengePage,
      maxWaitMs: 3 * 60_000,
      retryIntervalMs: 3_000,
    });
    if (!html) return "";

    const result = parseAmazonProductHtml(html);
    return result ?? "";
  }
}
