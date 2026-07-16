import { beforeEach, describe, expect, it, vi } from "vitest";

const searchMocks = vi.hoisted(() => ({
  searchChatHistoryHybrid: vi.fn(),
  searchResearchMemoriesHybrid: vi.fn(),
}));

vi.mock("@/lib/chat-history-search", () => searchMocks);

import { createSearchResearchTool } from "@/tools/search-research-tool";

type ExecutableSearchTool = {
  execute: (
    input: { query: string | string[]; limit?: number },
    options?: { abortSignal?: AbortSignal },
  ) => Promise<
    Array<Record<string, unknown>>
  >;
};

beforeEach(() => {
  vi.clearAllMocks();
  searchMocks.searchChatHistoryHybrid.mockResolvedValue([]);
  searchMocks.searchResearchMemoriesHybrid.mockResolvedValue([]);
});

describe("createSearchResearchTool", () => {
  it("returns exact chats from the local hybrid index", async () => {
    const tool = createSearchResearchTool() as unknown as ExecutableSearchTool;
    searchMocks.searchChatHistoryHybrid.mockResolvedValueOnce([
      {
        folderName: "market-map",
        chatId: "chat-market-size",
        title: "European market size",
        matchedText: "Estimate the 2026 European market size",
        updatedAt: "2026-07-12T10:00:00.000Z",
        score: 0.91,
      },
    ]);

    await expect(tool.execute({ query: "market size" })).resolves.toEqual([
      {
        result_type: "research_chat",
        folder_name: "market-map",
        chat_id: "chat-market-size",
        title: "European market size",
        matched_query: "Estimate the 2026 European market size",
        updated_at: "2026-07-12T10:00:00.000Z",
        score: 0.91,
        relevant_memories: [],
      },
    ]);
    expect(searchMocks.searchChatHistoryHybrid).toHaveBeenCalledWith(
      "market size",
      { abortSignal: undefined, exclude: undefined, limit: 8 },
    );
    expect(searchMocks.searchResearchMemoriesHybrid).toHaveBeenCalledWith(
      "market size",
      { abortSignal: undefined, exclude: undefined, limit: 8 },
    );
  });

  it("passes multiple queries, the result limit, and cancellation through", async () => {
    const tool = createSearchResearchTool() as unknown as ExecutableSearchTool;
    const controller = new AbortController();

    await tool.execute(
      { query: ["market size", "competitor analysis"], limit: 3 },
      { abortSignal: controller.signal },
    );

    expect(searchMocks.searchChatHistoryHybrid).toHaveBeenCalledWith(
      ["market size", "competitor analysis"],
      { abortSignal: controller.signal, exclude: undefined, limit: 3 },
    );
    expect(searchMocks.searchResearchMemoriesHybrid).toHaveBeenCalledWith(
      ["market size", "competitor analysis"],
      { abortSignal: controller.signal, exclude: undefined, limit: 3 },
    );
  });

  it("propagates memory-search cancellation", async () => {
    const tool = createSearchResearchTool() as unknown as ExecutableSearchTool;
    const controller = new AbortController();
    const abortError = new DOMException("Aborted", "AbortError");
    searchMocks.searchResearchMemoriesHybrid.mockRejectedValueOnce(abortError);
    controller.abort();

    await expect(
      tool.execute(
        { query: "market size" },
        { abortSignal: controller.signal },
      ),
    ).rejects.toBe(abortError);
  });

  it("excludes the current research folder", async () => {
    const tool = createSearchResearchTool(
      async () => "market-map",
    ) as unknown as ExecutableSearchTool;

    await tool.execute({ query: "market size" });

    expect(searchMocks.searchChatHistoryHybrid).toHaveBeenCalledWith(
      "market size",
      {
        abortSignal: undefined,
        exclude: { folderName: "market-map" },
        limit: 8,
      },
    );
    expect(searchMocks.searchResearchMemoriesHybrid).toHaveBeenCalledWith(
      "market size",
      {
        abortSignal: undefined,
        exclude: { folderName: "market-map" },
        limit: 8,
      },
    );
  });

  it("attaches same-folder memories and returns memory-only matches separately", async () => {
    const tool = createSearchResearchTool() as unknown as ExecutableSearchTool;
    searchMocks.searchChatHistoryHybrid.mockResolvedValueOnce([
      {
        recordKind: "chat",
        folderName: "market-map",
        chatId: "chat-market-size",
        title: "European market size",
        matchedText: "Estimate the European market size",
        updatedAt: null,
        score: 0.91,
      },
    ]);
    searchMocks.searchResearchMemoriesHybrid.mockResolvedValueOnce([
      {
        folderName: "market-map",
        memory: "User prefers France-focused results.",
        updatedAt: null,
        score: 0.88,
      },
      {
        folderName: "software-setup",
        memory: "User uses macOS.",
        updatedAt: null,
        score: 0.81,
      },
    ]);

    await expect(tool.execute({ query: "French market analysis" })).resolves.toEqual([
      {
        result_type: "research_chat",
        folder_name: "market-map",
        chat_id: "chat-market-size",
        title: "European market size",
        matched_query: "Estimate the European market size",
        updated_at: null,
        score: 0.91,
        relevant_memories: ["User prefers France-focused results."],
      },
      {
        result_type: "memory",
        source_folder: "software-setup",
        memory: "User uses macOS.",
        updated_at: null,
        score: 0.81,
      },
    ]);
  });
});
