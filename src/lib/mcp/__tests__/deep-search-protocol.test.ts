import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  answerPendingDeepSearchQuestions,
  deepSearchRequestSchema,
  getDeepSearchResultText,
  getPendingDeepSearchQuestions,
  normalizeDeepSearchAssistantMessage,
} from "@/lib/mcp/deep-search-protocol";
import { SUB_AGENT_TEXT_PROVIDER_METADATA } from "@/lib/sub-agent-stream";

describe("deep search MCP protocol helpers", () => {
  it("accepts follow-up questions on an existing session", () => {
    expect(
      deepSearchRequestSchema.parse({
        session_id: "abc",
        question: "Compare with Vue.",
      }),
    ).toEqual({
      session_id: "abc",
      question: "Compare with Vue.",
    });
  });

  it("rejects mixed follow-up questions and question answers", () => {
    expect(
      deepSearchRequestSchema.safeParse({
        session_id: "abc",
        question: "Compare with Vue.",
        answers: ["migration plan"],
      }).success,
    ).toBe(false);
  });

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

  it("extracts only the latest assistant step after guardrail retries", () => {
    expect(
      getDeepSearchResultText([
        {
          id: "assistant-guarded",
          role: "assistant",
          parts: [
            { type: "step-start" },
            { type: "text", text: "First attempt." },
            guardrailEventPart(),
            { type: "step-start" },
            { type: "text", text: "Final retry answer." },
          ],
        },
      ]),
    ).toBe("Final retry answer.");
  });

  it("normalizes guarded retry assistant messages to the final step", () => {
    expect(
      normalizeDeepSearchAssistantMessage({
        id: "assistant-guarded",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "text", text: "First attempt." },
          guardrailEventPart(),
          { type: "step-start" },
          { type: "text", text: "Final retry answer." },
        ],
      }).parts,
    ).toEqual([
      { type: "step-start" },
      { type: "text", text: "Final retry answer." },
    ]);
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

function guardrailEventPart(): UIMessage["parts"][number] {
  return {
    type: "data-guardrail_event",
    id: "guardrail-1",
    data: {
      kind: "research_checkpoint",
      status: "retrying",
      title: "Research depth reminder",
      message: "Prompted the agent to consider whether more research is needed.",
      reason: "The answer did not show enough research tool use.",
      attempt: 1,
    },
  } as UIMessage["parts"][number];
}
