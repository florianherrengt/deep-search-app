import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  listAppSubfolders: vi.fn(),
}));

const folderSearchMocks = vi.hoisted(() => ({
  searchFoldersWithLLMSafe: vi.fn(),
}));

vi.mock("@/lib/app-file-storage", () => ({
  listAppSubfolders: storageMocks.listAppSubfolders,
  SafePathSegmentSchema: { parse: (v: string) => v },
}));
vi.mock("@/lib/folder-search", () => folderSearchMocks);

import { createSearchResearchTool } from "@/tools/search-research-tool";

type ExecutableSearchTool = {
  execute: (input: {
    query: string | string[];
    limit?: number;
  }) => Promise<Array<{ folder_name: string; relevant_memories: string[] }>>;
};

function mockModel() {
  return {} as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSearchResearchTool", () => {
  it("returns folders selected by the LLM with empty memories", async () => {
    const tool = createSearchResearchTool(mockModel()) as unknown as ExecutableSearchTool;
    storageMocks.listAppSubfolders.mockResolvedValueOnce([
      "market-map",
      "competitors",
      "hiking-spots",
    ]);
    folderSearchMocks.searchFoldersWithLLMSafe.mockResolvedValueOnce([
      "market-map",
      "competitors",
    ]);

    await expect(tool.execute({ query: "market size" })).resolves.toEqual([
      { folder_name: "market-map", relevant_memories: [] },
      { folder_name: "competitors", relevant_memories: [] },
    ]);

    expect(folderSearchMocks.searchFoldersWithLLMSafe).toHaveBeenCalledWith(
      "market size",
      ["market-map", "competitors", "hiking-spots"],
      expect.anything(),
      undefined,
    );
  });

  it("returns empty when there are no research folders", async () => {
    const tool = createSearchResearchTool(mockModel()) as unknown as ExecutableSearchTool;
    storageMocks.listAppSubfolders.mockResolvedValueOnce([]);

    await expect(tool.execute({ query: "anything" })).resolves.toEqual([]);
    expect(folderSearchMocks.searchFoldersWithLLMSafe).not.toHaveBeenCalled();
  });

  it("joins multiple queries into a single string for the LLM", async () => {
    const tool = createSearchResearchTool(mockModel()) as unknown as ExecutableSearchTool;
    storageMocks.listAppSubfolders.mockResolvedValueOnce(["stocks"]);
    folderSearchMocks.searchFoldersWithLLMSafe.mockResolvedValueOnce(["stocks"]);

    await tool.execute({ query: ["market size", "competitor analysis"] });

    expect(folderSearchMocks.searchFoldersWithLLMSafe).toHaveBeenCalledWith(
      "market size competitor analysis",
      ["stocks"],
      expect.anything(),
      undefined,
    );
  });

  it("excludes the current research folder from matching and results", async () => {
    const tool = createSearchResearchTool(
      mockModel(),
      async () => "market-map",
    ) as unknown as ExecutableSearchTool;
    storageMocks.listAppSubfolders.mockResolvedValueOnce([
      "market-map",
      "competitors",
      "hiking-spots",
    ]);
    folderSearchMocks.searchFoldersWithLLMSafe.mockResolvedValueOnce([
      "market-map",
      "competitors",
    ]);

    await expect(tool.execute({ query: "market size" })).resolves.toEqual([
      { folder_name: "competitors", relevant_memories: [] },
    ]);

    expect(folderSearchMocks.searchFoldersWithLLMSafe).toHaveBeenCalledWith(
      "market size",
      ["competitors", "hiking-spots"],
      expect.anything(),
      undefined,
    );
  });

  it("returns empty when listing folders fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tool = createSearchResearchTool(mockModel()) as unknown as ExecutableSearchTool;
    storageMocks.listAppSubfolders.mockRejectedValueOnce(new Error("disk error"));

    await expect(tool.execute({ query: "best places to hike" })).resolves.toEqual(
      [],
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[search-research-tool] failed to list folders:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
