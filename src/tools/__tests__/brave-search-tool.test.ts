import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => tauriMocks);
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: <T>(fn: () => Promise<T>) => fn(),
}));

import { createBraveSearchTool } from "@/tools/brave-search-tool";

type ExecutableTool = {
  execute: (input: { query: string }) => Promise<string>;
};

describe("createBraveSearchTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces HTTP errors instead of returning empty results", async () => {
    const tool = createBraveSearchTool("test-key") as unknown as ExecutableTool;
    tauriMocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "",
    });

    await expect(tool.execute({ query: "test" })).rejects.toThrow(
      "Brave search failed with HTTP 429 Too Many Requests",
    );
  });

  it("surfaces 403 errors with response body", async () => {
    const tool = createBraveSearchTool("bad-key") as unknown as ExecutableTool;
    tauriMocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => JSON.stringify({ error: "Invalid API key" }),
    });

    await expect(tool.execute({ query: "test" })).rejects.toThrow(
      "Brave search failed with HTTP 403 Forbidden",
    );
  });

  it("returns formatted results for successful responses", async () => {
    const tool = createBraveSearchTool("test-key") as unknown as ExecutableTool;
    tauriMocks.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          web: {
            results: [
              {
                title: "Test Result",
                url: "https://example.com",
                description: "A test result.",
              },
            ],
          },
        }),
    });

    const result = await tool.execute({ query: "test" });
    expect(result).toContain("Test Result");
    expect(result).toContain("https://example.com");
  });

  it("returns 'No results found.' for empty web results", async () => {
    const tool = createBraveSearchTool("test-key") as unknown as ExecutableTool;
    tauriMocks.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ web: { results: [] } }),
    });

    await expect(tool.execute({ query: "test" })).resolves.toBe(
      "No results found.",
    );
  });
});
