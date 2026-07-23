import { z } from "zod";
import { isTauri } from "@/lib/tauri-bridge";
import { withChromeDevToolsMcpClient } from "@/lib/mcp/chrome-devtools-tools";
import type { ChromeMcpConnectionMode } from "@/lib/settings-store";
import type { PageLoader } from "deep-search-core/search-extract/core";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  notifyHumanVerification,
  waitForHumanVerification,
  type HumanVerificationDetection,
} from "@/lib/human-verification";
import { throwIfAborted } from "@/lib/abort";

const MCP_CALL_TIMEOUT_MS = 30_000;
const CLEANUP_CALL_TIMEOUT_MS = 5_000;
const NAVIGATE_TIMEOUT_MS = 30_000;

const ChromePageSchema = z.object({
  id: z.number().int().nonnegative(),
  url: z.string(),
  selected: z.boolean(),
});

const ChromePagesResultSchema = z.object({
  pages: z.array(ChromePageSchema),
});

type ChromePage = z.infer<typeof ChromePageSchema>;

interface ChromeMcpToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface ManagedChromeRenderOptions {
  signal?: AbortSignal;
  onHumanVerification?: (
    detection: HumanVerificationDetection,
  ) => void | Promise<void>;
}

export interface ChromeMcpConnection {
  connectionMode?: ChromeMcpConnectionMode;
  browserUrl?: string;
  nodePath?: string;
}

export async function renderWithManagedChromeMcp(
  url: string,
  connection: ChromeMcpConnection,
  options: ManagedChromeRenderOptions = {},
): Promise<string | null> {
  if (!isTauri()) return null;

  return withChromeDevToolsMcpClient(connection, async (client) => {
    throwIfAborted(options.signal);
    const beforePages = await listPages(client, options.signal);
    const originalPage = beforePages.find((page) => page.selected);
    const beforeIds = new Set(beforePages.map((page) => page.id));
    let managedPage: ChromePage | undefined;
    let managedPageBroughtToFront = false;

    try {
      const openResult = await callTool(
        client,
        "new_page",
        {
          url,
          background: true,
          timeout: NAVIGATE_TIMEOUT_MS,
        },
        MCP_CALL_TIMEOUT_MS,
        options.signal,
      );
      managedPage = findManagedPage(
        parsePages(openResult.structuredContent),
        beforeIds,
        url,
      );
      if (!managedPage) {
        managedPage = findManagedPage(
          await listPages(client, options.signal),
          beforeIds,
          url,
        );
      }
      if (!managedPage) {
        throw new Error("Chrome MCP opened a page but did not return its page ID.");
      }

      await selectPage(client, managedPage.id, false, options.signal);
      const firstSnapshot = await readPageSnapshot(
        client,
        managedPage.url || url,
        options.signal,
      );
      if (firstSnapshot === null) return null;

      const snapshot = await waitForHumanVerification(
        firstSnapshot,
        {
          signal: options.signal,
          getSnapshot: async () => {
            await selectPage(
              client,
              managedPage!.id,
              false,
              options.signal,
            );
            const currentSnapshot = await readPageSnapshot(
              client,
              managedPage?.url || url,
              options.signal,
            );
            if (currentSnapshot === null) {
              throw new Error("Chrome MCP returned no page HTML while waiting for verification.");
            }
            return currentSnapshot;
          },
          onRequired: async (detection) => {
            await selectPage(client, managedPage!.id, true, options.signal);
            managedPageBroughtToFront = true;
            await Promise.all([
              notifyHumanVerification({
                backend: "chrome-mcp",
                message: detection.message,
              }),
              options.onHumanVerification?.(detection),
            ]);
          },
        },
      );

      return snapshot.html;
    } finally {
      if (managedPage) {
        await closePage(client, managedPage.id).catch(() => undefined);
      }
      if (originalPage) {
        await selectPage(
          client,
          originalPage.id,
          managedPageBroughtToFront,
        ).catch(() => undefined);
      }
    }
  }, options.signal);
}

