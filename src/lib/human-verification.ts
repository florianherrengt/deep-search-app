import {
  isNotificationPermissionGranted,
  requestNotificationPermission,
  sendNotification,
} from "@/lib/tauri-bridge";
import { abortableDelay, throwIfAborted } from "@/lib/abort";

const HUMAN_VERIFICATION_POLL_INTERVAL_MS = 2_000;
const MAX_TEXT_SCAN_CHARS = 20_000;

const GOOGLE_HOST_PATTERN =
  /^(?:[a-z0-9-]+\.)*google\.(?:com|[a-z]{2}|(?:com|co)\.[a-z]{2})$/i;
const RECAPTCHA_CHALLENGE_PATH_PATTERN =
  /^\/recaptcha\/(?:api2|enterprise)\/(?:anchor|bframe)(?:\/|$)/i;

const STRONG_CHALLENGE_PHRASES = [
  "verify you are human",
  "verify that you are human",
  "confirm you are human",
  "are you a robot",
  "unusual traffic from your computer network",
  "complete the security check",
  "captcha required",
  "press and hold to confirm you are a human",
  "confirmez que vous n'êtes pas un robot",
  "confirmez que vous êtes humain",
  "trafic inhabituel provenant de votre réseau informatique",
];

const CHALLENGE_INTERACTIVE_SELECTOR = [
  ".g-recaptcha",
  ".h-captcha",
  "[data-sitekey]",
  "iframe[src*='recaptcha']",
  "iframe[src*='hcaptcha']",
  "iframe[src*='challenges.cloudflare']",
  "form[action*='challenge']",
  "form[action*='captcha']",
  "form[action*='/sorry']",
].join(", ");

const EXPLICIT_CHALLENGE_CONTAINER_SELECTOR = [
  "[role='dialog']",
  "[id*='challenge']",
  "[class*='challenge']",
  "[id*='captcha']",
  "[class*='captcha']",
].join(", ");
const GOOGLE_CONSENT_PATTERN = /before you continue to google|avant d'accéder à google/i;
const GOOGLE_CONSENT_FORM_SELECTOR = [
  "form[action*='consent.google']",
  "form[action='/save']",
  "form[action^='/save?']",
].join(", ");
const EXPLICIT_CHALLENGE_MARKUP_SELECTOR = [
  "#challenge-form",
  ".cf-challenge",
  "form.challenge-form",
].join(", ");

export type HumanVerificationKind = "captcha" | "consent";

export interface HumanVerificationDetection {
  kind: HumanVerificationKind;
  message: string;
}

export interface BrowserSnapshot {
  html: string;
  url?: string;
}

export interface HumanVerificationWaitOptions<TSnapshot extends BrowserSnapshot> {
  getSnapshot: () => Promise<TSnapshot>;
  signal?: AbortSignal;
  onRequired?: (
    detection: HumanVerificationDetection,
  ) => void | Promise<void>;
  onCleared?: () => void | Promise<void>;
  pollIntervalMs?: number;
}

export function detectHumanVerification({
  html,
  url,
}: BrowserSnapshot): HumanVerificationDetection | null {
  const currentUrl = url?.trim() ?? "";
  const parsedUrl = safeUrl(currentUrl);
  const isGoogleSorry = Boolean(
    parsedUrl &&
      isGoogleHostname(parsedUrl.hostname) &&
      /^\/sorry(?:\/|$)/i.test(parsedUrl.pathname),
  );
  const isKnownChallengeUrl = Boolean(
    parsedUrl &&
      (parsedUrl.hostname === "challenges.cloudflare.com" ||
        /^\/cdn-cgi\/challenge-platform(?:\/|$)/i.test(parsedUrl.pathname) ||
        ((isGoogleHostname(parsedUrl.hostname) ||
          /(?:^|\.)recaptcha\.net$/i.test(parsedUrl.hostname)) &&
          RECAPTCHA_CHALLENGE_PATH_PATTERN.test(parsedUrl.pathname))),
  );
  if (isGoogleSorry || isKnownChallengeUrl) {
    return {
      kind: "captcha",
      message: "Human verification is required in the browser.",
    };
  }

  // Managed browser tools run in a WebView, where DOMParser is always
  // available. Non-browser callers can still use the conservative URL checks.
  if (typeof DOMParser === "undefined") return null;
  const document = new DOMParser().parseFromString(html, "text/html");

  if (
    isGoogleConsentHostname(safeHostname(currentUrl)) ||
    (GOOGLE_CONSENT_PATTERN.test(document.body?.textContent ?? "") &&
      document.querySelector(GOOGLE_CONSENT_FORM_SELECTOR))
  ) {
    return {
      kind: "consent",
      message: "Google needs a consent choice in the browser before search can continue.",
    };
  }

  if (document.querySelector(EXPLICIT_CHALLENGE_MARKUP_SELECTOR)) {
    return {
      kind: "captcha",
      message: "Human verification is required in the browser.",
    };
  }

  if (hasScopedChallengePhrase(document)) {
    return {
      kind: "captcha",
      message: "Human verification is required in the browser.",
    };
  }

  return null;
}

