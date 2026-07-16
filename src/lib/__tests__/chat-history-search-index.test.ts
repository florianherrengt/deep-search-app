import { describe, expect, it } from "vitest";
import {
  ChatHistorySearchIndex,
  type ChatHistorySearchRecord,
} from "@/lib/chat-history-search-index";

const VECTOR_SIZE = 384;

function vector(first: number, second = 0): number[] {
  const value = new Array<number>(VECTOR_SIZE).fill(0);
  value[0] = first;
  value[1] = second;
  return value;
}

const records: ChatHistorySearchRecord[] = [
  {
    id: "market/chat-a/user-1",
    recordKind: "chat",
    folderName: "market-research",
    chatId: "chat-a",
    title: "European coffee market",
    query: "Compare espresso machine demand in France",
    updatedAt: "2026-07-10T12:00:00.000Z",
  },
  {
    id: "market/chat-a/user-2",
    recordKind: "chat",
    folderName: "market-research",
    chatId: "chat-a",
    title: "European coffee market",
    query: "Find independent sales estimates",
    updatedAt: "2026-07-10T12:00:00.000Z",
  },
  {
    id: "travel/chat-b/user-1",
    recordKind: "chat",
    folderName: "norway-travel",
    chatId: "chat-b",
    title: "Norway hiking itinerary",
    query: "Quiet multi-day hikes near Bergen",
    updatedAt: "2026-07-11T12:00:00.000Z",
  },
];

const secondActiveFolderChat: ChatHistorySearchRecord = {
  id: "market/chat-c/user-1",
  recordKind: "chat",
  folderName: "market-research",
  chatId: "chat-c",
  title: "Outdoor retail market",
  query: "Hiking equipment sales in France",
  updatedAt: "2026-07-12T12:00:00.000Z",
};

describe("ChatHistorySearchIndex", () => {
  it("supports an empty chat library", async () => {
    const index = await ChatHistorySearchIndex.create([]);
    await expect(index.searchKeyword("anything")).resolves.toEqual([]);
  });

  it("finds typo-tolerant keyword matches and groups query hits by exact chat", async () => {
    const index = await ChatHistorySearchIndex.create(records);

    const results = await index.searchKeyword("independant sales", { limit: 10 });

    expect(results).toEqual([
      expect.objectContaining({
        folderName: "market-research",
        chatId: "chat-a",
        title: "European coffee market",
        matchedText: "Find independent sales estimates",
      }),
    ]);
  });

  it("returns the best matching query once when several messages in one chat match", async () => {
    const index = await ChatHistorySearchIndex.create(records);

    const results = await index.searchKeyword("market sales estimates", { limit: 10 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      folderName: "market-research",
      chatId: "chat-a",
    });
  });

  it("excludes every chat in the active folder before applying the result limit", async () => {
    const index = await ChatHistorySearchIndex.create([
      ...records,
      secondActiveFolderChat,
    ]);

    const results = await index.searchKeyword("hiking market", {
      exclude: { folderName: "market-research" },
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      folderName: "norway-travel",
      chatId: "chat-b",
    });
  });

  it("uses semantic similarity when keyword text does not overlap", async () => {
    const index = await ChatHistorySearchIndex.create(records, {
      embeddings: {
        "market/chat-a/user-1": vector(1),
        "market/chat-a/user-2": vector(0, 1),
        "travel/chat-b/user-1": vector(-1),
      },
    });

    const results = await index.searchHybrid("coffee appliance adoption", vector(1), {
      limit: 2,
      similarity: 0.5,
    });

    expect(results[0]).toMatchObject({
      folderName: "market-research",
      chatId: "chat-a",
      matchedText: "Compare espresso machine demand in France",
    });
  });

  it("applies active-folder exclusion to hybrid search", async () => {
    const index = await ChatHistorySearchIndex.create(
      [...records, secondActiveFolderChat],
      {
        embeddings: {
          "market/chat-a/user-1": vector(1),
          "market/chat-a/user-2": vector(0, 1),
          "market/chat-c/user-1": vector(-1),
          "travel/chat-b/user-1": vector(-1),
        },
      },
    );

    const results = await index.searchHybrid("hiking market", vector(-1), {
      exclude: { folderName: "market-research" },
      limit: 10,
      similarity: 0.5,
    });

    expect(results).toEqual([
      expect.objectContaining({
        folderName: "norway-travel",
        chatId: "chat-b",
      }),
    ]);
  });

  it("searches memory facts separately from chat history", async () => {
    const memoryRecord: ChatHistorySearchRecord = {
      id: "memory/preferences/eur",
      recordKind: "memory",
      folderName: "travel-preferences",
      chatId: "",
      title: "",
      query: "User prefers prices in EUR.",
      updatedAt: "2026-07-12T12:00:00.000Z",
    };
    const index = await ChatHistorySearchIndex.create([...records, memoryRecord]);

    await expect(
      index.searchKeyword("prices EUR", { recordKind: "memory" }),
    ).resolves.toEqual([
      expect.objectContaining({
        recordKind: "memory",
        folderName: "travel-preferences",
        matchedText: "User prefers prices in EUR.",
      }),
    ]);
    const chatResults = await index.searchKeyword("prices EUR", {
      recordKind: "chat",
    });
    expect(chatResults.every((result) => result.recordKind === "chat")).toBe(
      true,
    );
    expect(
      chatResults.some(
        (result) => result.matchedText === "User prefers prices in EUR.",
      ),
    ).toBe(false);
  });

  it("combines memory-kind filtering with active-folder exclusion", async () => {
    const memoryRecords: ChatHistorySearchRecord[] = [
      {
        id: "memory/active/eur",
        recordKind: "memory",
        folderName: "market-research",
        chatId: "",
        title: "",
        query: "User prefers market prices in EUR.",
        updatedAt: null,
      },
      {
        id: "memory/external/eur",
        recordKind: "memory",
        folderName: "travel-preferences",
        chatId: "",
        title: "",
        query: "User prefers travel prices in EUR.",
        updatedAt: null,
      },
    ];
    const index = await ChatHistorySearchIndex.create(memoryRecords, {
      embeddings: {
        "memory/active/eur": vector(1),
        "memory/external/eur": vector(1),
      },
    });
    const options = {
      exclude: { folderName: "market-research" },
      recordKind: "memory" as const,
      limit: 10,
    };

    await expect(index.searchKeyword("prices EUR", options)).resolves.toEqual([
      expect.objectContaining({
        recordKind: "memory",
        folderName: "travel-preferences",
      }),
    ]);
    await expect(
      index.searchHybrid("cost preference", vector(1), {
        ...options,
        similarity: 0.5,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        recordKind: "memory",
        folderName: "travel-preferences",
      }),
    ]);
  });
});
