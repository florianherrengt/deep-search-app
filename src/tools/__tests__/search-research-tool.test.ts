import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauriMocks);

vi.mock("@/lib/research-relevance-evaluator", () => ({
  evaluateResearchRelevance: vi.fn((_query, results) => Promise.resolve(results)),
}));

import { createSearchResearchTool } from "@/tools/search-research-tool";

type ExecutableSearchTool = {
  execute: (input: {
    query: string;
    folder?: string;
    limit?: number;
  }) => Promise<Array<{ folder_name: string }>>;
};

function mockModel() {
  return {} as any;
}

describe("createSearchResearchTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns deduped folder names without chunk content", async () => {
    const tool = createSearchResearchTool(
      "test-key",
      mockModel(),
    ) as unknown as ExecutableSearchTool;
    tauriMocks.invoke.mockResolvedValueOnce([
      {
        folder_name: "market-map",
        filename: "notes.md",
        content: "large chunk that should not be returned",
        score: 0.9,
      },
      {
        folder_name: "market-map",
        filename: "findings.md",
        content: "another chunk",
        score: 0.8,
      },
      {
        folder_name: "competitors",
        filename: "notes.md",
        content: "third chunk",
        score: 0.7,
      },
    ]);

    await expect(tool.execute({ query: "market size" })).resolves.toEqual([
      { folder_name: "market-map" },
      { folder_name: "competitors" },
    ]);
  });

  it("passes queries array and search options to the backend command", async () => {
    const tool = createSearchResearchTool(
      "test-key",
      mockModel(),
    ) as unknown as ExecutableSearchTool;
    tauriMocks.invoke.mockResolvedValueOnce([]);

    await tool.execute({
      query: "market size",
      folder: "market-map",
      limit: 3,
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith("search_research", {
      apiKey: "test-key",
      queries: ["market size"],
      folder: "market-map",
      limit: 3,
    });
  });

  it("returns empty and logs when the backend search command fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tool = createSearchResearchTool(
      "test-key",
      mockModel(),
    ) as unknown as ExecutableSearchTool;
    tauriMocks.invoke.mockRejectedValueOnce(
      new Error("Failed to parse embedding response: error decoding response body"),
    );

    await expect(tool.execute({ query: "best places to hike" })).resolves.toEqual(
      [],
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[search-research-tool] invoke failed:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
