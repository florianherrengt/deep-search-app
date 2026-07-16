import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  getAuthorizedResearchFolderSwitches,
  getResearchChatRecallFolders,
} from "@/lib/research-recall";

describe("research recall provenance", () => {
  it("recognizes research-chat results but not memory-only results", () => {
    expect(getResearchChatRecallFolders([recallMessage("research_chat")])).toEqual(
      new Set(["market-map"]),
    );
    expect(getResearchChatRecallFolders([recallMessage("memory")])).toEqual(
      new Set(),
    );
  });

  it("authorizes only a recalled folder explicitly selected by the user", () => {
    expect(
      getAuthorizedResearchFolderSwitches([
        recallMessage("research_chat"),
        continuationMessage("market-map", "market-map"),
      ]),
    ).toEqual(new Set(["market-map"]));

    expect(
      getAuthorizedResearchFolderSwitches([recallMessage("research_chat")]),
    ).toEqual(new Set());
  });

  it("rejects memory-only, unoffered, unanswered, and interrupted continuations", () => {
    expect(
      getAuthorizedResearchFolderSwitches([
        recallMessage("memory"),
        continuationMessage("market-map", "market-map"),
      ]),
    ).toEqual(new Set());
    expect(
      getAuthorizedResearchFolderSwitches([
        recallMessage("research_chat"),
        continuationMessage("other-folder", "market-map"),
      ]),
    ).toEqual(new Set());
    expect(
      getAuthorizedResearchFolderSwitches([
        recallMessage("research_chat"),
        continuationMessage("market-map", null),
      ]),
    ).toEqual(new Set());
    expect(
      getAuthorizedResearchFolderSwitches([
        recallMessage("research_chat"),
        continuationMessage("market-map", "market-map", "output-error"),
      ]),
    ).toEqual(new Set());
  });

  it("does not carry an old continuation authorization into a later user turn", () => {
    expect(
      getAuthorizedResearchFolderSwitches([
        { id: "user-old", role: "user", parts: [{ type: "text", text: "Old request" }] },
        recallMessage("research_chat"),
        continuationMessage("market-map", "market-map"),
        { id: "user-new", role: "user", parts: [{ type: "text", text: "New request" }] },
      ]),
    ).toEqual(new Set());
  });
});

function recallMessage(resultType: "research_chat" | "memory"): UIMessage {
  return {
    id: `recall-${resultType}`,
    role: "assistant",
    parts: [
      {
        type: "tool-search_research",
        toolCallId: `search-${resultType}`,
        state: "output-available",
        input: { query: "market" },
        output:
          resultType === "research_chat"
            ? [
                {
                  result_type: "research_chat",
                  folder_name: "market-map",
                  chat_id: "market-chat",
                  title: "Market map",
                  matched_query: "market",
                  updated_at: null,
                  score: 0.9,
                  relevant_memories: [],
                },
              ]
            : [
                {
                  result_type: "memory",
                  source_folder: "market-map",
                  memory: "Focus on France.",
                  updated_at: null,
                  score: 0.9,
                },
              ],
      } as UIMessage["parts"][number],
    ],
  };
}

function continuationMessage(
  offeredFolder: string,
  answeredFolder: string | null,
  state: "output-available" | "output-error" = "output-available",
): UIMessage {
  return {
    id: `continuation-${offeredFolder}-${answeredFolder ?? "unanswered"}`,
    role: "assistant",
    parts: [
      {
        type: "tool-ask_questions",
        toolCallId: "continuation-question",
        state,
        input: {
          questions: [
            {
              question: "Continue previous research?",
              candidates: [
                { label: "Continue", value: `continue:${offeredFolder}` },
                { label: "Start fresh", value: "new" },
              ],
            },
          ],
        },
        ...(state === "output-available" && answeredFolder
          ? {
              output: {
                answers: [
                  {
                    question: "Continue previous research?",
                    answer: `continue:${answeredFolder}`,
                  },
                ],
              },
            }
          : state === "output-error"
            ? { errorText: "interrupted" }
            : {}),
      } as UIMessage["parts"][number],
    ],
  };
}
