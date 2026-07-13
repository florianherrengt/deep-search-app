import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { createChatHistorySearchRecords } from "@/lib/chat-history-search-corpus";
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
