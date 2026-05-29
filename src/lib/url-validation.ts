const BLOCKED_SCHEMES = ["file:", "data:", "javascript:", "vbscript:", "tauri:", "about:", "blob:"];

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
]);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
  if (octets[0] === 198 && octets[1] === 18) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (bare === "::1") return true;
  if (bare.startsWith("fc") || bare.startsWith("fd")) return true;
  if (bare.startsWith("fe80")) return true;
  if (bare.startsWith("fc00") || bare.startsWith("fd00")) return true;
  return false;
}

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlValidationError";
  }
}

export function validateUrl(raw: string): URL {
  const trimmed = raw.trim();

  for (const scheme of BLOCKED_SCHEMES) {
    if (trimmed.toLowerCase().startsWith(scheme)) {
      throw new UrlValidationError(`Blocked scheme: ${scheme}`);
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UrlValidationError(`Invalid URL: ${trimmed}`);
  }

  if (parsed.protocol !== "https:") {
    throw new UrlValidationError(`Only https URLs are allowed, got: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (PRIVATE_HOSTNAMES.has(hostname)) {
    throw new UrlValidationError(`Private/loopback hostname not allowed: ${hostname}`);
  }

  if (hostname.endsWith(".local") || hostname.endsWith(".localhost")) {
    throw new UrlValidationError(`Local hostname not allowed: ${hostname}`);
  }

  if (isPrivateIpv4(hostname)) {
    throw new UrlValidationError(`Private IPv4 address not allowed: ${hostname}`);
  }

  if (isPrivateIpv6(hostname)) {
    throw new UrlValidationError(`Private IPv6 address not allowed: ${hostname}`);
  }

  return parsed;
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
  const trimmed = raw.trim();

  for (const scheme of BLOCKED_SCHEMES) {
    if (trimmed.toLowerCase().startsWith(scheme)) {
      throw new UrlValidationError(`Blocked scheme: ${scheme}`);
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UrlValidationError(`Invalid URL: ${trimmed}`);
  }

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
