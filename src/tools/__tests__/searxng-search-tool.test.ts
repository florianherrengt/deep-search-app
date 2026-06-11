import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => ({ invoke: tauriMocks.invoke }));

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
    tauriMocks.invoke.mockResolvedValueOnce(
      JSON.stringify({
        results: [
          {
            title: "Local result",
            url: "https://example.com",
            content: "From local SearXNG",
          },
        ],
      }),
    );

    await expect(tool.execute({ query: "test query" })).resolves.toBe(
      "Local result: https://example.com\nFrom local SearXNG",
    );
    expect(tauriMocks.invoke).toHaveBeenCalledWith("fetch_searxng_json", {
      baseUrl: "http://localhost:8080",
      query: "test query",
    });
  });

  it("defaults baseUrl to http://localhost:8080 when none is provided", async () => {
    const tool = createSearXNGSearchTool() as unknown as ExecutableSearXNGTool;
    tauriMocks.invoke.mockResolvedValueOnce(
      JSON.stringify({
        results: [
          {
            title: "Result",
            url: "https://example.com",
            content: "Content",
          },
        ],
      }),
    );

    await tool.execute({ query: "test query" });

    expect(tauriMocks.invoke).toHaveBeenCalledWith("fetch_searxng_json", {
      baseUrl: "http://localhost:8080",
      query: "test query",
    });
  });

  it("returns 'No results found' when invoke returns null", async () => {
    const tool = createSearXNGSearchTool(
      "http://localhost:8080",
    ) as unknown as ExecutableSearXNGTool;
    tauriMocks.invoke.mockResolvedValueOnce(null);

    await expect(tool.execute({ query: "test query" })).resolves.toBe(
      "No results found.",
    );
  });

  it("returns 'No results found' for empty results", async () => {
    const tool = createSearXNGSearchTool(
      "http://localhost:8080",
    ) as unknown as ExecutableSearXNGTool;
    tauriMocks.invoke.mockResolvedValueOnce(
      JSON.stringify({ results: [] }),
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