function hasScopedChallengePhrase(document: Document): boolean {
  for (const interactive of document.querySelectorAll(
    CHALLENGE_INTERACTIVE_SELECTOR,
  )) {
    const candidateScopes = [
      interactive.closest("form"),
      interactive.parentElement?.closest(
        EXPLICIT_CHALLENGE_CONTAINER_SELECTOR,
      ) ?? null,
      interactive.parentElement,
    ];
    if (
      candidateScopes.some(
        (scope) =>
          scope !== null &&
          containsStrongChallengePhrase(scope.textContent ?? ""),
      )
    ) {
      return true;
    }
  }

  return false;
}

function containsStrongChallengePhrase(text: string): boolean {
  const visibleText = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_SCAN_CHARS);
  return STRONG_CHALLENGE_PHRASES.some((phrase) => visibleText.includes(phrase));
}

export async function waitForHumanVerification<
  TSnapshot extends BrowserSnapshot,
>(
  initialSnapshot: TSnapshot,
  options: HumanVerificationWaitOptions<TSnapshot>,
): Promise<TSnapshot> {
  let snapshot = initialSnapshot;
  let verificationActive = false;

  try {
    while (true) {
      throwIfAborted(options.signal);
      const detection = await detectHumanVerification(snapshot);
      if (!detection) return snapshot;

      if (!verificationActive) {
        verificationActive = true;
        await options.onRequired?.(detection);
      }

      await abortableDelay(
        options.pollIntervalMs ?? HUMAN_VERIFICATION_POLL_INTERVAL_MS,
        options.signal,
      );
      snapshot = await options.getSnapshot();
    }
  } finally {
    if (verificationActive) {
      await options.onCleared?.();
    }
  }
}

export async function notifyHumanVerification({
  backend,
  browserTabId,
  message,
}: {
  backend: "webview" | "chrome-mcp";
  browserTabId?: string;
  message: string;
}): Promise<void> {
  try {
    let granted = await isNotificationPermissionGranted();
    if (!granted) {
      granted = (await requestNotificationPermission()) === "granted";
    }
    if (!granted) return;

    sendNotification({
      title: "Browser verification required",
      body:
        backend === "chrome-mcp"
          ? `${message} Open Chrome to solve it; research will resume automatically.`
          : `${message} Solve it in the open browser tab; research will resume automatically.`,
      extra: {
        kind: "human-verification",
        backend,
        ...(browserTabId ? { browserTabId } : {}),
      },
    });
  } catch {
    // Notification support is best-effort. The managed page remains visible
    // and the in-app attention state still tells the user what to do.
  }
}

function safeHostname(value: string): string {
  return safeUrl(value)?.hostname ?? "";
}

function isGoogleHostname(hostname: string): boolean {
  return GOOGLE_HOST_PATTERN.test(hostname);
}

function isGoogleConsentHostname(hostname: string): boolean {
  return (
    hostname.toLowerCase().startsWith("consent.") &&
    isGoogleHostname(hostname.slice("consent.".length))
  );
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
