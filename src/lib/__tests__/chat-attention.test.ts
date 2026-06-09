import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { hasPendingQuestionTool } from "@/lib/chat-attention";

describe("hasPendingQuestionTool", () => {
  it("detects an unanswered ask_questions tool call", () => {
    expect(
      hasPendingQuestionTool([
        assistantMessage([
          {
            type: "tool-ask_questions",
            toolCallId: "question-1",
            state: "input-available",
            input: {
              questions: [
                {
                  question: "Continue previous research?",
                  candidates: [
                    { label: "Continue", value: "continue:market-map" },
                    { label: "Start fresh", value: "new" },
                  ],
                },
              ],
            },
            providerExecuted: false,
          } as UIMessage["parts"][number],
        ]),
      ]),
    ).toBe(true);
  });

  it("ignores answered, errored, and still-streaming question tool calls", () => {
    expect(
      hasPendingQuestionTool([
        assistantMessage([
          {
            type: "tool-ask_questions",
            toolCallId: "answered-question",
            state: "output-available",
            input: { questions: [] },
            output: { answers: [] },
            providerExecuted: false,
          } as UIMessage["parts"][number],
          {
            type: "tool-ask_questions",
            toolCallId: "errored-question",
            state: "output-error",
            input: { questions: [] },
            errorText: "Question failed",
            providerExecuted: false,
          } as UIMessage["parts"][number],
          {
            type: "tool-ask_questions",
            toolCallId: "streaming-question",
            state: "input-streaming",
            input: { questions: [] },
            providerExecuted: false,
          } as UIMessage["parts"][number],
        ]),
      ]),
    ).toBe(false);
  });
});

function assistantMessage(parts: UIMessage["parts"]): UIMessage {
  return {
    id: "assistant",
    role: "assistant",
    parts,
  };
}
