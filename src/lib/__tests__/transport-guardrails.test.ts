import { describe, expect, it, vi } from "vitest";
import {
  convertReadableStreamToArray,
  MockLanguageModelV3,
  simulateReadableStream,
} from "ai/test";
import type { UIMessage, UIMessageChunk } from "ai";
import type {
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";

const mockEmbeddingConfig: EmbeddingConfig = { api_key: "test-key", base_url: "https://openrouter.ai/api/v1", model: "qwen/qwen3-embedding-4b", dimensions: 1024, query_prefix: "Represent this sentence for searching relevant passages: " };
const mockRerankerConfig: RerankerConfig = { api_key: "test-key", base_url: "https://openrouter.ai/api/v1", model: "cohere/rerank-4-pro" };

vi.mock("@/lib/tauri-bridge", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
  mkdir: vi.fn(),
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
  readDir: vi.fn().mockResolvedValue([]),
  remove: vi.fn(),
  rename: vi.fn(),
  exists: vi.fn().mockResolvedValue(false),
  BaseDirectory: { AppData: "AppData" },
  fetch: vi.fn(),
  loadStore: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    save: vi.fn(),
  }),
}));

import { createGuardedStream } from "@/lib/transport";
import type { SearchToolKeys } from "@/lib/transport/tool-registry";

interface RunGuardedStreamOptions {
  model: Parameters<typeof createGuardedStream>[0]["model"];
  researchFolder: string | null;
  embeddingConfig: EmbeddingConfig;
  rerankerConfig: RerankerConfig;
  messages: UIMessage[];
  abortSignal: AbortSignal | undefined;
  searchKeys?: SearchToolKeys;
}

async function runGuardedStream(options: RunGuardedStreamOptions): Promise<UIMessageChunk[]> {
  const stream = new ReadableStream<UIMessageChunk>({
    async start(controller) {
      try {
        await createGuardedStream({ ...options, controller });
        if (options.abortSignal?.aborted) {
          controller.enqueue({ type: "abort", reason: "aborted" });
        } else {
          controller.enqueue({ type: "finish", finishReason: "stop" });
        }
      } catch (_error) {
        if (options.abortSignal?.aborted) {
          controller.enqueue({ type: "abort", reason: "aborted" });
        } else {
          controller.enqueue({ type: "finish", finishReason: "error" });
        }
      } finally {
        controller.close();
      }
    },
  });
  return convertReadableStreamToArray(stream) as Promise<UIMessageChunk[]>;
}

