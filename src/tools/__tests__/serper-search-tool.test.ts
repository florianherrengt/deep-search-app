import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => tauriMocks);
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: <T>(fn: () => Promise<T>) => fn(),
}));

import { createSerperSearchTool } from "@/tools/serper-search-tool";

type ExecutableSerperTool = {
  execute: (input: {
    query: string;
  }) => Promise<string>;
};

describe("createSerperSearchTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps Serper organic results and trims the API key", async () => {
    const tool = createSerperSearchTool(
      " serper-test-key ",
    ) as unknown as ExecutableSerperTool;
    tauriMocks.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        organic: [
          {
            title: "Coastal camping review",
            link: "https://example.com/review",
            snippet: "A long-form review of a coastal kayak camping trip.",
            position: 1,
          },
          {
            title: "Snippetless result",
            link: "https://example.com/snippetless",
            position: 2,
          },
        ],
      }),
    });

    await expect(
      tool.execute({
        query: "Hobie Adventure Island expedition coastal camping review",
      }),
    ).resolves.toBe(
      "Coastal camping review: https://example.com/review\nA long-form review of a coastal kayak camping trip.\n-\nSnippetless result: https://example.com/snippetless\n",
    );
    expect(tauriMocks.fetch).toHaveBeenCalledWith(
      "https://google.serper.dev/search",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-API-KEY": "serper-test-key",
        }),
        body: JSON.stringify({
          q: "Hobie Adventure Island expedition coastal camping review",
        }),
      }),
    );
  });

  it("surfaces Serper API errors instead of returning an empty result set", async () => {
    const tool = createSerperSearchTool(
      "serper-test-key",
    ) as unknown as ExecutableSerperTool;
    tauriMocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => JSON.stringify({ message: "Invalid API key" }),
    });

    await expect(tool.execute({ query: "coastal camping" })).rejects.toThrow(
      "Serper search failed with HTTP 403 Forbidden",
    );
  });

  it("returns 'No results found.' for empty organic results", async () => {
    const tool = createSerperSearchTool(
      "serper-test-key",
    ) as unknown as ExecutableSerperTool;
    tauriMocks.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ organic: [] }),
    });

    await expect(tool.execute({ query: "coastal camping" })).resolves.toBe(
      "No results found.",
    );
  });

  it("defaults missing snippet to empty string", async () => {
    const tool = createSerperSearchTool(
      "serper-test-key",
    ) as unknown as ExecutableSerperTool;
    tauriMocks.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        organic: [
          {
            title: "No snippet here",
            link: "https://example.com/no-snippet",
          },
        ],
      }),
    });

    await expect(tool.execute({ query: "test" })).resolves.toBe(
      "No snippet here: https://example.com/no-snippet\n",
    );
  });

  it("surfaces malformed Serper responses instead of returning an empty result set", async () => {
    const tool = createSerperSearchTool(
      "serper-test-key",
    ) as unknown as ExecutableSerperTool;
    tauriMocks.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ organic: "not an array" }),
    });

    await expect(tool.execute({ query: "coastal camping" })).rejects.toThrow(
      "Serper search response did not match the expected format:",
    );
  });
});
