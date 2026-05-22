import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauriMocks);

import { createSearchResearchTool } from "@/tools/search-research-tool";

type ExecutableSearchTool = {
  execute: (input: {
    query: string;
    folder?: string;
    limit?: number;
  }) => Promise<Array<{ folder_name: string }>>;
};

describe("createSearchResearchTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns deduped folder names without chunk content", async () => {
    const tool = createSearchResearchTool(
      "test-key",
    ) as unknown as ExecutableSearchTool;
    tauriMocks.invoke.mockResolvedValueOnce([
      {
        folder_name: "market-map",
        filename: "notes.md",
        content: "large chunk that should not be returned",
      },
      {
        folder_name: "market-map",
        filename: "findings.md",
        content: "another chunk",
      },
      {
        folder_name: "competitors",
        filename: "notes.md",
        content: "third chunk",
      },
    ]);

    await expect(tool.execute({ query: "market size" })).resolves.toEqual([
      { folder_name: "market-map" },
      { folder_name: "competitors" },
    ]);
  });

  it("passes search options through to the backend command", async () => {
    const tool = createSearchResearchTool(
      "test-key",
    ) as unknown as ExecutableSearchTool;
    tauriMocks.invoke.mockResolvedValueOnce([]);

    await tool.execute({
      query: "market size",
      folder: "market-map",
      limit: 3,
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith("search_research", {
      apiKey: "test-key",
      query: "market size",
      folder: "market-map",
      limit: 3,
    });
  });

  it("returns no matches when the backend search command fails", async () => {
    const tool = createSearchResearchTool(
      "test-key",
    ) as unknown as ExecutableSearchTool;
    tauriMocks.invoke.mockRejectedValueOnce(
      new Error("Failed to parse embedding response: error decoding response body"),
    );

    await expect(tool.execute({ query: "best places to hike" })).resolves.toEqual(
      [],
    );
  });
});
