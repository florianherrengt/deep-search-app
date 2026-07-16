import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  createChatHistorySearchRecords,
  createResearchMemorySearchRecords,
  loadChatHistorySearchRecords,
} from "@/lib/chat-history-search-corpus";
import type { ResearchChatSummary } from "@/lib/research-history";

const chat: ResearchChatSummary = {
  id: "chat-1",
  title: "Coffee market research",
  createdAt: "2026-07-10T10:00:00.000Z",
  updatedAt: "2026-07-10T11:00:00.000Z",
  messageCount: 4,
};

describe("createChatHistorySearchRecords", () => {
  it("indexes the chat title and one record per user-authored query", () => {
    const messages: UIMessage[] = [
      {
        id: "user-1",
        role: "user",
        parts: [
          { type: "text", text: "Compare coffee demand" },
          { type: "text", text: "in France" },
        ],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Assistant output must not be indexed" }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Find independent estimates" }],
      },
    ];

    const records = createChatHistorySearchRecords("market-folder", chat, messages);

    expect(records.map((record) => record.query)).toEqual([
      "Coffee market research",
      "Compare coffee demand\nin France",
      "Find independent estimates",
    ]);
    expect(records).toEqual(
      records.map(() =>
        expect.objectContaining({
          folderName: "market-folder",
          chatId: "chat-1",
          title: "Coffee market research",
          updatedAt: "2026-07-10T11:00:00.000Z",
        }),
      ),
    );
  });

  it("includes completed ask-questions answers but ignores pending and skipped outputs", () => {
    const messages: UIMessage[] = [
      assistantQuestionMessage("answered", {
        state: "output-available",
        output: {
          answers: [
            { question: "Region?", answer: "Western Europe" },
            { question: "Budget?", answer: "" },
          ],
        },
      }),
      assistantQuestionMessage("pending", { state: "input-available" }),
      assistantQuestionMessage("skipped", {
        state: "output-available",
        output: { skipped: true, answers: [{ question: "X", answer: "Ignored" }] },
      }),
    ];

    const records = createChatHistorySearchRecords("market-folder", chat, messages);

    expect(records.map((record) => record.query)).toEqual([
      "Coffee market research",
      "Western Europe",
    ]);
  });

  it("keeps a title-only chat searchable", () => {
    expect(
      createChatHistorySearchRecords("market-folder", chat, []),
    ).toEqual([
      expect.objectContaining({
        chatId: "chat-1",
        query: "Coffee market research",
      }),
    ]);
  });
});

describe("createResearchMemorySearchRecords", () => {
  it("creates one independently searchable record per memory fact", async () => {
    expect(
      await createResearchMemorySearchRecords(
        "market-folder",
        "# Memories\n\n- User prefers prices in EUR.\n- User uses macOS.\n",
        "2026-07-10T11:00:00.000Z",
      ),
    ).toEqual([
      expect.objectContaining({
        recordKind: "memory",
        folderName: "market-folder",
        query: "User prefers prices in EUR.",
      }),
      expect.objectContaining({
        recordKind: "memory",
        folderName: "market-folder",
        query: "User uses macOS.",
      }),
    ]);
  });

  it("uses stable opaque IDs when facts are reordered", async () => {
    const first = await createResearchMemorySearchRecords(
      "market-folder",
      "# Memories\n\n- User prefers EUR.\n- User uses macOS.\n",
      null,
    );
    const reordered = await createResearchMemorySearchRecords(
      "market-folder",
      "# Memories\n\n- User uses macOS.\n- User prefers EUR.\n",
      null,
    );

    const firstIdsByFact = new Map(first.map((record) => [record.query, record.id]));
    const reorderedIdsByFact = new Map(
      reordered.map((record) => [record.query, record.id]),
    );
    expect(reorderedIdsByFact).toEqual(firstIdsByFact);
    expect(first.every((record) => !record.id.includes(record.query))).toBe(true);
  });
});

describe("loadChatHistorySearchRecords", () => {
  it("loads per-folder memories alongside chat records from the active storage path", async () => {
    const readAppFile = vi.fn().mockResolvedValue(
      "# Memories\n\n- User prefers France-focused analysis.\n",
    );
    const records = await loadChatHistorySearchRecords({
      listResearchFolders: vi.fn().mockResolvedValue([
        {
          name: "market-folder",
          updatedAt: "2026-07-10T11:00:00.000Z",
        },
      ]),
      listResearchChats: vi.fn().mockResolvedValue([chat]),
      readResearchChatMessages: vi.fn().mockResolvedValue([
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Compare demand" }],
        },
      ]),
      readAppFile,
    });

    expect(records.some((record) => record.recordKind === "chat")).toBe(true);
    expect(records).toContainEqual(
      expect.objectContaining({
        recordKind: "memory",
        folderName: "market-folder",
        query: "User prefers France-focused analysis.",
      }),
    );
    expect(readAppFile).toHaveBeenCalledWith({
      subfolder: "search-results/market-folder",
      filename: "memories.md",
    });
  });

  it.each([
    ["missing", null],
    ["malformed", "# Memories\n\nnot a memory bullet\n"],
  ])("keeps chat indexing when memories are %s", async (_label, content) => {
    const records = await loadChatHistorySearchRecords({
      listResearchFolders: vi.fn().mockResolvedValue([
        { name: "market-folder", updatedAt: null },
      ]),
      listResearchChats: vi.fn().mockResolvedValue([chat]),
      readResearchChatMessages: vi.fn().mockResolvedValue([]),
      readAppFile: vi.fn().mockResolvedValue(content),
    });

    expect(records).toEqual([
      expect.objectContaining({ recordKind: "chat", chatId: "chat-1" }),
    ]);
  });

  it("keeps chat indexing when memories are unreadable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const records = await loadChatHistorySearchRecords({
      listResearchFolders: vi.fn().mockResolvedValue([
        { name: "market-folder", updatedAt: null },
      ]),
      listResearchChats: vi.fn().mockResolvedValue([chat]),
      readResearchChatMessages: vi.fn().mockResolvedValue([]),
      readAppFile: vi.fn().mockRejectedValue(new Error("unreadable")),
    });

    expect(records).toEqual([
      expect.objectContaining({ recordKind: "chat", chatId: "chat-1" }),
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[chat-history-search] failed to read folder memories",
      expect.objectContaining({ folderName: "market-folder" }),
    );
    warn.mockRestore();
  });
});

function assistantQuestionMessage(
  id: string,
  part: Record<string, unknown>,
): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-ask_questions",
        toolCallId: id,
        ...part,
      } as unknown as UIMessage["parts"][number],
    ],
  };
}
