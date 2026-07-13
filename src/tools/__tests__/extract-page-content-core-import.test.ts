import { afterEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  streamText: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: aiMocks.streamText,
  };
});

vi.mock("@/lib/tauri-bridge", () => ({
  invoke: vi.fn(),
  fetch: vi.fn(),
  isTauri: vi.fn(() => true),
}));

const emitterMocks = vi.hoisted(() => ({
  emitSubAgentEvent: vi.fn(),
}));

vi.mock("@/lib/sub-agent-emitter", () => ({
  emitSubAgentEvent: emitterMocks.emitSubAgentEvent,
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
    vi.clearAllMocks();
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

  it("uses an injected chat-scoped emitter for the complete extraction lifecycle", async () => {
    aiMocks.streamText.mockReturnValue({
      textStream: (async function* () {
        yield "summary ";
        yield "chunk";
      })(),
      text: Promise.resolve("summary chunk"),
    });
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
      extractPage: vi.fn().mockResolvedValue({
        url: "https://example.com/page",
        content: "direct extract content",
        html: null,
        usedCustomExtractor: true,
        method: "fetch",
        warnings: [],
      }),
      RedditExtractor: MockExtractor,
      AmazonExtractor: MockExtractor,
      ShopifyExtractor: MockExtractor,
      TrustpilotExtractor: MockExtractor,
      GithubExtractor: MockExtractor,
      YouTubeExtractor: MockExtractor,
    }));

    const { createExtractPageContentTool } = await import("../extract-page-content-tool");
    const emitEvent = vi.fn();
    const extractTool = createExtractPageContentTool(
      { modelId: "test" } as never,
      async () => "",
      undefined,
      undefined,
      undefined,
      { emitEvent },
    );

    await expect(
      extractTool.execute?.(
        {
          url: "https://example.com/page",
          summarize: true,
          method: "fetch",
        },
        { toolCallId: "extract-call-1", messages: [] },
      ),
    ).resolves.toBe("summary chunk");

    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "start",
        toolName: "extract_page_content",
        displayTarget: { type: "toolCall", toolCallId: "extract-call-1" },
      }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "text-delta",
        delta: "Extracting content from https://example.com/page...\n\n",
      }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text-delta", delta: "summary " }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text-delta", delta: "chunk" }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "complete" }),
    );
    expect(emitterMocks.emitSubAgentEvent).not.toHaveBeenCalled();
  });
});
