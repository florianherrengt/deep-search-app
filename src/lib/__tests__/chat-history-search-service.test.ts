import { describe, expect, it, vi } from "vitest";
import {
  ChatHistorySearchService,
  type ChatHistoryEmbeddingCache,
} from "@/lib/chat-history-search-service";
import type { ChatHistorySearchRecord } from "@/lib/chat-history-search-index";

const VECTOR_SIZE = 384;

function vector(value: number): number[] {
  const embedding = new Array<number>(VECTOR_SIZE).fill(0);
  embedding[0] = value;
  return embedding;
}

const records: ChatHistorySearchRecord[] = [
  {
    id: "record-1",
    recordKind: "chat",
    folderName: "coffee",
    chatId: "chat-1",
    title: "Coffee market",
    query: "Espresso demand in France",
    updatedAt: "2026-07-10T10:00:00.000Z",
  },
  {
    id: "record-2",
    recordKind: "chat",
    folderName: "travel",
    chatId: "chat-2",
    title: "Norway travel",
    query: "Quiet hikes near Bergen",
    updatedAt: "2026-07-11T10:00:00.000Z",
  },
];

describe("ChatHistorySearchService", () => {
  it("serves keyword search without initializing the embedding model", async () => {
    const embed = vi.fn(async () => [vector(1)]);
    const service = createService({ embed });

    const results = await service.searchKeyword("espresso", { limit: 5 });

    expect(results[0]).toMatchObject({ folderName: "coffee", chatId: "chat-1" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("rebuilds from source after a library change", async () => {
    let currentRecords = records;
    let changeListener: () => void = () => undefined;
    const service = createService({
      loadRecords: vi.fn(async () => currentRecords),
      subscribeChanges: (listener) => {
        changeListener = listener;
        return () => undefined;
      },
    });

    await expect(service.searchKeyword("espresso")).resolves.toHaveLength(1);
    currentRecords = [
      ...records,
      {
        id: "record-3",
        recordKind: "chat",
        folderName: "hardware",
        chatId: "chat-3",
        title: "Laptop research",
        query: "ARM laptop battery benchmarks",
        updatedAt: null,
      },
    ];
    changeListener();

    await expect(service.searchKeyword("battery benchmarks")).resolves.toEqual([
      expect.objectContaining({ folderName: "hardware", chatId: "chat-3" }),
    ]);
  });

  it("caches record embeddings and reuses them after index invalidation", async () => {
    const cache: ChatHistoryEmbeddingCache = { entries: {} };
    const embed = vi.fn(async (texts: string[]) =>
      texts.map((text) => (text.includes("Espresso") ? vector(1) : vector(-1))),
    );
    let changeListener: () => void = () => undefined;
    const service = createService({
      embed,
      loadEmbeddingCache: vi.fn(async () => cache),
      saveEmbeddingCache: vi.fn(async () => undefined),
      subscribeChanges: (listener) => {
        changeListener = listener;
        return () => undefined;
      },
    });

    await service.searchHybrid("coffee appliance adoption", { limit: 5 });
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed.mock.calls[0][0]).toEqual(records.map((record) => record.query));

    embed.mockClear();
    changeListener();
    await service.searchHybrid("coffee appliance adoption", { limit: 5 });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][0]).toEqual(["coffee appliance adoption"]);
  });

  it("prunes removed memory entries from the persisted embedding cache", async () => {
    const memoryFact = "User's private preference is France-focused analysis.";
    const memoryRecord: ChatHistorySearchRecord = {
      id: "[\"coffee\",\"memory\",\"opaque-hash\"]",
      recordKind: "memory",
      folderName: "coffee",
      chatId: "",
      title: "",
      query: memoryFact,
      updatedAt: null,
    };
    let currentRecords = [records[0], memoryRecord];
    let changeListener: () => void = () => undefined;
    const cache: ChatHistoryEmbeddingCache = { entries: {} };
    const saveEmbeddingCache = vi.fn(
      async (_cache: ChatHistoryEmbeddingCache) => undefined,
    );
    const service = createService({
      loadRecords: vi.fn(async () => currentRecords),
      loadEmbeddingCache: vi.fn(async () => cache),
      saveEmbeddingCache,
      subscribeChanges: (listener) => {
        changeListener = listener;
        return () => undefined;
      },
    });

    await service.searchHybrid("France preference");
    currentRecords = [records[0]];
    changeListener();
    await service.searchHybrid("France preference");

    const lastSaved =
      saveEmbeddingCache.mock.calls[saveEmbeddingCache.mock.calls.length - 1]?.[0];
    expect(Object.keys(lastSaved?.entries ?? {})).toEqual(["record-1"]);
    expect(JSON.stringify(lastSaved)).not.toContain(memoryFact);
  });

  it("falls back to keyword results when semantic initialization fails", async () => {
    const errorSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = createService({
      embed: vi.fn(async () => {
        throw new Error("model download failed");
      }),
    });

    await expect(service.searchHybrid("espresso", { limit: 5 })).resolves.toEqual([
      expect.objectContaining({ folderName: "coffee", chatId: "chat-1" }),
    ]);
    errorSpy.mockRestore();
  });
});

function createService(
  overrides: Partial<ConstructorParameters<typeof ChatHistorySearchService>[0]> = {},
) {
  return new ChatHistorySearchService({
    loadRecords: vi.fn(async () => records),
    embed: vi.fn(async (texts: string[]) => texts.map(() => vector(1))),
    loadEmbeddingCache: vi.fn(async () => ({ entries: {} })),
    saveEmbeddingCache: vi.fn(async () => undefined),
    subscribeChanges: () => () => undefined,
    ...overrides,
  });
}