describe("createGuardedStream", () => {
  it("retries when a provider calls a gated tool before its prerequisite", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (options): Promise<LanguageModelV3StreamResult> => {
        callCount += 1;
        if (callCount === 1) {
          return {
            stream: simulateReadableStream({
              chunks: toolCallChunks("create_research_plan", "call-plan", {
                query: "Research the market",
              }),
            }),
          };
        }

        expect(options.toolChoice).toEqual({
          type: "tool",
          toolName: "ask_questions",
        });
        return {
          stream: simulateReadableStream({
            chunks: toolCallChunks("ask_questions", "call-question", {
              questions: [
                {
                  question: "What market should I research?",
                  candidates: [{ label: "AI search", value: "ai-search" }],
                },
              ],
            }),
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Research the market")],
      abortSignal: undefined,
    });

    expect(callCount).toBe(2);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "data-guardrail_event",
        data: expect.objectContaining({
          kind: "tool_call_requirement",
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
  });

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
            chunks: toolCallChunks("ask_questions", "call-question", {
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
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Pick a color")],
      abortSignal: undefined,
    });

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
    expect(lastChunk(chunks)).toMatchObject({ type: "finish" });
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

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Find the latest pricing for Acme Search")],
      abortSignal: undefined,
    });

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

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Hello")],
      abortSignal: undefined,
    });

    expect(callCount).toBe(1);
    expect(chunks.some((chunk) => chunk.type === "data-guardrail_event")).toBe(
      false,
    );
  });

  it("bounds question_tool retries and emits a warning", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        callCount += 1;
        return {
          stream: simulateReadableStream({
            chunks: textChunks("What is your favorite color? Please let me know."),
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Pick a color")],
      abortSignal: undefined,
    });

    const guardEvents = chunks.filter(
      (chunk) => chunk.type === "data-guardrail_event",
    );

    expect(callCount).toBe(3);
    expect(guardEvents).toHaveLength(3);
    expect(guardEvents[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "question_tool",
          status: "retrying",
          attempt: 1,
        }),
      }),
    );
    expect(guardEvents[1]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "question_tool",
          status: "retrying",
          attempt: 2,
        }),
      }),
    );
    expect(guardEvents[2]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "question_tool",
          status: "warning",
          title: "Guardrail retry limit reached",
        }),
      }),
    );
  });

  it("emits a research-depth reminder and lets the model choose a tool", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (options): Promise<LanguageModelV3StreamResult> => {
        callCount += 1;
        if (callCount === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: "stream-start", warnings: [] },
                {
                  type: "tool-call",
                  toolCallId: "call-brave",
                  toolName: "brave_search",
                  input: JSON.stringify({ query: "Acme Search pricing" }),
                },
                { type: "tool-result" as const, toolCallId: "call-brave", toolName: "brave_search", result: "results" },
                { type: "text-start", id: "text-1" },
                { type: "text-delta", id: "text-1", delta: "Acme Search costs $10/month." },
                { type: "text-end", id: "text-1" },
                finishChunk("stop"),
              ],
            }),
          };
        }

        expect(options.toolChoice).toEqual({ type: "required" });
        return {
          stream: simulateReadableStream({
            chunks: toolCallChunks("research_checkpoint", "call-cp", {
              originalQuestion: "Acme Search pricing",
              searchesRun: ["acme search pricing"],
              sourcesOpened: [
                { url: "https://acme.com/pricing", title: "Pricing" },
                { url: "https://acme.com/plans", title: "Plans" },
              ],
              claimsVerified: ["$10/month"],
              unresolvedQuestions: [],
              confidence: "high",
              readyToAnswer: true,
            }),
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Find the latest pricing for Acme Search")],
      abortSignal: undefined,
    });

    expect(callCount).toBe(2);
    const guardEvents = chunks.filter(
      (chunk) => chunk.type === "data-guardrail_event",
    );
    expect(guardEvents).toHaveLength(1);
    expect(guardEvents[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "research_checkpoint",
          status: "retrying",
          title: "Research depth reminder",
        }),
      }),
    );
    expect(lastChunk(chunks)).toMatchObject({ type: "finish" });
  });

  it("accepts immediately when research checkpoint guidance exists", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        callCount += 1;
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "call-checkpoint",
                toolName: "research_checkpoint",
                input: JSON.stringify({
                  originalQuestion: "Acme Search pricing",
                  searchesRun: ["acme search pricing"],
                  sourcesOpened: [
                    { url: "https://acme.com/pricing", title: "Pricing" },
                    { url: "https://acme.com/plans", title: "Plans" },
                  ],
                  claimsVerified: ["Price is $10/mo", "Free tier available"],
                  unresolvedQuestions: [],
                  confidence: "high",
                  readyToAnswer: true,
                }),
              },
              {
                type: "tool-result" as const,
                toolCallId: "call-checkpoint",
                toolName: "research_checkpoint",
                result:
                  "Research checkpoint guidance: cite the pricing page.",
              },
              finishChunk("tool-calls"),
            ],
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Find the latest pricing for Acme Search")],
      abortSignal: undefined,
    });

    expect(callCount).toBe(1);
    expect(chunks.some((chunk) => chunk.type === "data-guardrail_event")).toBe(
      false,
    );
    expect(lastChunk(chunks)).toMatchObject({
      type: "finish",
    });
  });

  it("emits an abort chunk when the abort signal fires during streaming", async () => {
    const abortController = new AbortController();
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        abortController.abort();
        return {
          stream: simulateReadableStream({
            chunks: textChunks("Some response"),
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Hello")],
      abortSignal: abortController.signal,
    });

    expect(chunks).toContainEqual({ type: "abort", reason: "aborted" });
    expect(chunks).not.toContainEqual(
      expect.objectContaining({ type: "finish", finishReason: "stop" }),
    );
  });

  it("emits an abort chunk without calling the model when signal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();

    let called = false;
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        called = true;
        return {
          stream: simulateReadableStream({
            chunks: textChunks("Should not reach here"),
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Hello")],
      abortSignal: abortController.signal,
    });

    expect(called).toBe(false);
    expect(chunks).toContainEqual({ type: "abort", reason: "aborted" });
  });

  it("surfaces model errors as stream chunks", async () => {
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        throw new Error("Model connection failed");
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Hello")],
      abortSignal: undefined,
    });

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorText: "Model connection failed",
      }),
    );
    expect(lastChunk(chunks)).toMatchObject({ type: "finish" });
  });

  it("converts non-Error throws to error chunks", async () => {
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        throw "something weird";
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Hello")],
      abortSignal: undefined,
    });

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "error",
      }),
    );
    expect(lastChunk(chunks)).toMatchObject({ type: "finish" });
  });

  it("emits a diagnostic when the model finishes without visible reply text", async () => {
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({ chunks: emptyChunks("stop") }),
      }),
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Hello")],
      abortSignal: undefined,
    });

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "data-agent_diagnostic",
        data: expect.objectContaining({
          kind: "empty_response",
          title: "No assistant reply",
          finishReason: "stop",
        }),
      }),
    );
    expect(lastChunk(chunks)).toMatchObject({ type: "finish" });
  });

  it("does not emit an empty-response diagnostic for normal tool-call steps", async () => {
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({
          chunks: toolCallChunks("brave_search", "call-brave", {
            query: "pricing",
          }),
        }),
      }),
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Find pricing")],
      abortSignal: undefined,
    });

    expect(chunks.some((chunk) => chunk.type === "data-agent_diagnostic")).toBe(
      false,
    );
  });

  it("enforces currency conversion for monetary requests", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (options): Promise<LanguageModelV3StreamResult> => {
        callCount += 1;
        if (callCount === 1) {
          return {
            stream: simulateReadableStream({
              chunks: textChunks("The premium plan costs $50 and €40 per month."),
            }),
          };
        }

        expect(options.toolChoice).toEqual({ type: "required" });
        return {
          stream: simulateReadableStream({
            chunks: toolCallChunks("currency_conversion", "call-cc-1", {
              amount: 50,
              from_currency: "USD",
            }),
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("How much does the premium plan cost?")],
      abortSignal: undefined,
      searchKeys: { currency: "GBP" },
    });

    expect(callCount).toBe(2);

    const guardEvents = chunks.filter(
      (chunk) => chunk.type === "data-guardrail_event",
    );
    expect(guardEvents).toHaveLength(1);
    expect(guardEvents[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "currency_conversion",
          status: "retrying",
          attempt: 1,
        }),
      }),
    );

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-input-available",
        toolName: "currency_conversion",
      }),
    );
  });

  it("does not enforce currency conversion for non-currency false positives", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        callCount += 1;
        return {
          stream: simulateReadableStream({
            chunks: textChunks("The laptop uses Apple's M3 chip."),
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Summarize this laptop spec")],
      abortSignal: undefined,
      searchKeys: { currency: "GBP" },
    });

    expect(callCount).toBe(1);
    expect(
      chunks.some((chunk) => chunk.type === "data-guardrail_event"),
    ).toBe(false);
    expect(
      chunks.some(
        (chunk) =>
          chunk.type === "tool-input-available" &&
          chunk.toolName === "currency_conversion",
      ),
    ).toBe(false);
  });

  it("bounds tool_call_requirement retries and emits a warning", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        callCount += 1;
        return {
          stream: simulateReadableStream({
            chunks: toolCallChunks("create_research_plan", "call-plan", {
              query: "Research the market",
            }),
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Research the market")],
      abortSignal: undefined,
    });

    const guardEvents = chunks.filter(
      (chunk) => chunk.type === "data-guardrail_event",
    );

    expect(callCount).toBe(3);
    expect(guardEvents).toHaveLength(3);
    expect(guardEvents[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "tool_call_requirement",
          status: "retrying",
          attempt: 1,
        }),
      }),
    );
    expect(guardEvents[1]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "tool_call_requirement",
          status: "retrying",
          attempt: 2,
        }),
      }),
    );
    expect(guardEvents[2]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "tool_call_requirement",
          status: "warning",
          title: "Guardrail retry limit reached",
        }),
      }),
    );
  });

  it("emits a data-token_usage chunk when usage data is available", async () => {
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({
          chunks: textChunks("Hi there"),
        }),
      }),
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Hello")],
      abortSignal: undefined,
    });

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "data-token_usage",
      }),
    );
  });

  it("emits a diagnostic when the model returns tool calls but finishes with 'stop'", async () => {
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "call-brave",
              toolName: "brave_search",
              input: JSON.stringify({ query: "pricing" }),
            },
            finishChunk("stop"),
          ],
        }),
      }),
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Find pricing")],
      abortSignal: undefined,
    });

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "data-agent_diagnostic",
        data: expect.objectContaining({
          kind: "empty_response",
          title: "No assistant reply",
          finishReason: "stop",
          toolCallCount: 1,
        }),
      }),
    );
    expect(lastChunk(chunks)).toMatchObject({ type: "finish" });
  });

  it("always ends the stream with exactly one finish or abort event", async () => {
    const endings: string[] = [];

    for (const scenario of [
      {
        messages: [userMessage("Hello")],
        chunks: () => textChunks("Hi there"),
      },
      {
        messages: [userMessage("Hello")],
        chunks: () => {
          throw new Error("fail");
        },
      },
    ]) {
      const model = new MockLanguageModelV3({
        doStream: async (): Promise<LanguageModelV3StreamResult> => ({
          stream: simulateReadableStream({ chunks: scenario.chunks() }),
        }),
      });

      const chunks = await runGuardedStream({
        model,
        researchFolder: "test-folder",
        embeddingConfig: mockEmbeddingConfig, rerankerConfig: mockRerankerConfig,
        messages: scenario.messages,
        abortSignal: undefined,
      });

      const terminal = chunks.filter(
        (c) => c.type === "finish" || c.type === "abort",
      );
      endings.push(...terminal.map((c) => c.type));
    }

    expect(endings).toHaveLength(2);
    expect(endings.every((e) => e === "finish")).toBe(true);
  });
});

describe("buildSystemPrompt", () => {
  it("works without memories", async () => {
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({ chunks: textChunks("Done.") }),
      }),
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      embeddingConfig: mockEmbeddingConfig,
      rerankerConfig: mockRerankerConfig,
      messages: [userMessage("Hello")],
      abortSignal: undefined,
    });

    expect(chunks).toContainEqual(
      expect.objectContaining({ type: "finish" }),
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

function emptyChunks(
  finishReason: "stop" | "length" | "content-filter" | "other",
): LanguageModelV3StreamPart[] {
  return [
    { type: "stream-start" as const, warnings: [] },
    finishChunk(finishReason),
  ];
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

function toolCallChunks(
  toolName: string,
  toolCallId: string,
  input: unknown,
): LanguageModelV3StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    {
      type: "tool-call",
      toolCallId,
      toolName,
      input: JSON.stringify(input),
    },
    finishChunk("tool-calls"),
  ];
}

function finishChunk(
  finishReason: "stop" | "tool-calls" | "length" | "content-filter" | "other",
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

function lastChunk(chunks: UIMessageChunk[]) {
  return chunks[chunks.length - 1];
}
