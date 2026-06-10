import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";

const mockEmbeddingConfig: EmbeddingConfig = { api_key: "test-key", base_url: "https://openrouter.ai/api/v1", model: "qwen/qwen3-embedding-4b", dimensions: 1024, query_prefix: "Represent this sentence for searching relevant passages: " };
const mockRerankerConfig: RerankerConfig = { api_key: "test-key", base_url: "https://openrouter.ai/api/v1", model: "cohere/rerank-4-pro" };

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

const retrievalMocks = vi.hoisted(() => ({
  runRetrievalAgent: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauriMocks);
vi.mock("@/lib/retrieval-agent", () => retrievalMocks);

import { createSearchResearchTool } from "@/tools/search-research-tool";

type ExecutableSearchTool = {
  execute: (input: {
    query: string | string[];
    folder?: string;
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
  it("returns relevant folders with memories from the retrieval agent", async () => {
    const tool = createSearchResearchTool(
      mockEmbeddingConfig,
      mockRerankerConfig,
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
    retrievalMocks.runRetrievalAgent.mockResolvedValueOnce({
      relevant_folders: ["market-map", "competitors"],
      relevant_memories: ["User prefers EUR"],
    });

    await expect(tool.execute({ query: "market size" })).resolves.toEqual([
      { folder_name: "market-map", relevant_memories: ["User prefers EUR"] },
      { folder_name: "competitors", relevant_memories: ["User prefers EUR"] },
    ]);
  });

  it("returns memories even when no folders are relevant", async () => {
    const tool = createSearchResearchTool(
      mockEmbeddingConfig,
      mockRerankerConfig,
      mockModel(),
    ) as unknown as ExecutableSearchTool;
    tauriMocks.invoke.mockResolvedValueOnce([
      {
        folder_name: "old-folder",
        filename: "memories.md",
        content: "User has a dog",
        score: 0.3,
      },
    ]);
    retrievalMocks.runRetrievalAgent.mockResolvedValueOnce({
      relevant_folders: [],
      relevant_memories: ["User has a dog"],
    });

    await expect(tool.execute({ query: "dog parks" })).resolves.toEqual([
      { folder_name: "", relevant_memories: ["User has a dog"] },
    ]);
  });

  it("passes queries array and search options to the backend command", async () => {
    const tool = createSearchResearchTool(
      mockEmbeddingConfig,
      mockRerankerConfig,
      mockModel(),
    ) as unknown as ExecutableSearchTool;
    tauriMocks.invoke.mockResolvedValueOnce([]);

    await tool.execute({
      query: "market size",
      folder: "market-map",
      limit: 3,
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith("search_research", {
      embeddingConfig: mockEmbeddingConfig,
      rerankerConfig: mockRerankerConfig,
      queries: ["market size"],
      folder: "market-map",
      limit: 3,
      filenames: null,
    });
  });

  it("accepts multiple queries and joins them for the retrieval agent", async () => {
    const tool = createSearchResearchTool(
      mockEmbeddingConfig,
      mockRerankerConfig,
      mockModel(),
    ) as unknown as ExecutableSearchTool;
    tauriMocks.invoke.mockResolvedValueOnce([
      {
        folder_name: "stocks",
        filename: "notes.md",
        content: "market trends",
        score: 0.9,
      },
    ]);
    retrievalMocks.runRetrievalAgent.mockResolvedValueOnce({
      relevant_folders: ["stocks"],
      relevant_memories: [],
    });

    await tool.execute({
      query: ["market size", "competitor analysis"],
      limit: 5,
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith("search_research", {
      embeddingConfig: mockEmbeddingConfig,
      rerankerConfig: mockRerankerConfig,
      queries: ["market size", "competitor analysis"],
      folder: null,
      limit: 5,
      filenames: null,
    });
    expect(retrievalMocks.runRetrievalAgent).toHaveBeenCalledWith(
      "market size competitor analysis",
      expect.any(Array),
      expect.any(Object),
      undefined,
    );
  });

  it("returns empty and logs when the backend search command fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tool = createSearchResearchTool(
      mockEmbeddingConfig,
      mockRerankerConfig,
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

  it("re-throws AbortError from search invoke", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    const tool = createSearchResearchTool(
      mockEmbeddingConfig,
      mockRerankerConfig,
      mockModel(),
    ) as unknown as ExecutableSearchTool;
    tauriMocks.invoke.mockRejectedValueOnce(abortError);

    await expect(tool.execute({ query: "market size" })).rejects.toBe(
      abortError,
    );
  });

  it("passes empty query string through to the backend invoke", async () => {
    const tool = createSearchResearchTool(
      mockEmbeddingConfig,
      mockRerankerConfig,
      mockModel(),
    ) as unknown as ExecutableSearchTool;
    tauriMocks.invoke.mockResolvedValueOnce([]);

    await tool.execute({ query: "" });

    expect(tauriMocks.invoke).toHaveBeenCalledWith("search_research", {
      embeddingConfig: mockEmbeddingConfig,
      rerankerConfig: mockRerankerConfig,
      queries: [""],
      folder: null,
      limit: 8,
      filenames: null,
    });
  });
});