export function createChromeMcpPageLoader({
  connectionMode,
  browserUrl,
  nodePath,
  onHumanVerification,
}: ChromeMcpConnection & {
  onHumanVerification?: (
    detection: HumanVerificationDetection,
  ) => void | Promise<void>;
}): PageLoader {
  return {
    fetchHtml: undefined,
    renderHtml: (url, options) =>
      renderWithManagedChromeMcp(
        url,
        { connectionMode, browserUrl, nodePath },
        {
          signal: options?.signal,
          onHumanVerification,
        },
      ),
  };
}

async function listPages(
  client: Client,
  signal?: AbortSignal,
): Promise<ChromePage[]> {
  const result = await callTool(
    client,
    "list_pages",
    {},
    MCP_CALL_TIMEOUT_MS,
    signal,
  );
  return parsePages(result.structuredContent);
}

async function selectPage(
  client: Client,
  pageId: number,
  bringToFront: boolean,
  signal?: AbortSignal,
): Promise<void> {
  await callTool(
    client,
    "select_page",
    { pageId, bringToFront },
    signal ? MCP_CALL_TIMEOUT_MS : CLEANUP_CALL_TIMEOUT_MS,
    signal,
  );
}

async function closePage(client: Client, pageId: number): Promise<void> {
  await callTool(
    client,
    "close_page",
    { pageId },
    CLEANUP_CALL_TIMEOUT_MS,
  );
}

async function readPageSnapshot(
  client: Client,
  fallbackUrl: string,
  signal?: AbortSignal,
): Promise<{ html: string; url: string } | null> {
  const result = await callTool(
    client,
    "evaluate_script",
    {
      function:
        "() => ({ html: document.documentElement.outerHTML, url: location.href })",
    },
    MCP_CALL_TIMEOUT_MS,
    signal,
  );
  const text = extractTextFromToolResult(result);
  return text === null ? null : parseEvaluatedPageSnapshot(text, fallbackUrl);
}

export function parseEvaluatedPageSnapshot(
  text: string,
  fallbackUrl: string,
): { html: string; url: string } {
  const openingFence = /```json\s*/i.exec(text);
  const closingFenceIndex = text.lastIndexOf("```");
  const fencedJson =
    openingFence && closingFenceIndex >= openingFence.index + openingFence[0].length
      ? text.slice(openingFence.index + openingFence[0].length, closingFenceIndex).trim()
      : undefined;
  const candidate = fencedJson ?? text.trim();

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (typeof parsed === "string") {
      return { html: parsed, url: fallbackUrl };
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      "html" in parsed &&
      typeof parsed.html === "string"
    ) {
      return {
        html: parsed.html,
        url:
          "url" in parsed && typeof parsed.url === "string" && parsed.url
            ? parsed.url
            : fallbackUrl,
      };
    }
  } catch {
    // Unit-test adapters and older MCP versions may return raw HTML.
  }

  return { html: text, url: fallbackUrl };
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  timeout: number,
  signal?: AbortSignal,
): Promise<ChromeMcpToolResult> {
  const result = (await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout, signal },
  )) as ChromeMcpToolResult;

  if (result.isError) {
    throw new Error(
      extractTextFromToolResult(result) ?? `Chrome MCP tool ${name} failed.`,
    );
  }
  return result;
}

function extractTextFromToolResult(result: ChromeMcpToolResult): string | null {
  const textContent = result.content?.find((content) => content.type === "text");
  return textContent?.text ?? null;
}

function parsePages(value: unknown): ChromePage[] {
  const parsed = ChromePagesResultSchema.safeParse(value);
  return parsed.success ? parsed.data.pages : [];
}

function findManagedPage(
  pages: ChromePage[],
  beforeIds: ReadonlySet<number>,
  targetUrl: string,
): ChromePage | undefined {
  const createdPages = pages.filter((page) => !beforeIds.has(page.id));
  const selectedPages = createdPages.filter((page) => page.selected);
  if (selectedPages.length === 1) return selectedPages[0];

  const target = normalizedUrl(targetUrl);
  const exactMatches = createdPages.filter(
    (page) => normalizedUrl(page.url) === target,
  );
  return exactMatches.length === 1 ? exactMatches[0] : undefined;
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizedUrl(value: string): string | null {
  return safeUrl(value)?.href ?? null;
}
