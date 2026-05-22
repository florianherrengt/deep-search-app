import { describe, expect, it } from "vitest";
import {
  convertReadableStreamToArray,
  MockLanguageModelV3,
  simulateReadableStream,
} from "ai/test";
import type { UIMessage } from "ai";
import type {
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { createGuardedStream } from "@/lib/transport";

describe("createGuardedStream", () => {
  it("emits a visible guardrail event and retries plain-text questions with ask_questions forced", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (options): Promise<LanguageModelV3StreamResult> => {
        callCount += 1;
        if (callCount === 1) {
          return {
            stream: simulateReadableStream({
              chunks: textChunks("Which color do you prefer?"),
            }),
          };
        }

        expect(options.toolChoice).toEqual({
          type: "tool",
          toolName: "ask_questions",
        });
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "call-question",
                toolName: "ask_questions",
                input: JSON.stringify({
                  questions: [
                    {
                      question: "Which color do you prefer?",
                      candidates: [
                        { label: "Red", value: "red" },
                        { label: "Blue", value: "blue" },
                      ],
                    },
                  ],
                }),
              },
              finishChunk("tool-calls"),
            ],
          }),
        };
      },
    });

    const chunks = await convertReadableStreamToArray(
      createGuardedStream({
        model,
        researchFolder: "test-folder",
        apiKey: "test-key",
        messages: [userMessage("Pick a color")],
        abortSignal: undefined,
      }),
    );

    expect(callCount).toBe(2);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "data-guardrail_event",
        data: expect.objectContaining({
          kind: "question_tool",
          status: "retrying",
          attempt: 1,
        }),
      }),
    );
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-input-available",
        toolName: "ask_questions",
      }),
    );
    expect(chunks[chunks.length - 1]).toMatchObject({ type: "finish" });
  });

  it("bounds repeated research retries and emits a warning instead of looping forever", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        callCount += 1;
        return {
          stream: simulateReadableStream({
            chunks: textChunks("The current Acme Search price is about 10 pounds."),
          }),
        };
      },
    });

    const chunks = await convertReadableStreamToArray(
      createGuardedStream({
        model,
        researchFolder: "test-folder",
        apiKey: "test-key",
        messages: [userMessage("Find the latest pricing for Acme Search")],
        abortSignal: undefined,
      }),
    );

    const guardEvents = chunks.filter(
      (chunk) => chunk.type === "data-guardrail_event",
    );

    expect(callCount).toBe(3);
    expect(guardEvents).toHaveLength(3);
    expect(guardEvents.slice(0, 2)).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "research_checkpoint",
          status: "retrying",
          attempt: 1,
        }),
      }),
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "research_checkpoint",
          status: "retrying",
          attempt: 2,
        }),
      }),
    ]);
    expect(guardEvents[2]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "research_checkpoint",
          status: "warning",
          title: "Guardrail retry limit reached",
        }),
      }),
    );
  });

  it("does not retry non-research informational replies", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        callCount += 1;
        return {
          stream: simulateReadableStream({
            chunks: textChunks("Hi. I can help with that."),
          }),
        };
      },
    });

    const chunks = await convertReadableStreamToArray(
      createGuardedStream({
        model,
        researchFolder: "test-folder",
        apiKey: "test-key",
        messages: [userMessage("Hello")],
        abortSignal: undefined,
      }),
    );

    expect(callCount).toBe(1);
    expect(chunks.some((chunk) => chunk.type === "data-guardrail_event")).toBe(
      false,
    );
  });
});

function userMessage(text: string): UIMessage {
  return {
    id: `user-${text}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function textChunks(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: "stream-start" as const, warnings: [] },
    { type: "text-start" as const, id: "text-1" },
    { type: "text-delta" as const, id: "text-1", delta: text },
    { type: "text-end" as const, id: "text-1" },
    finishChunk("stop"),
  ];
}

function finishChunk(
  finishReason: "stop" | "tool-calls",
): LanguageModelV3StreamPart {
  return {
    type: "finish" as const,
    finishReason: { unified: finishReason, raw: finishReason },
    usage: {
      inputTokens: {
        total: 1,
        noCache: 1,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: {
        total: 1,
        text: 1,
        reasoning: 0,
      },
    },
  };
}
