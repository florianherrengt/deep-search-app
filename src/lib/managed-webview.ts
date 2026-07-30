import PQueue from "p-queue";
import { invoke } from "@/lib/tauri-bridge";
import {
  abortableDelay,
  abortablePromise,
  isAbortError,
  throwIfAborted,
} from "@/lib/abort";
import {
  emitBrowserTabClosed,
  emitBrowserTabOpened,
  emitBrowserTabVerificationCleared,
  emitBrowserTabVerificationRequired,
} from "@/lib/browser-tab-events";
import {
  notifyHumanVerification,
  waitForHumanVerification,
  type HumanVerificationDetection,
} from "@/lib/human-verification";
import { tryParseJson } from "@/lib/json";
import { validateUrl } from "@/lib/url-validation";

const DEFAULT_RETRY_INTERVAL_MS = 5_000;
const DEFAULT_MAX_WAIT_MS = 5 * 60_000;

let nextWebviewTabId = 0;
// Serialized (concurrency 1) queue so only one managed WebView tab runs at a time.
const webviewOperations = new PQueue({ concurrency: 1 });

export interface ManagedWebviewRetryOptions {
  shouldRetry: (html: string) => boolean;
  maxWaitMs?: number;
  retryIntervalMs?: number;
}

export interface ManagedWebviewRenderOptions {
  signal?: AbortSignal;
  retry?: ManagedWebviewRetryOptions;
  settleDynamicContent?: boolean;
  throwOnError?: boolean;
  onHumanVerification?: (
    detection: HumanVerificationDetection,
  ) => void | Promise<void>;
}

export async function renderWithManagedWebview(
  url: string,
  options: ManagedWebviewRenderOptions = {},
): Promise<string | null> {
  validateUrl(url);
  throwIfAborted(options.signal);

  return runExclusiveWebviewOperation(async () => {
    const id = createWebviewTabId();
    let tabAnnounced = false;

    try {
      emitBrowserTabOpened({
        id,
        url,
        title: domainFromUrl(url),
        activate: true,
      });
      tabAnnounced = true;

      await abortablePromise(waitForBrowserPaint(), options.signal);
      // Tauri commands cannot be cancelled once dispatched. Wait for the
      // native open to settle so an abort cannot race cleanup and leave a
      // late-created WebView behind.
      await invoke("open_tab", { url, id });
      throwIfAborted(options.signal);
      await switchWebviewTab(id, options.signal);

      const startedAt = Date.now();
      while (true) {
        throwIfAborted(options.signal);
        let verificationRequired = false;
        const verificationOptions = {
          signal: options.signal,
          getSnapshot: () => readWebviewSnapshot(id, url, options.signal),
          onRequired: async (detection: HumanVerificationDetection) => {
            verificationRequired = true;
            emitBrowserTabVerificationRequired({ id });
            await switchWebviewTab(id, options.signal);
            await Promise.all([
              notifyHumanVerification({
                backend: "webview" as const,
                browserTabId: id,
                message: detection.message,
              }),
              options.onHumanVerification?.(detection),
            ]);
          },
          onCleared: () => {
            emitBrowserTabVerificationCleared({ id });
          },
        };
        let snapshot = await waitForHumanVerification(
          await readWebviewSnapshot(id, url, options.signal),
          verificationOptions,
        );

        if (options.settleDynamicContent) {
          do {
            verificationRequired = false;
            // Native commands cannot be cancelled once dispatched. Keep the
            // serialized tab transaction open until settling finishes.
            await invoke("settle_tab_content", { id });
            throwIfAborted(options.signal);
            snapshot = await waitForHumanVerification(
              await readWebviewSnapshot(id, url, options.signal),
              verificationOptions,
            );
          } while (verificationRequired);
        }

        if (!options.retry?.shouldRetry(snapshot.html)) {
          return snapshot.html;
        }

        const maxWaitMs = options.retry.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
        if (Date.now() - startedAt >= maxWaitMs) {
          return snapshot.html;
        }

        await abortableDelay(
          options.retry.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS,
          options.signal,
        );
      }
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw error;
      if (options.throwOnError) throw error;
      console.warn(
        `[browser] Managed webview failed for ${url}:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    } finally {
      await invoke("close_tab", { id }).catch(() => undefined);
      if (tabAnnounced) emitBrowserTabClosed({ id });
    }
  }, options.signal);
}

export async function runExclusiveWebviewOperation<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return webviewOperations.add(operation, signal ? { signal } : undefined);
}

function createWebviewTabId(): string {
  nextWebviewTabId += 1;
  return `tab-${Date.now()}-${nextWebviewTabId}`;
}

async function readWebviewHtml(
  id: string,
  signal?: AbortSignal,
): Promise<string> {
  const rawHtml = await abortablePromise(
    invoke<string>("extract_content", { id }),
    signal,
  );
  return normalizeWebviewHtml(rawHtml);
}

async function readWebviewSnapshot(
  id: string,
  fallbackUrl: string,
  signal?: AbortSignal,
): Promise<{ html: string; url: string }> {
  const [html, currentUrl] = await Promise.all([
    readWebviewHtml(id, signal),
    abortablePromise(
      invoke<string>("get_tab_url", { id }).catch(() => fallbackUrl),
      signal,
    ),
  ]);
  return {
    html,
    url: typeof currentUrl === "string" && currentUrl ? currentUrl : fallbackUrl,
  };
}

async function switchWebviewTab(id: string, signal?: AbortSignal) {
  await abortablePromise(
    invoke("switch_tab", { id }).catch(() => undefined),
    signal,
  );
}

function normalizeWebviewHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed.startsWith('"') && !trimmed.startsWith("{")) return html;

  const parsed = tryParseJson(trimmed);
  if (typeof parsed === "string") return parsed;
  if (
    parsed &&
    typeof parsed === "object" &&
    "value" in parsed &&
    typeof parsed.value === "string"
  ) {
    return parsed.value;
  }
  return html;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function waitForBrowserPaint(): Promise<void> {
  if (
    typeof window === "undefined" ||
    typeof window.requestAnimationFrame !== "function"
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    window.requestAnimationFrame(finish);
    window.setTimeout(finish, 100);
  });
}
