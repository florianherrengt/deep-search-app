import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => tauriMocks);
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: <T>(fn: () => Promise<T>) => fn(),
}));

import { createTavilySearchTool } from "@/tools/tavily-search-tool";

type ExecutableTavilyTool = {
  execute: (input: {
    query: string;
  }) => Promise<string>;
};

describe("createTavilySearchTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps Tavily search results and trims the API key", async () => {
    const tool = createTavilySearchTool(
      " tvly-test-key ",
    ) as unknown as ExecutableTavilyTool;
    tauriMocks.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        query: "standing desk",
        results: [
          {
            title: "Desk review",
            url: "https://example.com/desk",
            content: "Compact standing desk review.",
            score: 0.91,
          },
        ],
      }),
    });

    await expect(tool.execute({ query: "standing desk" })).resolves.toBe(
      "Desk review: https://example.com/desk\nCompact standing desk review.",
    );
    expect(tauriMocks.fetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tvly-test-key",
        }),
        body: JSON.stringify({
          query: "standing desk",
          search_depth: "basic",
          max_results: 5,
        }),
      }),
    );
  });

  it("surfaces Tavily API errors instead of returning an empty result set", async () => {
    const tool = createTavilySearchTool(
      "tvly-test-key",
    ) as unknown as ExecutableTavilyTool;
    tauriMocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => JSON.stringify({ detail: "Invalid API key" }),
    });

    await expect(tool.execute({ query: "standing desk" })).rejects.toThrow(
      "Tavily search failed with HTTP 401 Unauthorized",
    );
  });

  it("surfaces malformed Tavily responses instead of returning an empty result set", async () => {
    const tool = createTavilySearchTool(
      "tvly-test-key",
    ) as unknown as ExecutableTavilyTool;
    tauriMocks.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        query: "standing desk",
        results: [{ title: "Desk review", url: "https://example.com/desk" }],
      }),
    });

    await expect(tool.execute({ query: "standing desk" })).rejects.toThrow(
      "Tavily search response did not match the expected format.",
    );
  });
});
