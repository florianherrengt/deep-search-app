import { load } from "cheerio";
import { PageExtractor } from "./base-extractor";
import type { WebViewExtractorOptions } from "./reddit-extractor";

type WebViewExtractor = (
  url: string,
  options?: WebViewExtractorOptions,
) => Promise<string | null>;

let getExtractViaWebview: WebViewExtractor | null = null;

export function setShopifyWebViewExtractor(fn: WebViewExtractor): void {
  getExtractViaWebview = fn;
}

function isShopifyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "myshopify.com" || host.endsWith(".myshopify.com");
  } catch {
    return false;
  }
}

function isProductPageUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return /\/products\/[a-z0-9][a-z0-9-]+[a-z0-9]$/i.test(path);
  } catch {
    return false;
  }
}

function toApiUrl(url: string, ext: ".js" | ".json"): string {
  const u = new URL(url);
  u.pathname = u.pathname.endsWith(".json") || u.pathname.endsWith(".js")
    ? u.pathname.replace(/\.(json|js)$/, ext)
    : `${u.pathname}${ext}`;
  u.search = "";
  u.hash = "";
  return u.toString();
}

interface ShopifyOption {
  name: string;
  values: string[];
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  JPY: "¥",
  CAD: "C$",
  AUD: "A$",
  CHF: "CHF",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  NZD: "NZ$",
  BRL: "R$",
  INR: "₹",
  KRW: "₩",
  CNY: "¥",
  PLN: "zł",
  SGD: "S$",
  HKD: "HK$",
};

