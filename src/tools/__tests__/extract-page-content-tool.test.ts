import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri-bridge", () => ({
  invoke: vi.fn(),
  fetch: vi.fn(),
  isTauri: vi.fn(() => true),
}));

const mockMcpCallTool = vi.fn();
const mockMcpGetClient = vi.fn();

vi.mock("@/lib/mcp/chrome-devtools-tools", () => ({
  getChromeDevToolsMcpClient: (...args: unknown[]) => mockMcpGetClient(...args),
}));

import { fetch as bridgeFetch, invoke, isTauri } from "@/lib/tauri-bridge";
import {
  extractPageContent,
  fetchHtml,
} from "../extract-page-content-tool";
import { sanitizeHtml } from "deep-search-core/search-extract";
import { getAvailableTools } from "@/lib/execute-tool";
import type { ChatModelConfig } from "@/lib/chat-providers";
import { validateUrl, UrlValidationError } from "@/lib/url-validation";

const mockInvoke = vi.mocked(invoke);
const mockBridgeFetch = vi.mocked(bridgeFetch);

const OLD_REDDIT_HTML = `
<html>
<body>
  <div class="thing link" data-author="tester" data-score="10">
    <p class="title"><a class="title">Test Post</a></p>
    <div class="expando"><div class="usertext-body">Body text</div></div>
  </div>
  <div class="commentarea">
    <div class="sitetable nestedlisting">
      <div class="thing comment" data-author="commenter" data-score="3">
        <div class="entry">
          <div class="usertext-body">Hello from old Reddit</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("extractPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBridgeFetch.mockReset();
    mockInvoke.mockImplementation(async (command) => {
      if (command === "extract_content") return OLD_REDDIT_HTML;
      return undefined;
    });
  });

  it("extracts reddit URLs through old.reddit.com webview without HTTP fetching reddit.com", async () => {
    const result = await extractPageContent(
      "https://www.reddit.com/r/test/comments/abc/test_post/",
      { summarize: false },
    );

    expect(result).toContain("# Test Post");
    expect(result).toContain("└── **commenter** · 3 pts: Hello from old Reddit");
    expect(mockInvoke).not.toHaveBeenCalledWith("fetch_html", expect.anything());
    expect(mockInvoke).toHaveBeenCalledWith("open_tab", {
      id: expect.any(String),
      url: "https://old.reddit.com/r/test/comments/abc/test_post/",
    });
  });

  it("decodes serialized Tauri callback HTML before parsing reddit content", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "extract_content") return JSON.stringify(OLD_REDDIT_HTML);
      return undefined;
    });

    const result = await extractPageContent(
      "https://www.reddit.com/r/test/comments/abc/test_post/",
      { summarize: false },
    );

    expect(result).toContain("# Test Post");
    expect(result).toContain("└── **commenter** · 3 pts: Hello from old Reddit");
  });

  it("uses the Rust validated fetch command for direct HTML fetching", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "fetch_html") return "<html><body>Hello</body></html>";
      return undefined;
    });

    await expect(fetchHtml("https://example.com/page")).resolves.toContain(
      "Hello",
    );
    expect(mockInvoke).toHaveBeenCalledWith("fetch_html", {
      url: "https://example.com/page",
    });
  });

  it("serializes webview extractions so concurrent calls do not share the active page", async () => {
    const firstExtractStarted = deferred();
    const releaseFirstExtract = deferred();
    const idToUrl = new Map<string, string>();
    const events: string[] = [];
    const firstUrl =
      "https://old.reddit.com/r/test/comments/first/first_post/";
    const secondUrl =
      "https://old.reddit.com/r/test/comments/second/second_post/";

    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "open_tab") {
        const { id, url } = args as { id: string; url: string };
        idToUrl.set(id, url);
        events.push(`open:${url}`);
        return undefined;
      }

      if (command === "extract_content") {
        const { id } = args as { id: string };
        const url = idToUrl.get(id) ?? id;
        events.push(`extract:${url}`);
        if (url === firstUrl) {
          firstExtractStarted.resolve();
          await releaseFirstExtract.promise;
          return OLD_REDDIT_HTML;
        }
        return OLD_REDDIT_HTML;
      }

      if (command === "close_tab") {
        const { id } = args as { id: string };
        events.push(`close:${idToUrl.get(id) ?? id}`);
        return undefined;
      }

      return undefined;
    });

    const first = extractPageContent(
      "https://www.reddit.com/r/test/comments/first/first_post/",
      {
        summarize: false,
      },
    );
    await firstExtractStarted.promise;

    const second = extractPageContent(
      "https://www.reddit.com/r/test/comments/second/second_post/",
      {
        summarize: false,
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    let concurrentOpenError: unknown;
    try {
      expect(events).toEqual([
        `open:${firstUrl}`,
        `extract:${firstUrl}`,
      ]);
    } catch (error) {
      concurrentOpenError = error;
    }

    releaseFirstExtract.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    if (concurrentOpenError) throw concurrentOpenError;
    expect(firstResult).toContain("# Test Post");
    expect(secondResult).toContain("# Test Post");
    expect(events).toEqual([
      `open:${firstUrl}`,
      `extract:${firstUrl}`,
      `close:${firstUrl}`,
      `open:${secondUrl}`,
      `extract:${secondUrl}`,
      `close:${secondUrl}`,
    ]);
  });

  it("extracts compact visible text while preserving product page details", () => {
    const result = sanitizeHtml(`
      <html>
        <head>
          <title>Ignored title chrome</title>
          <meta name="description" content="metadata should not leak" />
          <style>.price { color: red; }</style>
          <script>{"price":"wrong"}</script>
        </head>
        <body>
          <header>Store navigation</header>
          <nav>Deals Departments Account</nav>
          <main>
            <section class="product-detail">
              <h1>ErgoEdge Low Profile Keyboard Tray</h1>
              <div class="rating">4.6 out of 5 stars</div>
              <div class="price">$39.95</div>
              <p>Soft beveled front edge reduces wrist pressure.</p>
              <table>
                <tr><th>Feature</th><th>Value</th></tr>
                <tr><td>Height</td><td>0.75 in</td></tr>
                <tr><td>Material</td><td>Dense foam</td></tr>
              </table>
            </section>
            <section class="recommendations">
              <h2>Similar items</h2>
              <article>
                <h3>Wrist Rest Pro</h3>
                <span>$24.99</span>
                <span>4.4 stars</span>
              </article>
            </section>
          </main>
          <div aria-hidden="true">Hidden modal price $0.01</div>
          <div class="cookie-banner">Accept cookies to continue</div>
          <div id="newsletter-popup">Join our list</div>
          <footer>Footer links</footer>
        </body>
      </html>
    `);

    expect(result).toContain("ErgoEdge Low Profile Keyboard Tray");
    expect(result).toContain("4.6 out of 5 stars");
    expect(result).toContain("$39.95");
    expect(result).toContain("Feature | Value");
    expect(result).toContain("Height | 0.75 in");
    expect(result).toContain("Similar items");
    expect(result).toContain("Wrist Rest Pro");
    expect(result).toContain("$24.99");
    expect(result).not.toContain("<");
    expect(result).not.toContain("metadata should not leak");
    expect(result).not.toContain("wrong");
    expect(result).not.toContain("Store navigation");
    expect(result).not.toContain("Accept cookies");
    expect(result).not.toContain("Hidden modal price");
    expect(result).not.toContain("Join our list");
  });

  it("normalizes whitespace and caps globally repeated boilerplate lines", () => {
    const result = sanitizeHtml(`
      <html>
        <body>
          <main>
            <p>Free returns</p>
            <p>Free returns</p>
            <p>Free returns</p>
            <p>Product A $10</p>
            <p>Product B $12</p>
            <p>Product A $10</p>
          </main>
        </body>
      </html>
    `);

    expect(result.match(/Free returns/g)).toHaveLength(2);
    expect(result.match(/Product A \$10/g)).toHaveLength(2);
    expect(result).toContain("Product B $12");
  });
});

describe("URL validation", () => {
  it("throws for an invalid URL", () => {
    expect(() => validateUrl("not-a-valid-url")).toThrow(UrlValidationError);
  });

  it("throws for non-https protocol", () => {
    expect(() => validateUrl("http://example.com")).toThrow(UrlValidationError);
  });

  it("throws for blocked schemes", () => {
    expect(() => validateUrl("file:///etc/passwd")).toThrow(UrlValidationError);
  });
});

describe("extractPageContent edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBridgeFetch.mockReset();
    mockInvoke.mockImplementation(async (command) => {
      if (command === "extract_content") return "<html><body>Fallback content from webview</body></html>";
      return undefined;
    });
  });

  it("falls back to webview when fetched content is shorter than 200 characters", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "fetch_html") return "<html><body>Short</body></html>";
      if (command === "extract_content") return "<html><body>Fallback content from webview with much more text</body></html>";
      return undefined;
    });

    const result = await extractPageContent(
      "https://example.com/page",
      { summarize: false },
    );

    expect(result).toContain("Fallback content");
    expect(mockInvoke).toHaveBeenCalledWith("fetch_html", {
      url: "https://example.com/page",
    });
    expect(mockInvoke).toHaveBeenCalledWith("open_tab", {
      id: expect.any(String),
      url: "https://example.com/page",
    });
    expect(mockBridgeFetch).not.toHaveBeenCalled();
  });

  it("tries Scrape.do before webview when auto fetch content is short", async () => {
    const remoteContent = "Remote content from Scrape.do. ".repeat(12);
    mockInvoke.mockImplementation(async (command) => {
      if (command === "fetch_html") return "<html><body>Short</body></html>";
      if (command === "extract_content") return "<html><body>Browser fallback content</body></html>";
      return undefined;
    });
    mockBridgeFetch.mockResolvedValueOnce(
      new Response(`<html><body>${remoteContent}</body></html>`, { status: 200 }),
    );

    const result = await extractPageContent(
      "https://example.com/page",
      { summarize: false, scrapeDoApiKey: "scrape-token" },
    );

    expect(result).toContain("Remote content from Scrape.do");
    expect(mockBridgeFetch).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = mockBridgeFetch.mock.calls[0];
    const endpoint = new URL(String(requestUrl));
    expect(endpoint.origin).toBe("https://api.scrape.do");
    expect(endpoint.searchParams.get("token")).toBe("scrape-token");
    expect(endpoint.searchParams.get("url")).toBe("https://example.com/page");
    expect(init).toEqual(expect.objectContaining({ method: "GET" }));
    expect(mockInvoke).not.toHaveBeenCalledWith("open_tab", expect.anything());
  });

  it("falls through to webview when Scrape.do content is still too short", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "fetch_html") return null;
      if (command === "extract_content") return "<html><body>Fallback content from webview with enough detail</body></html>";
      return undefined;
    });
    mockBridgeFetch.mockResolvedValueOnce(
      new Response("<html><body>Tiny</body></html>", { status: 200 }),
    );

    const result = await extractPageContent(
      "https://example.com/page",
      { summarize: false, scrapeDoApiKey: "scrape-token" },
    );

    expect(result).toContain("Fallback content from webview");
    expect(mockBridgeFetch).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("open_tab", {
      id: expect.any(String),
      url: "https://example.com/page",
    });
  });

  it("uses Scrape.do when method is scrape.do", async () => {
    const remoteContent = "Forced Scrape.do content. ".repeat(12);
    mockBridgeFetch.mockResolvedValueOnce(
      new Response(`<html><body>${remoteContent}</body></html>`, { status: 200 }),
    );

    const result = await extractPageContent(
      "https://example.com/page",
      { summarize: false, method: "scrape.do", scrapeDoApiKey: "scrape-token" },
    );

    expect(result).toContain("Forced Scrape.do content");
    expect(mockBridgeFetch).toHaveBeenCalledTimes(1);
    const endpoint = new URL(String(mockBridgeFetch.mock.calls[0][0]));
    expect(endpoint.origin).toBe("https://api.scrape.do");
    expect(endpoint.searchParams.get("token")).toBe("scrape-token");
    expect(mockInvoke).not.toHaveBeenCalledWith("open_tab", expect.anything());
  });

  it("returns a descriptive error when fetch and webview both produce no content", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "fetch_html") return null;
      if (command === "extract_content") return "";
      return undefined;
    });

    const result = await extractPageContent(
      "https://example.com/page",
      { summarize: false },
    );

    expect(result).toContain("No content could be extracted");
    expect(result).toContain("https://example.com/page");
  });

  it("does not fallback to webview when method is fetch even with short content", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "fetch_html") return "<html><body>Hi</body></html>";
      return undefined;
    });

    const result = await extractPageContent(
      "https://example.com/page",
      { method: "fetch", summarize: false },
    );

    expect(result).toContain("Hi");
    expect(mockInvoke).not.toHaveBeenCalledWith("open_tab", expect.anything());
    expect(mockBridgeFetch).not.toHaveBeenCalled();
  });

  it("does not use Scrape.do when method is webview", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "extract_content") return "<html><body>Forced browser content</body></html>";
      return undefined;
    });

    const result = await extractPageContent(
      "https://example.com/page",
      { method: "webview", summarize: false, scrapeDoApiKey: "scrape-token" },
    );

    expect(result).toContain("Forced browser content");
    expect(mockBridgeFetch).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith("open_tab", {
      id: expect.any(String),
      url: "https://example.com/page",
    });
  });

  it("falls back to fetch when custom extractor returns empty content", async () => {
    const longContent = "Real product content from fetch fallback. ".repeat(10);
    mockInvoke.mockImplementation(async (command, _args) => {
      if (command === "fetch_html") {
        return `<html><body><p>${longContent}</p></body></html>`;
      }
      if (command === "open_tab") return undefined;
      if (command === "extract_content") return "";
      if (command === "close_tab") return undefined;
      if (command === "switch_tab") return undefined;
      return undefined;
    });

    const result = await extractPageContent(
      "https://store.myshopify.com/products/test-product",
      { summarize: false },
    );

    expect(result).toContain("Real product content");
    expect(mockInvoke).toHaveBeenCalledWith("fetch_html", {
      url: "https://store.myshopify.com/products/test-product",
    });
  });
});

describe("extractPageContent with Chrome MCP backend", () => {
  const CHROME_MCP_HTML = "<html><body><p>Extracted via Chrome</p></body></html>";

  const chromeMcpConfig = {
    enabled: true,
    connectionMode: "auto" as const,
    backend: "chrome-mcp" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBridgeFetch.mockReset();
    vi.mocked(isTauri).mockReturnValue(true);
    mockMcpGetClient.mockResolvedValue({ callTool: mockMcpCallTool });
  });

  it("extracts content using Chrome MCP when backend is chrome-mcp", async () => {
    mockMcpCallTool
      .mockResolvedValueOnce({ content: [], isError: false })
      .mockResolvedValueOnce({ content: [{ type: "text", text: CHROME_MCP_HTML }], isError: false });

    const result = await extractPageContent(
      "https://example.com/page",
      { summarize: false, chromeMcp: chromeMcpConfig },
    );

    expect(result).toContain("Extracted via Chrome");
    expect(mockMcpCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "navigate_page" }),
      undefined,
      expect.anything(),
    );
    expect(mockMcpCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "evaluate_script" }),
      undefined,
      expect.anything(),
    );
    expect(mockInvoke).not.toHaveBeenCalledWith("open_tab", expect.anything());
  });

  it("forces Chrome MCP when method is chrome even if backend is tauri-webview", async () => {
    mockMcpCallTool
      .mockResolvedValueOnce({ content: [], isError: false })
      .mockResolvedValueOnce({ content: [{ type: "text", text: CHROME_MCP_HTML }], isError: false });

    const result = await extractPageContent(
      "https://example.com/page",
      {
        summarize: false,
        method: "chrome",
        chromeMcp: { enabled: true, backend: "tauri-webview" },
      },
    );

    expect(result).toContain("Extracted via Chrome");
    expect(mockMcpCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "navigate_page" }),
      undefined,
      expect.anything(),
    );
    expect(mockInvoke).not.toHaveBeenCalledWith("open_tab", expect.anything());
  });

  it("returns error when Chrome MCP is not connected", async () => {
    mockMcpGetClient.mockRejectedValue(new Error("Chrome MCP is not connected"));

    await expect(
      extractPageContent(
        "https://example.com/page",
        { summarize: false, chromeMcp: chromeMcpConfig },
      ),
    ).rejects.toThrow("Chrome MCP is not connected");
  });

  it("returns error when navigation fails", async () => {
    mockMcpCallTool.mockRejectedValue(new Error("Navigation timed out"));

    await expect(
      extractPageContent(
        "https://example.com/page",
        { summarize: false, chromeMcp: chromeMcpConfig },
      ),
    ).rejects.toThrow("Navigation timed out");
  });

  it("returns error when evaluate_script returns empty content", async () => {
    mockMcpCallTool
      .mockResolvedValueOnce({ content: [], isError: false })
      .mockResolvedValueOnce({ content: [], isError: false });

    const result = await extractPageContent(
      "https://example.com/page",
      { summarize: false, chromeMcp: chromeMcpConfig },
    );

    expect(result).toContain("No content could be extracted");
  });

  it("uses Tauri webview when backend is tauri-webview (default)", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "extract_content") return OLD_REDDIT_HTML;
      return undefined;
    });

    const result = await extractPageContent(
      "https://www.reddit.com/r/test/comments/abc/test_post/",
      {
        summarize: false,
        chromeMcp: { enabled: true, backend: "tauri-webview" },
      },
    );

    expect(result).toContain("# Test Post");
    expect(mockInvoke).toHaveBeenCalledWith("open_tab", expect.objectContaining({
      url: "https://old.reddit.com/r/test/comments/abc/test_post/",
    }));
    expect(mockMcpCallTool).not.toHaveBeenCalled();
  });

  it("uses Tauri webview when Chrome MCP is enabled but backend is tauri-webview", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "extract_content") return OLD_REDDIT_HTML;
      return undefined;
    });

    const result = await extractPageContent(
      "https://www.reddit.com/r/test/comments/abc/test_post/",
      {
        summarize: false,
        chromeMcp: { enabled: true, backend: "tauri-webview" },
      },
    );

    expect(result).toContain("# Test Post");
    expect(mockMcpCallTool).not.toHaveBeenCalled();
  });

  it("uses Tauri webview when Chrome MCP is not enabled even if backend is chrome-mcp", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "extract_content") return OLD_REDDIT_HTML;
      return undefined;
    });

    const result = await extractPageContent(
      "https://www.reddit.com/r/test/comments/abc/test_post/",
      {
        summarize: false,
        chromeMcp: { enabled: false, backend: "chrome-mcp" },
      },
    );

    expect(result).toContain("# Test Post");
    expect(mockMcpCallTool).not.toHaveBeenCalled();
  });

  it("produces the same result shape with Chrome MCP as with webview", async () => {
    mockMcpCallTool
      .mockResolvedValueOnce({ content: [], isError: false })
      .mockResolvedValueOnce({ content: [{ type: "text", text: "<html><body><p>Same content</p></body></html>" }], isError: false });

    const chromeResult = await extractPageContent(
      "https://example.com/page",
      { summarize: false, chromeMcp: chromeMcpConfig },
    );

    expect(chromeResult).toContain("Same content");

    mockInvoke.mockImplementation(async (command) => {
      if (command === "extract_content") return "<html><body><p>Same content</p></body></html>";
      return undefined;
    });

    const webviewResult = await extractPageContent(
      "https://example.com/page",
      { summarize: false, method: "webview" },
    );

    expect(chromeResult).toBe(webviewResult);
  });
});

describe("extract_page_content via the Tools panel path (getAvailableTools)", () => {
  const PANEL_MODEL: ChatModelConfig = {
    provider: "openrouter",
    apiKey: "test-key",
    model: "x",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBridgeFetch.mockReset();
    vi.mocked(isTauri).mockReturnValue(true);
    mockMcpGetClient.mockResolvedValue({ callTool: mockMcpCallTool });
  });

  it("runs the chrome method through the panel without crashing on options.toolCallId", async () => {
    // Reproduces: ToolsPanel calls descriptor.execute(params) -> execute(params, undefined).
    mockMcpCallTool
      .mockResolvedValueOnce({ content: [], isError: false })
      .mockResolvedValueOnce({ content: [{ type: "text", text: "<html><body><p>Panel chrome content</p></body></html>" }], isError: false });

    const tools = getAvailableTools({
      researchFolder: "folder",
      getChatModel: () => PANEL_MODEL,
      chromeDevToolsMcpEnabled: true,
      webExtractionBackend: "chrome-mcp",
    });
    const extract = tools.find((t) => t.name === "extract_page_content");
    expect(extract?.available).toBe(true);

    const result = await extract!.execute({
      url: "https://example.com/page",
      summarize: false,
      method: "chrome",
    });

    expect(result).toContain("Panel chrome content");
    expect(mockMcpCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "navigate_page" }),
      undefined,
      expect.anything(),
    );
  });

  it("runs the scrape.do method through the panel", async () => {
    const remoteContent = "Panel scrape.do content. ".repeat(12);
    mockBridgeFetch.mockResolvedValueOnce(
      new Response(`<html><body>${remoteContent}</body></html>`, { status: 200 }),
    );

    const tools = getAvailableTools({
      researchFolder: "folder",
      getChatModel: () => PANEL_MODEL,
      scrapeDoApiKey: "scrape-token",
    });
    const extract = tools.find((t) => t.name === "extract_page_content");
    expect(extract?.available).toBe(true);

    const result = await extract!.execute({
      url: "https://example.com/page",
      summarize: false,
      method: "scrape.do",
    });

    expect(result).toContain("Panel scrape.do content");
    expect(mockBridgeFetch).toHaveBeenCalledTimes(1);
    const endpoint = new URL(String(mockBridgeFetch.mock.calls[0][0]));
    expect(endpoint.origin).toBe("https://api.scrape.do");
  });
});
