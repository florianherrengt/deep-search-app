import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => tauriMocks);

import { createSearXNGSearchTool } from "@/tools/searxng-search-tool";

type ExecutableSearXNGTool = {
  execute: (input: {
    query: string;
  }) => Promise<string>;
};

describe("createSearXNGSearchTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supports local configured SearXNG endpoints", async () => {
    const tool = createSearXNGSearchTool(
      "http://localhost:8080",
    ) as unknown as ExecutableSearXNGTool;
    tauriMocks.fetch.mockResolvedValueOnce(
      mockResponse(200, {
        results: [
          { title: "Local result", url: "https://example.com", content: "From local SearXNG" },
        ],
      }),
    );

    await expect(tool.execute({ query: "test query" })).resolves.toBe(
      "Local result: https://example.com\nFrom local SearXNG",
    );
  });

  it("defaults baseUrl to http://localhost:8080 when none is provided", async () => {
    const tool = createSearXNGSearchTool() as unknown as ExecutableSearXNGTool;
    tauriMocks.fetch.mockResolvedValueOnce(
      mockResponse(200, {
        results: [
          { title: "Result", url: "https://example.com", content: "Content" },
        ],
      }),
    );

    await expect(tool.execute({ query: "test query" })).resolves.toBe(
      "Result: https://example.com\nContent",
    );
  });

  it("surfaces HTTP errors instead of returning empty results", async () => {
    const tool = createSearXNGSearchTool(
      "http://localhost:8080",
    ) as unknown as ExecutableSearXNGTool;
    tauriMocks.fetch.mockResolvedValueOnce(
      mockResponse(502, undefined, false, "Bad Gateway", "upstream error"),
    );

    await expect(tool.execute({ query: "test query" })).rejects.toThrow(
      "SearXNG search failed with HTTP 502",
    );
  });

  it("returns 'No results found' for empty results", async () => {
    const tool = createSearXNGSearchTool(
      "http://localhost:8080",
    ) as unknown as ExecutableSearXNGTool;
    tauriMocks.fetch.mockResolvedValueOnce(
      mockResponse(200, { results: [] }),
    );

    await expect(tool.execute({ query: "test query" })).resolves.toBe(
      "No results found.",
    );
  });

  it("throws for invalid baseUrl", () => {
    expect(() => createSearXNGSearchTool("not-a-valid-url")).toThrow();
  });

  it("throws for baseUrl with unsupported protocol", () => {
    expect(() => createSearXNGSearchTool("ftp://invalid-protocol.com")).toThrow();
  });
});

function mockResponse(
  status: number,
  body?: unknown,
  ok = true,
  statusText = "",
  textOverride?: string,
) {
  const textContent = textOverride ?? JSON.stringify(body);
  return {
    ok,
    status,
    statusText,
    text: async () => textContent,
  };
}
