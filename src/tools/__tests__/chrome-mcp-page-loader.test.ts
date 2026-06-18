import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCallTool = vi.fn();
const mockGetClient = vi.fn();

vi.mock("@/lib/tauri-bridge", () => ({
  isTauri: vi.fn(() => true),
}));

vi.mock("@/lib/mcp/chrome-devtools-tools", () => ({
  getChromeDevToolsMcpClient: (...args: unknown[]) => mockGetClient(...args),
}));

import { isTauri } from "@/lib/tauri-bridge";
import { createChromeMcpPageLoader } from "../chrome-mcp-page-loader";

const MOCK_HTML = "<html><body><p>Hello from Chrome MCP</p></body></html>";

function createMockClient() {
  return {
    callTool: mockCallTool,
  };
}

function mockNavigateResult() {
  return { content: [], isError: false };
}

function mockEvaluateResult(html: string) {
  return {
    content: [{ type: "text", text: html }],
    isError: false,
  };
}

describe("createChromeMcpPageLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    mockGetClient.mockResolvedValue(createMockClient());
  });

  it("returns a PageLoader with no fetchHtml and a renderHtml function", () => {
    const loader = createChromeMcpPageLoader({});

    expect(loader.fetchHtml).toBeUndefined();
    expect(loader.renderHtml).toBeDefined();
    expect(typeof loader.renderHtml).toBe("function");
  });

  it("renderHtml navigates to the URL and extracts outerHTML", async () => {
    mockCallTool
      .mockResolvedValueOnce(mockNavigateResult())
      .mockResolvedValueOnce(mockEvaluateResult(MOCK_HTML));

    const loader = createChromeMcpPageLoader({});
    const result = await loader.renderHtml!("https://example.com", {});

    expect(result).toBe(MOCK_HTML);
    expect(mockCallTool).toHaveBeenCalledTimes(2);
    expect(mockCallTool).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: "navigate_page",
        arguments: {
          type: "url",
          url: "https://example.com",
          timeout: expect.any(Number),
        },
      }),
      undefined,
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(mockCallTool).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: "evaluate_script",
        arguments: {
          function: "() => document.documentElement.outerHTML",
        },
      }),
      undefined,
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("renderHtml returns null when evaluate result is an error", async () => {
    mockCallTool
      .mockResolvedValueOnce(mockNavigateResult())
      .mockResolvedValueOnce({ content: [], isError: true });

    const loader = createChromeMcpPageLoader({});
    const result = await loader.renderHtml!("https://example.com", {});

    expect(result).toBeNull();
  });

  it("renderHtml returns null when evaluate result has no text content", async () => {
    mockCallTool
      .mockResolvedValueOnce(mockNavigateResult())
      .mockResolvedValueOnce({ content: [{ type: "image" }], isError: false });

    const loader = createChromeMcpPageLoader({});
    const result = await loader.renderHtml!("https://example.com", {});

    expect(result).toBeNull();
  });

  it("renderHtml returns null when not in Tauri environment", async () => {
    vi.mocked(isTauri).mockReturnValue(false);

    const loader = createChromeMcpPageLoader({});
    const result = await loader.renderHtml!("https://example.com", {});

    expect(result).toBeNull();
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it("renderHtml propagates MCP client errors", async () => {
    mockGetClient.mockRejectedValue(new Error("Chrome MCP is not connected"));

    const loader = createChromeMcpPageLoader({});
    await expect(loader.renderHtml!("https://example.com", {}))
      .rejects.toThrow("Chrome MCP is not connected");
  });

  it("renderHtml propagates navigate errors", async () => {
    mockCallTool.mockRejectedValueOnce(new Error("Navigation failed"));

    const loader = createChromeMcpPageLoader({});
    await expect(loader.renderHtml!("https://example.com", {}))
      .rejects.toThrow("Navigation failed");
  });

  it("passes connection config to MCP client", async () => {
    mockCallTool
      .mockResolvedValueOnce(mockNavigateResult())
      .mockResolvedValueOnce(mockEvaluateResult(MOCK_HTML));

    const loader = createChromeMcpPageLoader({
      connectionMode: "browser-url",
      browserUrl: "http://127.0.0.1:9222",
    });
    await loader.renderHtml!("https://example.com", {});

    expect(mockGetClient).toHaveBeenCalledWith({
      connectionMode: "browser-url",
      browserUrl: "http://127.0.0.1:9222",
    });
  });

  it("renderHtml handles empty content array", async () => {
    mockCallTool
      .mockResolvedValueOnce(mockNavigateResult())
      .mockResolvedValueOnce({ content: [], isError: false });

    const loader = createChromeMcpPageLoader({});
    const result = await loader.renderHtml!("https://example.com", {});

    expect(result).toBeNull();
  });

  it("renderHtml handles missing content field", async () => {
    mockCallTool
      .mockResolvedValueOnce(mockNavigateResult())
      .mockResolvedValueOnce({ isError: false });

    const loader = createChromeMcpPageLoader({});
    const result = await loader.renderHtml!("https://example.com", {});

    expect(result).toBeNull();
  });
});
