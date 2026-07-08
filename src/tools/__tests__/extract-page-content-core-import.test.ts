import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri-bridge", () => ({
  invoke: vi.fn(),
  fetch: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("@/lib/sub-agent-emitter", () => ({
  emitSubAgentEvent: vi.fn(),
}));

vi.mock("@/lib/browser-tab-events", () => ({
  emitBrowserTabClosed: vi.fn(),
  emitBrowserTabOpened: vi.fn(),
}));

class MockExtractor {
  canHandle() {
    return false;
  }

  async extract() {
    return null;
  }
}

describe("extractPageContent core import path", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("deep-search-core/search-extract");
  });

  it("calls the exported extractPage function directly instead of engine.extract", async () => {
    const extractPage = vi.fn().mockResolvedValue({
      url: "https://example.com/page",
      content: "direct extract content",
      html: "<html><body>direct extract content</body></html>",
      usedCustomExtractor: false,
      method: "render",
      warnings: [],
    });
    const createSearchExtractEngine = vi.fn(() => ({
      extract: vi.fn(() => {
        throw new Error(
          "Cannot destructure property 'extractPage' from null or undefined value",
        );
      }),
    }));

    vi.doMock("deep-search-core/search-extract", () => ({
      MIN_CONTENT_LENGTH: 200,
      sanitizeHtml: (html: string) => html.replace(/<[^>]*>/g, ""),
      createTauriPageLoader: (callbacks: {
        fetchHtml: (url: string, signal?: AbortSignal) => Promise<string | null>;
        renderHtml: (url: string, signal?: AbortSignal) => Promise<string | null>;
      }) => ({
        fetchHtml: (url: string, options?: { signal?: AbortSignal }) =>
          callbacks.fetchHtml(url, options?.signal),
        renderHtml: (url: string, options?: { signal?: AbortSignal }) =>
          callbacks.renderHtml(url, options?.signal),
      }),
      fetchScrapeDoHtml: vi.fn(),
      createSearchExtractEngine,
      extractPage,
      RedditExtractor: MockExtractor,
      AmazonExtractor: MockExtractor,
      ShopifyExtractor: MockExtractor,
      TrustpilotExtractor: MockExtractor,
      GithubExtractor: MockExtractor,
      YouTubeExtractor: MockExtractor,
    }));

    const { extractPageContent } = await import("../extract-page-content-tool");

    await expect(
      extractPageContent("https://example.com/page", {
        method: "webview",
        summarize: false,
      }),
    ).resolves.toBe("direct extract content");

    expect(createSearchExtractEngine).not.toHaveBeenCalled();
    expect(extractPage).toHaveBeenCalledWith(
      "https://example.com/page",
      expect.objectContaining({ method: "render", summarize: false }),
      expect.objectContaining({
        fetch: expect.any(Function),
        pageLoader: expect.objectContaining({ renderHtml: expect.any(Function) }),
        extractors: expect.any(Array),
      }),
    );
  });
});
