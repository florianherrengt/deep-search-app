import {
  UrlValidationError,
  validateUrl,
} from "deep-search-core/search-extract/core";

const BLOCKED_SCHEMES = ["file:", "data:", "javascript:", "vbscript:", "tauri:", "about:", "blob:"];

export { UrlValidationError, validateUrl };

function parseServiceUrl(raw: string): URL {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  const blockedScheme = BLOCKED_SCHEMES.find((scheme) =>
    lower.startsWith(scheme),
  );

  if (blockedScheme) {
    throw new UrlValidationError(`Blocked scheme: ${blockedScheme}`);
  }

  try {
    return new URL(trimmed);
  } catch {
    throw new UrlValidationError(`Invalid URL: ${trimmed}`);
  }
}

export function isValidUrl(raw: string): boolean {
  try {
    validateUrl(raw);
    return true;
  } catch {
    return false;
  }
}

export function validateServiceUrl(raw: string): URL {
  const parsed = parseServiceUrl(raw);

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new UrlValidationError(`Only http or https service URLs are allowed, got: ${parsed.protocol}`);
  }

  if (!parsed.hostname) {
    throw new UrlValidationError("Service URL must include a hostname.");
  }

  return parsed;
}

export function isValidServiceUrl(raw: string): boolean {
  try {
    validateServiceUrl(raw);
    return true;
  } catch {
    return false;
  }
}
