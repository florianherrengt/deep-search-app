import { beforeEach, describe, expect, it, vi } from "vitest";

const rendererMocks = vi.hoisted(() => ({
  webview: vi.fn(),
  chrome: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => ({
  fetch: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("@/lib/managed-webview", () => ({
  renderWithManagedWebview: rendererMocks.webview,
}));

vi.mock("@/tools/chrome-mcp-page-loader", () => ({
  renderWithManagedChromeMcp: rendererMocks.chrome,
  createChromeMcpPageLoader: vi.fn(() => ({
    fetchHtml: undefined,
    renderHtml: vi.fn(),
  })),
}));

vi.mock("@/lib/chat-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat-providers")>();
  return {
    ...actual,
    createChatLanguageModel: vi.fn(() => ({ modelId: "panel-model" })),
  };
});

vi.mock("@/tools/google-search-extractor", () => ({
  extractAndFormatGoogleSearchHtml: vi.fn(async () =>
    "Example result: https://example.com/result?item=1\nRendered browser result."
  ),
}));

import { getAvailableTools } from "@/lib/execute-tool";

const GOOGLE_HTML = `
  <html><body><div id="search"><div id="rso">
    <div class="g"><a href="https://example.com/result?item=1"><h3>Example result</h3></a>
      <div class="VwiC3b">Rendered browser result.</div>
    </div>
  </div></div></body></html>
`;

const CHAT_MODEL = {
  provider: "openrouter" as const,
  apiKey: "chat-key",
  model: "test-model",
};

function googleTool(config: Parameters<typeof getAvailableTools>[0]) {
  const descriptor = getAvailableTools(config).find(
    (tool) => tool.name === "google_search",
  );
  expect(descriptor?.available).toBe(true);
  return descriptor!;
}

describe("direct Google search availability and browser routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rendererMocks.webview.mockResolvedValue(GOOGLE_HTML);
    rendererMocks.chrome.mockResolvedValue(GOOGLE_HTML);
  });

  it("is keyless and uses the built-in WebView by default", async () => {
    const descriptor = googleTool({
      researchFolder: null,
      getChatModel: () => CHAT_MODEL,
    });

    await expect(descriptor.execute({ query: "test query" })).resolves.toContain(
      "Example result",
    );
    expect(rendererMocks.webview).toHaveBeenCalledWith(
      "https://www.google.com/search?q=test+query&num=10",
      {
        signal: undefined,
        onHumanVerification: expect.any(Function),
        throwOnError: true,
      },
    );
    expect(rendererMocks.chrome).not.toHaveBeenCalled();
  });

  it("uses Chrome only when it is enabled and explicitly selected", async () => {
    const descriptor = googleTool({
      researchFolder: null,
      getChatModel: () => CHAT_MODEL,
      chromeDevToolsMcpEnabled: true,
      webExtractionBackend: "chrome-mcp",
      chromeDevToolsMcpConnectionMode: "browser-url",
      chromeDevToolsMcpBrowserUrl: "http://127.0.0.1:9222",
      chromeDevToolsMcpNodePath: "/custom/node",
    });

    await descriptor.execute({ query: "test" });

    expect(rendererMocks.chrome).toHaveBeenCalledWith(
      "https://www.google.com/search?q=test&num=10",
      {
        connectionMode: "browser-url",
        browserUrl: "http://127.0.0.1:9222",
        nodePath: "/custom/node",
      },
      {
        signal: undefined,
        onHumanVerification: expect.any(Function),
      },
    );
    expect(rendererMocks.webview).not.toHaveBeenCalled();
  });

  it("reports explicitly selected Chrome errors without falling back", async () => {
    rendererMocks.chrome.mockRejectedValue(new Error("Chrome failed to start"));
    const descriptor = googleTool({
      researchFolder: null,
      getChatModel: () => CHAT_MODEL,
      chromeDevToolsMcpEnabled: true,
      webExtractionBackend: "chrome-mcp",
    });

    await expect(descriptor.execute({ query: "test" })).rejects.toThrow(
      "Chrome failed to start",
    );
    expect(rendererMocks.webview).not.toHaveBeenCalled();
  });

  it("is unavailable without a configured language model", () => {
    const descriptor = getAvailableTools({ researchFolder: null }).find(
      (tool) => tool.name === "google_search",
    );

    expect(descriptor?.available).toBe(false);
  });
});
