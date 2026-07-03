import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  answerPendingDeepSearchQuestions,
  getDeepSearchResultText,
  getPendingDeepSearchQuestions,
} from "@/lib/mcp/deep-search-protocol";
import { SUB_AGENT_TEXT_PROVIDER_METADATA } from "@/lib/sub-agent-stream";

describe("deep search MCP protocol helpers", () => {
  it("extracts pending questions with option values", () => {
    expect(getPendingDeepSearchQuestions([pendingQuestionMessage()])).toEqual([
      {
        text: "Do you want a migration plan or a risk assessment?",
        options: ["migration plan", "risk assessment"],
      },
    ]);
  });

  it("answers pending questions by order", () => {
    const [message] = answerPendingDeepSearchQuestions(
      [pendingQuestionMessage()],
      ["migration plan"],
    );

    expect(message.parts[0]).toMatchObject({
      type: "tool-ask_questions",
      state: "output-available",
      output: {
        answers: [
          {
            question: "Do you want a migration plan or a risk assessment?",
            answer: "migration plan",
          },
        ],
      },
    });
  });

  it("throws when there is no pending question", () => {
    expect(() =>
      answerPendingDeepSearchQuestions([assistantTextMessage("Done.")], [
        "answer",
      ]),
    ).toThrow("No pending questions");
  });

  it("extracts final assistant text without sub-agent progress text", () => {
    expect(
      getDeepSearchResultText([
        assistantTextMessage("Draft"),
        {
          id: "assistant-final",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "Sub-agent progress",
              providerMetadata: SUB_AGENT_TEXT_PROVIDER_METADATA,
            },
            { type: "text", text: "Final answer" },
          ],
        },
      ]),
    ).toBe("Final answer");
  });
});

function pendingQuestionMessage(): UIMessage {
  return {
    id: "assistant-question",
    role: "assistant",
    parts: [
      {
        type: "tool-ask_questions",
        toolCallId: "question-1",
        state: "input-available",
        input: {
          questions: [
            {
              question: "Do you want a migration plan or a risk assessment?",
              candidates: [
                { label: "Migration plan", value: "migration plan" },
                { label: "Risk assessment", value: "risk assessment" },
              ],
            },
          ],
        },
      } as UIMessage["parts"][number],
    ],
  };
}

function assistantTextMessage(text: string): UIMessage {
  return {
    id: `assistant-${text}`,
    role: "assistant",
    parts: [{ type: "text", text }],
  };
}