function formatCurrency(code: string | undefined, amount: string): string {
  if (!code) return amount;
  const sym = CURRENCY_SYMBOLS[code];
  return sym ? `${sym}${amount}` : `${amount} ${code}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCentsPrice(
  cents: number,
  currency?: string,
): string {
  const amount = (cents / 100).toFixed(2);
  return formatCurrency(currency, amount);
}

function extractCurrency(
  jsonData: Record<string, unknown> | null,
): string | undefined {
  if (!jsonData?.product) return undefined;
  const variants = (jsonData.product as Record<string, unknown>)
    .variants as Array<{ price_currency?: string }> | undefined;
  return variants?.[0]?.price_currency;
}

function formatJsProduct(
  data: Record<string, unknown>,
  currency?: string,
): string | null {
  if (!data?.id || !data?.title) return null;

  const lines: string[] = [];
  const title = String(data.title);
  const vendor = data.vendor ? String(data.vendor) : null;
  const productType = data.type ? String(data.type) : null;
  const description = data.description ? stripHtml(String(data.description)) : null;
  const rawOptions = data.options ?? [];
  const options = Array.isArray(rawOptions)
    ? rawOptions.filter(
        (o): o is ShopifyOption =>
          o != null &&
          typeof o === "object" &&
          typeof o.name === "string" &&
          Array.isArray(o.values) &&
          o.values.every((v: unknown) => typeof v === "string"),
      )
    : [];
  const rawTags = data.tags;
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((t): t is string => typeof t === "string")
    : typeof rawTags === "string"
      ? rawTags.split(", ")
      : null;

  const rawPriceMin = data.price_min;
  const priceMin = typeof rawPriceMin === "number" && Number.isFinite(rawPriceMin) ? rawPriceMin : undefined;
  const rawPriceMax = data.price_max;
  const priceMax = typeof rawPriceMax === "number" && Number.isFinite(rawPriceMax) ? rawPriceMax : undefined;
  const rawCompareAtPriceMax = data.compare_at_price_max;
  const compareAtPriceMax = typeof rawCompareAtPriceMax === "number" && Number.isFinite(rawCompareAtPriceMax) ? rawCompareAtPriceMax : undefined;

  lines.push(`# ${title}`);
  lines.push("");

  if (vendor) lines.push(`**Vendor:** ${vendor}`);
  if (productType) lines.push(`**Type:** ${productType}`);

  if (priceMin != null) {
    const pMin = formatCentsPrice(priceMin, currency);
    const pMax =
      priceMax != null ? formatCentsPrice(priceMax, currency) : null;
    const priceStr = pMax && pMin !== pMax ? `${pMin} – ${pMax}` : pMin;
    lines.push(`**Price:** ${priceStr}`);

    if (
      compareAtPriceMax != null &&
      compareAtPriceMax > (priceMax ?? priceMin)
    ) {
      lines.push(`**Was:** ${formatCentsPrice(compareAtPriceMax, currency)}`);
    }
  }

  lines.push("");

  if (description) {
    lines.push(description);
    lines.push("");
  }

  if (options.length > 0) {
    lines.push("## Options");
    lines.push("");
    for (const option of options) {
      lines.push(`- **${option.name}:** ${option.values.join(", ")}`);
    }
    lines.push("");
  }

  if (tags) {
    const tagList = tags
      .filter(Boolean)
      .filter((t) => !t.startsWith("category-") && !t.startsWith("pri-"));
    if (tagList.length > 0 && tagList.length <= 20) {
      lines.push(`**Tags:** ${tagList.join(", ")}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function formatJsonProduct(data: Record<string, unknown>): string | null {
  const product = data.product as Record<string, unknown> | undefined;
  if (!product?.id || !product?.title) return null;

  const lines: string[] = [];
  const title = String(product.title);
  const vendor = product.vendor ? String(product.vendor) : null;
  const productType = product.product_type
    ? String(product.product_type)
    : null;
  const bodyHtml = product.body_html ? String(product.body_html) : null;
  const description = bodyHtml ? stripHtml(bodyHtml) : null;
  const rawOptions = product.options ?? [];
  const options = Array.isArray(rawOptions)
    ? rawOptions.filter(
        (o): o is ShopifyOption =>
          o != null &&
          typeof o === "object" &&
          typeof o.name === "string" &&
          Array.isArray(o.values) &&
          o.values.every((v: unknown) => typeof v === "string"),
      )
    : [];
  const rawTags = product.tags ? String(product.tags) : null;

  interface JsonVariant {
    price: string;
    compare_at_price: string | null;
    price_currency?: string;
  }
  const rawVariants = product.variants ?? [];
  const variants = Array.isArray(rawVariants)
    ? rawVariants.filter(
        (v): v is JsonVariant =>
          v != null &&
          typeof v === "object" &&
          typeof (v as Record<string, unknown>).price === "string",
      )
    : [];

  lines.push(`# ${title}`);
  lines.push("");

  if (vendor) lines.push(`**Vendor:** ${vendor}`);
  if (productType) lines.push(`**Type:** ${productType}`);

  if (variants.length > 0) {
    const currency = variants[0].price_currency;
    const prices = [
      ...new Set(
        variants
          .map((v) => Number(v.price))
          .filter((n) => Number.isFinite(n)),
      ),
    ];
    if (prices.length === 0) {
      lines.push("");
    } else {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const priceStr =
        min === max
          ? formatCurrency(currency, min.toFixed(2))
          : `${formatCurrency(currency, min.toFixed(2))} – ${formatCurrency(currency, max.toFixed(2))}`;
      lines.push(`**Price:** ${priceStr}`);

      const hasDiscount = variants.some(
        (v) =>
          v.compare_at_price &&
          Number.isFinite(Number(v.compare_at_price)) &&
          Number.isFinite(Number(v.price)) &&
          Number(v.compare_at_price) > Number(v.price),
      );
      if (hasDiscount) {
        const comparePrices = variants
          .map((v) => v.compare_at_price)
          .filter((p): p is string => p != null)
          .map(Number)
          .filter(Number.isFinite);
        if (comparePrices.length > 0) {
          const maxCompare = Math.max(...comparePrices);
          if (maxCompare > max) {
            lines.push(`**Was:** ${formatCurrency(currency, maxCompare.toFixed(2))}`);
          }
        }
      }
    }
  }

  lines.push("");

  if (description) {
    lines.push(description);
    lines.push("");
  }

  if (options.length > 0) {
    lines.push("## Options");
    lines.push("");
    for (const option of options) {
      lines.push(`- **${option.name}:** ${option.values.join(", ")}`);
    }
    lines.push("");
  }

  if (rawTags) {
    const tagList = rawTags
      .split(", ")
      .filter(Boolean)
      .filter((t) => !t.startsWith("category-") && !t.startsWith("pri-"));
    if (tagList.length > 0 && tagList.length <= 20) {
      lines.push(`**Tags:** ${tagList.join(", ")}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function parseJsonFromHtml(html: string): Record<string, unknown> | null {
  const $ = load(html);
  let jsonText = $("pre").first().text();
  if (!jsonText) jsonText = $("body").text();
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class ShopifyExtractor extends PageExtractor {
  canHandle(url: string): boolean {
    return isShopifyUrl(url) && isProductPageUrl(url);
  }

  async extract(url: string): Promise<string> {
    if (!getExtractViaWebview) return "";

    const [jsHtml, jsonHtml] = await Promise.all([
      getExtractViaWebview(toApiUrl(url, ".js")),
      getExtractViaWebview(toApiUrl(url, ".json")),
    ]);

    const jsData = jsHtml ? parseJsonFromHtml(jsHtml) : null;
    const jsonData = jsonHtml ? parseJsonFromHtml(jsonHtml) : null;

    if (jsData && jsData.id && jsData.title) {
      const currency = extractCurrency(jsonData);
      return formatJsProduct(jsData, currency) ?? "";
    }

    if (jsonData && jsonData.product) {
      const product = jsonData.product as Record<string, unknown>;
      if (product?.id && product?.title) {
        return formatJsonProduct(jsonData) ?? "";
      }
    }

    return "";
  }
}
