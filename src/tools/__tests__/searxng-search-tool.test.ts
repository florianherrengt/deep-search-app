import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauriMocks);

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
});
