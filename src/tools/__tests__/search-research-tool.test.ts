import { beforeEach, describe, expect, it, vi } from "vitest";

const searchMocks = vi.hoisted(() => ({
  searchChatHistoryHybrid: vi.fn(),
}));

vi.mock("@/lib/chat-history-search", () => searchMocks);

import { createSearchResearchTool } from "@/tools/search-research-tool";

type ExecutableSearchTool = {
  execute: (
    input: { query: string | string[]; limit?: number },
    options?: { abortSignal?: AbortSignal },
  ) => Promise<
    Array<{
      folder_name: string;
      chat_id: string;
      title: string;
      matched_query: string;
      updated_at: string | null;
      score: number;
      relevant_memories: string[];
    }>
  >;
};

beforeEach(() => {
  vi.clearAllMocks();
  searchMocks.searchChatHistoryHybrid.mockResolvedValue([]);
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
  });

  it("excludes only the current chat, not its whole research folder", async () => {
    const tool = createSearchResearchTool(
      async () => "market-map",
      async () => "current-chat",
    ) as unknown as ExecutableSearchTool;

    await tool.execute({ query: "market size" });

    expect(searchMocks.searchChatHistoryHybrid).toHaveBeenCalledWith(
      "market size",
      {
        abortSignal: undefined,
        exclude: { folderName: "market-map", chatId: "current-chat" },
        limit: 8,
      },
    );
  });

  it("does not exclude a folder when the current chat id is unknown", async () => {
    const tool = createSearchResearchTool(
      async () => "market-map",
    ) as unknown as ExecutableSearchTool;

    await tool.execute({ query: "market size" });

    expect(searchMocks.searchChatHistoryHybrid).toHaveBeenCalledWith(
      "market size",
      expect.objectContaining({ exclude: undefined }),
    );
  });
});
