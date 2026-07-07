import { describe, expect, it, vi } from "vitest";
import {
  convertReadableStreamToArray,
  MockLanguageModelV3,
  simulateReadableStream,
} from "ai/test";
import type { UIMessage, UIMessageChunk } from "ai";
import type {
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";

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
    entries: vi.fn().mockResolvedValue([]),
    clear: vi.fn(),
  }),
}));

import { createGuardedStream } from "@/lib/transport";
import {
  buildCurrentRequestSourceGuidance,
  buildSystemPrompt,
} from "@/lib/transport/guarded-stream";
import type { SearchToolKeys } from "@/lib/transport/tool-registry";

interface RunGuardedStreamOptions {
  model: Parameters<typeof createGuardedStream>[0]["model"];
  researchFolder: string | null;
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
  it("drops interrupted tool-call history before sending the next model request", async () => {
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({ chunks: textChunks("Recovered.") }),
      }),
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      messages: [
        userMessage("Find pricing"),
        interruptedAssistantToolMessage("brave_search"),
        userMessage("Try again with another model"),
      ],
      abortSignal: undefined,
      searchKeys: { braveApiKey: "test-key" },
    });

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "data-agent_diagnostic",
        data: expect.objectContaining({
          kind: "interrupted_tool_repair",
          toolCallCount: 1,
        }),
      }),
    );
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "text-delta",
        delta: "Recovered.",
      }),
    );
    expect(lastChunk(chunks)).toEqual(
      expect.objectContaining({ type: "finish", finishReason: "stop" }),
    );
  });

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

  it("keeps extract_page_content active after aggregate_search was called", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        callCount += 1;
        return {
          stream: simulateReadableStream({
            chunks: toolCallChunks("extract_page_content", "call-extract", {
              url: "https://example.com/pricing",
            }),
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
      messages: [
        userMessage("Find pricing"),
        assistantToolMessage("aggregate_search"),
      ],
      abortSignal: undefined,
      searchKeys: { braveApiKey: "test-key" },
    });

    expect(callCount).toBe(1);
    expect(
      chunks.some(
        (chunk) => {
          if (chunk.type !== "data-guardrail_event") return false;
          const data = chunk.data as { kind?: unknown };
          return data.kind === "tool_call_requirement";
        },
      ),
    ).toBe(false);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-input-available",
        toolName: "extract_page_content",
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

  it("frames research checkpoint retries as internal while preserving the user request", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
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
                {
                  type: "tool-result" as const,
                  toolCallId: "call-brave",
                  toolName: "brave_search",
                  result: "results",
                },
                { type: "text-start", id: "text-1" },
                {
                  type: "text-delta",
                  id: "text-1",
                  delta: "Acme Search costs $10/month.",
                },
                { type: "text-end", id: "text-1" },
                finishChunk("stop"),
              ],
            }),
          };
        }

        return {
          stream: simulateReadableStream({
            chunks: toolCallChunks("research_checkpoint", "call-cp", {
              originalQuestion: "Find the latest pricing for Acme Search",
              searchesRun: ["acme search pricing"],
              sourcesOpened: [
                { url: "https://acme.com/pricing", title: "Pricing" },
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
      messages: [userMessage("Find the latest pricing for Acme Search")],
      abortSignal: undefined,
      searchKeys: { braveApiKey: "test-key" },
    });

    expect(callCount).toBe(2);
    expect(model.doStreamCalls[1].toolChoice).toEqual({
      type: "tool",
      toolName: "research_checkpoint",
    });
    const retryPromptText = promptToText(model.doStreamCalls[1].prompt);
    expect(retryPromptText).toContain("Internal guardrail retry");
    expect(retryPromptText).toContain("not a new user request");
    expect(retryPromptText).toContain(
      "Find the latest pricing for Acme Search",
    );
    expect(retryPromptText).toContain(
      "set originalQuestion to the latest real user request",
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

      messages: [userMessage("Hello")],
      abortSignal: abortController.signal,
    });

    expect(called).toBe(false);
    expect(chunks).toContainEqual({ type: "abort", reason: "aborted" });
  });

  it("swallows non-AbortError when abort signal is active", async () => {
    const abortController = new AbortController();
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        abortController.abort();
        throw new TypeError("Connection torn down");
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",

      messages: [userMessage("Hello")],
      abortSignal: abortController.signal,
    });

    expect(chunks).toContainEqual({ type: "abort", reason: "aborted" });
    expect(chunks).not.toContainEqual(
      expect.objectContaining({ type: "finish", finishReason: "error" }),
    );
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

        expect(options.toolChoice).toEqual({ type: "auto" });
        return {
          stream: simulateReadableStream({
              chunks: toolCallChunks("currency_conversion", "call-cc-1", {
                conversions: [{
                  amount: 50,
                  from_currency: "USD",
                }],
              }),
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",

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

  it("does not enforce currency conversion when no target currency is configured", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        callCount += 1;
        return {
          stream: simulateReadableStream({
            chunks: textChunks("The note mentions a $50 fee."),
          }),
        };
      },
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",

      messages: [userMessage("Summarize this note")],
      abortSignal: undefined,
      searchKeys: {},
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
  it("adds source coverage guidance for Reddit and YouTube", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain("Internal guardrail retry");
    expect(prompt).toContain("app-generated repair instructions");
    expect(prompt).toContain("site:reddit.com");
    expect(prompt).toContain("site:youtube.com/watch");
    expect(prompt).toContain("youtube_search");
    expect(prompt).toContain("aggregate_search is a general web-search fanout");
  });

  it("adds current-request guidance for explicit Reddit and configured YouTube asks", () => {
    const guidance = buildCurrentRequestSourceGuidance(
      [userMessage("Search Reddit and YouTube for hands-on reviews")],
      { youtubeApiKey: "youtube-key" },
    );

    expect(guidance).toContain("Current request source requirements");
    expect(guidance).toContain("site:reddit.com");
    expect(guidance).toContain("Call youtube_search");
    expect(guidance).toContain("extract_page_content");
  });

  it("falls back to YouTube site search when youtube_search is unavailable", () => {
    const guidance = buildCurrentRequestSourceGuidance([
      userMessage("Find YouTube walkthroughs for this setup"),
    ]);

    expect(guidance).toContain("youtube_search is not configured");
    expect(guidance).toContain("site:youtube.com/watch");
  });

  it("works without memories", async () => {
    const model = new MockLanguageModelV3({
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({ chunks: textChunks("Done.") }),
      }),
    });

    const chunks = await runGuardedStream({
      model,
      researchFolder: "test-folder",
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

function assistantToolMessage(toolName: string): UIMessage {
  return {
    id: `assistant-${toolName}`,
    role: "assistant",
    parts: [
      {
        type: `tool-${toolName}`,
        toolCallId: `call-${toolName}`,
        state: "output-available",
        input: {},
        output: "ok",
      } as UIMessage["parts"][number],
    ],
  };
}

function interruptedAssistantToolMessage(toolName: string): UIMessage {
  return {
    id: `assistant-interrupted-${toolName}`,
    role: "assistant",
    parts: [
      {
        type: `tool-${toolName}`,
        toolCallId: `call-${toolName}`,
        state: "input-available",
        input: { query: "pricing" },
        providerExecuted: false,
      } as UIMessage["parts"][number],
    ],
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

function promptToText(prompt: LanguageModelV3Prompt): string {
  return prompt
    .flatMap((message) => {
      if (typeof message.content === "string") {
        return [message.content];
      }
      return message.content.flatMap((part) =>
        part.type === "text" ? [part.text] : [],
      );
    })
    .join("\n");
}
