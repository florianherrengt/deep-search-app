import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => tauriMocks);

import { createExaSearchTool } from "@/tools/exa-search-tool";

type ExecutableTool = {
  execute: (input: { query: string }) => Promise<string>;
};

describe("createExaSearchTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces HTTP errors instead of returning empty results", async () => {
    const tool = createExaSearchTool("test-key") as unknown as ExecutableTool;
    tauriMocks.fetch.mockResolvedValueOnce(
      new Response("", { status: 401, statusText: "Unauthorized" }),
    );

    await expect(tool.execute({ query: "test" })).rejects.toThrow(
      "Exa search failed with HTTP 401",
    );
  });

  it("surfaces 500 errors", async () => {
    const tool = createExaSearchTool("test-key") as unknown as ExecutableTool;
    tauriMocks.fetch.mockResolvedValueOnce(
      new Response("upstream timeout", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    await expect(tool.execute({ query: "test" })).rejects.toThrow(
      "Exa search failed with HTTP 500",
    );
  });

  it("returns formatted results for successful responses", async () => {
    const tool = createExaSearchTool("test-key") as unknown as ExecutableTool;
    tauriMocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Exa Result",
              url: "https://example.com",
              text: "A test result from Exa.",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await tool.execute({ query: "test" });
    expect(result).toContain("Exa Result");
    expect(result).toContain("https://example.com");
  });

  it("returns 'No results found.' for empty results", async () => {
    const tool = createExaSearchTool("test-key") as unknown as ExecutableTool;
    tauriMocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );

    await expect(tool.execute({ query: "test" })).resolves.toBe(
      "No results found.",
    );
  });
});
