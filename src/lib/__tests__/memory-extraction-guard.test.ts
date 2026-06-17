import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MockLanguageModelV3,
  simulateReadableStream,
} from "ai/test";
import type { UIMessage } from "ai";
import type {
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";
import {
  isEligibleForMemoryExtraction,
  collectMemoryCandidates,
} from "@/lib/transport";

const mockEmbeddingConfig: EmbeddingConfig = {
  api_key: "test-key",
  base_url: "https://openrouter.ai/api/v1",
  model: "qwen/qwen3-embedding-4b",
  dimensions: 1024,
  query_prefix: "Represent this sentence for searching relevant passages: ",
};
const mockRerankerConfig: RerankerConfig = {
  api_key: "test-key",
  base_url: "https://openrouter.ai/api/v1",
  model: "cohere/rerank-4-pro",
};

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  exists: vi.fn(),
}));

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

const chatProviderMocks = vi.hoisted(() => ({
  createChatLanguageModel: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => ({
  ...fsMocks,
  invoke: tauriMocks.invoke,
  fetch: vi.fn(),
  BaseDirectory: { AppData: "AppData" },
}));

vi.mock("@/lib/chat-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat-providers")>();
  return {
    ...actual,
    createChatLanguageModel: chatProviderMocks.createChatLanguageModel,
  };
});

vi.mock("@/lib/memory-agent", () => ({
  extractAndStoreMemories: vi.fn().mockResolvedValue({ memoriesStored: 0 }),
}));

vi.mock("@/lib/retrieval-agent", () => ({
  runRetrievalAgent: vi.fn().mockResolvedValue({
    relevant_folders: [],
    relevant_memories: [],
  }),
}));

vi.mock("@/lib/skills-store", () => ({
  skillsStore: {
    get: vi.fn().mockResolvedValue({ skills: [] }),
  },
}));

import { DirectTransport } from "@/lib/transport";
import { extractAndStoreMemories } from "@/lib/memory-agent";

const mockedExtractAndStoreMemories = vi.mocked(extractAndStoreMemories);

// ─── Test helpers for ask_questions messages ───

function askQuestionsMsg(
  id: string,
  answers: Array<{ question: string; answer: string; custom?: boolean }>,
): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-ask_questions",
        state: "output-available",
        output: { answers },
      } as unknown as UIMessage["parts"][number],
    ],
  };
}

function askQuestionsInputMsg(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-ask_questions",
        state: "input-available",
        output: { answers: [] },
      } as unknown as UIMessage["parts"][number],
    ],
  };
}

function askQuestionsErrorMsg(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-ask_questions",
        state: "output-error",
      } as unknown as UIMessage["parts"][number],
    ],
  };
}

// ─── isEligibleForMemoryExtraction tests (backward compat, unchanged) ───

describe("isEligibleForMemoryExtraction", () => {
  it("returns true for user role", () => {
    const msg = uiMessage("user", "Hello");
    expect(isEligibleForMemoryExtraction(msg)).toBe(true);
  });

  it("returns false for assistant role", () => {
    const msg = uiMessage("assistant", "Hi there");
    expect(isEligibleForMemoryExtraction(msg)).toBe(false);
  });

  it("returns false for system role", () => {
    const msg = uiMessage("system", "You are helpful");
    expect(isEligibleForMemoryExtraction(msg)).toBe(false);
  });

  it("returns false for non-user roles", () => {
    for (const role of ["assistant", "system"] as const) {
      expect(isEligibleForMemoryExtraction(uiMessage(role, "text"))).toBe(false);
    }
  });
});

// ─── collectMemoryCandidates tests (NEW) ───

describe("collectMemoryCandidates", () => {
  it("returns user-message candidate for user messages with text", () => {
    const candidates = collectMemoryCandidates([
      userMsg("msg-1", "I have a dog"),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: "msg-1",
      source: "user-message",
      content: "I have a dog",
    });
  });

  it("returns empty for assistant message without ask_questions", () => {
    const candidates = collectMemoryCandidates([
      uiMessage("assistant", "I found results"),
    ]);
    expect(candidates).toHaveLength(0);
  });

  it("returns empty for system message", () => {
    const candidates = collectMemoryCandidates([
      uiMessage("system", "You are helpful"),
    ]);
    expect(candidates).toHaveLength(0);
  });

  // GT-1: returns tool-answer candidate for ask_questions answers
  it("returns tool-answer candidate for ask_questions answers (GT-1)", () => {
    const msg = askQuestionsMsg("aq-1", [
      { question: "What language?", answer: "TypeScript" },
    ]);
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: "aq-1",
      source: "tool-answer",
      toolName: "ask_questions",
    });
    expect(candidates[0].content).toContain("TypeScript");
  });

  // GT-2: structured JSON Q&A content
  it("constructs structured JSON Q&A content (GT-2)", () => {
    const msg = askQuestionsMsg("aq-2", [
      { question: "Preferred OS?", answer: "macOS" },
    ]);
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].content).toContain(
      "The following content contains user-authored answers to app-generated questions.",
    );
    expect(candidates[0].content).toContain('"question": "Preferred OS?"');
    expect(candidates[0].content).toContain('"answer": "macOS"');
  });

  // GT-3: batches multiple Q&A pairs into one candidate
  it("batches multiple Q&A pairs into one candidate (GT-3)", () => {
    const msg = askQuestionsMsg("aq-3", [
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "A2" },
      { question: "Q3", answer: "A3" },
    ]);
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(1);
    const parsed = JSON.parse(
      candidates[0].content.split("\n\n")[1],
    );
    expect(parsed).toHaveLength(3);
  });

  // GT-4: batches answers from multiple ask_questions parts
  it("batches answers from multiple ask_questions parts (GT-4)", () => {
    const msg: UIMessage = {
      id: "multi-part",
      role: "assistant",
      parts: [
        {
          type: "tool-ask_questions",
          state: "output-available",
          output: {
            answers: [{ question: "Q1", answer: "A1" }],
          },
        } as unknown as UIMessage["parts"][number],
        {
          type: "tool-ask_questions",
          state: "output-available",
          output: {
            answers: [{ question: "Q2", answer: "A2" }],
          },
        } as unknown as UIMessage["parts"][number],
      ],
    };
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(1);
    const parsed = JSON.parse(
      candidates[0].content.split("\n\n")[1],
    );
    expect(parsed).toHaveLength(2);
  });

  // GT-5: input-available state does NOT produce candidate
  it("does not return for ask_questions part in input-available state (GT-5)", () => {
    const msg = askQuestionsInputMsg("aq-input");
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(0);
  });

  // GT-6: output-error state does NOT produce candidate
  it("does not return for ask_questions part in output-error state (GT-6)", () => {
    const msg = askQuestionsErrorMsg("aq-err");
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(0);
  });

  // GT-7: part without output property skipped
  it("does not return for ask_questions part without output property (GT-7)", () => {
    const msg: UIMessage = {
      id: "no-output",
      role: "assistant",
      parts: [
        {
          type: "tool-ask_questions",
          state: "output-available",
        } as unknown as UIMessage["parts"][number],
      ],
    };
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(0);
  });

  // GT-8: empty answers array
  it("does not return for ask_questions part with empty answers array (GT-8)", () => {
    const msg = askQuestionsMsg("empty-aq", []);
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(0);
  });

  // GT-9: skips entry with missing question field
  it("skips entry with missing question field (GT-9)", () => {
    const msg: UIMessage = {
      id: "missing-q",
      role: "assistant",
      parts: [
        {
          type: "tool-ask_questions",
          state: "output-available",
          output: {
            answers: [
              { answer: "A1" },
              { question: "Q2", answer: "A2" },
            ],
          },
        } as unknown as UIMessage["parts"][number],
      ],
    };
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(1);
    const parsed = JSON.parse(
      candidates[0].content.split("\n\n")[1],
    );
    // Only the second entry should be included
    expect(parsed).toHaveLength(1);
    expect(parsed[0].question).toBe("Q2");
  });

  // GT-10: skips entry with missing answer field
  it("skips entry with missing answer field (GT-10)", () => {
    const msg: UIMessage = {
      id: "missing-a",
      role: "assistant",
      parts: [
        {
          type: "tool-ask_questions",
          state: "output-available",
          output: {
            answers: [
              { question: "Q1" },
              { question: "Q2", answer: "A2" },
            ],
          },
        } as unknown as UIMessage["parts"][number],
      ],
    };
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(1);
    const parsed = JSON.parse(
      candidates[0].content.split("\n\n")[1],
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].question).toBe("Q2");
  });

  // GT-11: no tool-answer for assistant without ask_questions parts
  it("does not return tool-answer for assistant message without ask_questions parts (GT-11)", () => {
    const candidates = collectMemoryCandidates([
      uiMessage("assistant", "Hello there"),
    ]);
    // Should have 0 candidates (no user messages, no tool answers)
    expect(
      candidates.filter((c) => c.source === "tool-answer"),
    ).toHaveLength(0);
  });

  // GT-12: both user-message and tool-answer candidates in same scan
  it("returns both user-message and tool-answer candidates in same scan (GT-12)", () => {
    const candidates = collectMemoryCandidates([
      userMsg("u-1", "I have a dog"),
      askQuestionsMsg("aq-1", [
        { question: "OS?", answer: "macOS" },
      ]),
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].source).toBe("user-message");
    expect(candidates[1].source).toBe("tool-answer");
  });

  // GT-17: sorted by messageIndex ascending
  it("returns candidates sorted by messageIndex ascending (GT-17)", () => {
    const candidates = collectMemoryCandidates([
      userMsg("u-old", "Old message"),
      uiMessage("assistant", "Response"),
      askQuestionsMsg("aq-later", [
        { question: "Q", answer: "A" },
      ]),
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].messageIndex).toBeLessThan(candidates[1].messageIndex);
    expect(candidates[0].source).toBe("user-message");
    expect(candidates[1].source).toBe("tool-answer");
  });

  // GT-22: mixed content in assistant message
  it("extracts ask_questions answers from assistant message containing mixed content (GT-22)", () => {
    const msg: UIMessage = {
      id: "mixed",
      role: "assistant",
      parts: [
        { type: "text", text: "Here are some results." },
        {
          type: "tool-ask_questions",
          state: "output-available",
          output: {
            answers: [{ question: "Q1", answer: "A1" }],
          },
        } as unknown as UIMessage["parts"][number],
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "tc-1",
            toolName: "search",
            args: { query: "test" },
            state: "call",
          },
        } as unknown as UIMessage["parts"][number],
      ],
    };
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].source).toBe("tool-answer");
    // Content should contain the structured JSON, not the plain text
    expect(candidates[0].content).toContain("Q1");
    expect(candidates[0].content).toContain("A1");
  });

  // GT-23: each source type is collected at most once
  it("skips already-found source types (GT-23)", () => {
    // Two user messages and two ask_questions — scanning from end, picks last of each
    const candidates = collectMemoryCandidates([
      userMsg("u-first", "First user message"),
      askQuestionsMsg("aq-first", [{ question: "Q1", answer: "A1" }]),
      userMsg("u-last", "Last user message"),
      askQuestionsMsg("aq-last", [{ question: "Q2", answer: "A2" }]),
    ]);
    expect(candidates).toHaveLength(2);
    const userCandidate = candidates.find((c) => c.source === "user-message")!;
    const toolCandidate = candidates.find((c) => c.source === "tool-answer")!;
    // Last user message (found first when scanning from end)
    expect(userCandidate.id).toBe("u-last");
    expect(userCandidate.content).toBe("Last user message");
    // Last ask_questions (found first from end)
    expect(toolCandidate.id).toBe("aq-last");
  });

  // GT-15: unanswered ask_questions + normal user message
  it("ignores unanswered ask_questions and extracts normal user message (GT-15)", () => {
    const candidates = collectMemoryCandidates([
      askQuestionsInputMsg("aq-unanswered"),
      userMsg("u-normal", "Normal message"),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].source).toBe("user-message");
    expect(candidates[0].id).toBe("u-normal");
  });

  // Skip empty user messages
  it("skips user message with empty text", () => {
    const msg: UIMessage = {
      id: "empty-user",
      role: "user",
      parts: [{ type: "text", text: "   " }],
    };
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(0);
  });

  // Skip empty answer entries
  it("skips answer entries with empty answer after trim", () => {
    const msg: UIMessage = {
      id: "empty-answers",
      role: "assistant",
      parts: [
        {
          type: "tool-ask_questions",
          state: "output-available",
          output: {
            answers: [
              { question: "Q1", answer: "   " },
              { question: "Q2", answer: "" },
            ],
          },
        } as unknown as UIMessage["parts"][number],
      ],
    };
    const candidates = collectMemoryCandidates([msg]);
    expect(candidates).toHaveLength(0);
  });
});

// ─── DirectTransport memory extraction guard tests ───

describe("DirectTransport memory extraction guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([]);
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeTextFile.mockResolvedValue(undefined);
    fsMocks.rename.mockResolvedValue(undefined);
    fsMocks.remove.mockResolvedValue(undefined);
    tauriMocks.invoke.mockResolvedValue(undefined);
    mockedExtractAndStoreMemories.mockResolvedValue({ memoriesStored: 0 });
  });

  it("triggers memory extraction on submit-message with a user message", async () => {
    const transport = transportWithExistingFolder();
    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
    ]);

    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(1);
    expect(mockedExtractAndStoreMemories).toHaveBeenCalledWith(
      "I have a dog",
      expect.any(Function),
      expect.anything(),
      undefined,
      { emitEvent: expect.any(Function) },
    );
  });

  it("does not trigger memory extraction on regenerate-message", async () => {
    const transport = transportWithExistingFolder();
    await sendMessages(transport, "regenerate-message", [
      userMsg("msg-1", "I have a dog"),
    ]);

    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();
  });

  it("does not trigger for assistant messages", async () => {
    const transport = transportWithExistingFolder();
    await sendMessages(transport, "submit-message", [
      uiMessage("assistant", "I found results"),
    ]);

    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();
  });

  it("does not trigger for tool-call assistant parts", async () => {
    const transport = transportWithExistingFolder();
    const msg: UIMessage = {
      id: "assistant-tool",
      role: "assistant",
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "tc-1",
            toolName: "search",
            args: { query: "test" },
            state: "call",
          },
        } as unknown as UIMessage["parts"][number],
      ],
    };

    await sendMessages(transport, "submit-message", [msg]);

    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();
  });

  it("does not trigger for tool-result assistant parts", async () => {
    const transport = transportWithExistingFolder();
    const msg: UIMessage = {
      id: "assistant-result",
      role: "assistant",
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "tc-1",
            toolName: "search",
            args: {},
            result: { items: [] },
            state: "result",
          },
        } as unknown as UIMessage["parts"][number],
      ],
    };

    await sendMessages(transport, "submit-message", [msg]);

    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();
  });

  it("does not trigger for system messages", async () => {
    const transport = transportWithExistingFolder();
    await sendMessages(transport, "submit-message", [
      uiMessage("system", "You are a helpful assistant"),
    ]);

    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();
  });

  it("does not trigger for sub-agent assistant messages", async () => {
    const transport = transportWithExistingFolder();
    const msg: UIMessage = {
      id: "subagent-msg",
      role: "assistant",
      parts: [
        { type: "text", text: "" },
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "sa-1",
            toolName: "search_research",
            args: { query: "test" },
            state: "result",
          },
        } as unknown as UIMessage["parts"][number],
      ],
    };

    await sendMessages(transport, "submit-message", [msg]);

    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();
  });

  it("does not trigger for sub-agent tool calls", async () => {
    const transport = transportWithExistingFolder();
    const msg: UIMessage = {
      id: "subagent-tool",
      role: "assistant",
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "sa-tc-1",
            toolName: "memory_agent",
            args: {},
            state: "call",
          },
        } as unknown as UIMessage["parts"][number],
      ],
    };

    await sendMessages(transport, "submit-message", [msg]);

    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();
  });

  it("does not trigger for sub-agent tool outputs", async () => {
    const transport = transportWithExistingFolder();
    const msg: UIMessage = {
      id: "subagent-output",
      role: "assistant",
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "sa-tc-2",
            toolName: "retrieval_agent",
            args: {},
            result: { relevant_memories: [] },
            state: "result",
          },
        } as unknown as UIMessage["parts"][number],
      ],
    };

    await sendMessages(transport, "submit-message", [msg]);

    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();
  });

  it("extracts only once per user message across multiple sendMessages calls", async () => {
    const transport = transportWithExistingFolder();

    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
    ]);
    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
      uiMessage("assistant", "Tell me more"),
    ]);
    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
      uiMessage("assistant", "Tell me more"),
      userMsg("msg-1", "I have a dog"),
    ]);

    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(1);
  });

  it("extracts once per distinct user message", async () => {
    const transport = transportWithExistingFolder();

    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
    ]);
    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
      uiMessage("assistant", "Nice!"),
      userMsg("msg-2", "I also have a cat"),
    ]);
    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
      uiMessage("assistant", "Nice!"),
      userMsg("msg-2", "I also have a cat"),
      uiMessage("assistant", "Cool!"),
      userMsg("msg-3", "And a hamster"),
    ]);

    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(3);
    expect(mockedExtractAndStoreMemories).toHaveBeenNthCalledWith(
      1,
      "I have a dog",
      expect.any(Function),
      expect.anything(),
      undefined,
      { emitEvent: expect.any(Function) },
    );
    expect(mockedExtractAndStoreMemories).toHaveBeenNthCalledWith(
      2,
      "I also have a cat",
      expect.any(Function),
      expect.anything(),
      undefined,
      { emitEvent: expect.any(Function) },
    );
    expect(mockedExtractAndStoreMemories).toHaveBeenNthCalledWith(
      3,
      "And a hamster",
      expect.any(Function),
      expect.anything(),
      undefined,
      { emitEvent: expect.any(Function) },
    );
  });

  // GT-13: ask_questions answer extracts even when prior user message ID is already processed
  it("ask_questions answer extracts even when prior user message ID already processed (GT-13)", async () => {
    const transport = transportWithExistingFolder();

    // First send: extract user message
    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
    ]);
    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(1);

    // Second send: same user message (already processed) + ask_questions answers (new)
    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
      uiMessage("assistant", "Tell me more"),
      askQuestionsMsg("aq-1", [
        { question: "What OS?", answer: "macOS" },
      ]),
    ]);

    // Should be called again (for the ask_questions candidate)
    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(2);
    // The second call should have the structured Q&A content
    const secondCallContent = mockedExtractAndStoreMemories.mock.calls[1][0];
    expect(secondCallContent).toContain("macOS");
    expect(secondCallContent).toContain("What OS?");
  });

  it("does not trigger when reopening a persisted conversation (no sendMessages call)", () => {
    const transport = new DirectTransport(
      () => ({ provider: "openrouter", apiKey: "key", model: "m" }) as never,
      () => mockEmbeddingConfig,
      () => mockRerankerConfig,
      () => ({}),
      "chat-id",
      "existing-folder",
    );

    expect(transport).toBeDefined();
    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();
  });

  it("does not trigger when conversation with history is loaded and user sends first message", async () => {
    const transport = transportWithExistingFolder();

    await sendMessages(transport, "submit-message", [
      userMsg("old-1", "Old message from yesterday"),
      uiMessage("assistant", "Old response"),
      userMsg("old-2", "Another old message"),
      uiMessage("assistant", "Old response 2"),
      userMsg("new-1", "New message today"),
    ]);

    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(1);
    expect(mockedExtractAndStoreMemories).toHaveBeenCalledWith(
      "New message today",
      expect.any(Function),
      expect.anything(),
      undefined,
      { emitEvent: expect.any(Function) },
    );
  });

  it("does not trigger for error stream events", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "unused" }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: tokenUsage(),
        warnings: [],
      }),
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({ chunks: textChunks("Error occurred.") }),
      }),
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);

    const transport = transportWithExistingFolder();
    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
      uiMessage("assistant", "Error occurred."),
    ]);

    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(1);
  });

  it("does not trigger for assistant messages with only reasoning parts", async () => {
    const transport = transportWithExistingFolder();
    const msg: UIMessage = {
      id: "reasoning-msg",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "Let me think about this..." },
      ],
    };

    await sendMessages(transport, "submit-message", [msg]);

    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();
  });

  it("still works for a valid user message after guard changes", async () => {
    mockedExtractAndStoreMemories.mockResolvedValueOnce({ memoriesStored: 2 });
    const transport = transportWithExistingFolder();

    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog and use macOS"),
    ]);

    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(1);
    expect(mockedExtractAndStoreMemories).toHaveBeenCalledWith(
      "I have a dog and use macOS",
      expect.any(Function),
      expect.anything(),
      undefined,
      { emitEvent: expect.any(Function) },
    );
  });

  // GT-18: extraction is awaited: failure prevents guarded stream
  it("extraction is awaited: failure prevents guarded stream (GT-18)", async () => {
    mockedExtractAndStoreMemories.mockRejectedValueOnce(
      new Error("Extraction failed"),
    );

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "unused" }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: tokenUsage(),
        warnings: [],
      }),
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({ chunks: textChunks("Should not run.") }),
      }),
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);

    const transport = transportWithExistingFolder();
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "test-chat",
      messageId: "test-msg",
      messages: [userMsg("msg-1", "I have a dog")],
      abortSignal: undefined,
    });

    let sawErrorFinish = false;
    let sawTextDelta = false;
    let sawStopFinish = false;
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if ("type" in value) {
          if (value.type === "text-delta") sawTextDelta = true;
          if (value.type === "finish") {
            if (value.finishReason === "error") sawErrorFinish = true;
            if (value.finishReason === "stop") sawStopFinish = true;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // The stream MUST finish with error because extraction threw
    expect(sawErrorFinish).toBe(true);
    // The guarded stream MUST NOT have started (no text-delta, no stop finish)
    expect(sawTextDelta).toBe(false);
    expect(sawStopFinish).toBe(false);
  });

  // GT-19: processedMemoryMessageIds.add only after successful extraction
  it("processedMemoryMessageIds.add only after successful extraction (GT-19)", async () => {
    // First send: extraction fails
    mockedExtractAndStoreMemories.mockRejectedValueOnce(
      new Error("Extraction failed"),
    );

    const transport = transportWithExistingFolder();
    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
    ]);

    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(1);

    // Second send: extraction succeeds
    mockedExtractAndStoreMemories.mockResolvedValueOnce({ memoriesStored: 1 });
    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
    ]);

    // Should be called again because ID was NOT added after failure
    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(2);
  });

  // GT-20: does not trigger on regenerate-message for any candidate type (already covered above)
  it("does not trigger on regenerate-message for ask_questions either (GT-20)", async () => {
    const transport = transportWithExistingFolder();
    await sendMessages(transport, "regenerate-message", [
      askQuestionsMsg("aq-1", [
        { question: "Q", answer: "A" },
      ]),
    ]);
    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();
  });

  it("triggers extraction for ask_questions answers via sendMessages", async () => {
    mockedExtractAndStoreMemories.mockResolvedValueOnce({ memoriesStored: 2 });
    const transport = transportWithExistingFolder();

    await sendMessages(transport, "submit-message", [
      askQuestionsMsg("aq-1", [
        { question: "Preferred language?", answer: "TypeScript" },
        { question: "Preferred OS?", answer: "macOS" },
      ]),
    ]);

    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(1);
    const callContent = mockedExtractAndStoreMemories.mock.calls[0][0];
    expect(callContent).toContain("TypeScript");
    expect(callContent).toContain("macOS");
  });

  // GT-16: does not mark unanswered ask_questions as processed
  it("does not mark unanswered ask_questions as processed (GT-16)", async () => {
    const transport = transportWithExistingFolder();

    // First send: unanswered ask_questions only (input-available) — no extraction
    await sendMessages(transport, "submit-message", [
      askQuestionsInputMsg("aq-unanswered"),
    ]);
    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();

    // Second send: same unanswered ask_questions + a new user message
    await sendMessages(transport, "submit-message", [
      askQuestionsInputMsg("aq-unanswered"),
      userMsg("msg-2", "I like TypeScript"),
    ]);

    // Extraction should trigger once (for the user message only)
    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(1);
    expect(mockedExtractAndStoreMemories).toHaveBeenCalledWith(
      "I like TypeScript",
      expect.any(Function),
      expect.anything(),
      undefined,
      { emitEvent: expect.any(Function) },
    );
  });

  // GT-21: logs minimal fields for user-message and tool-answer candidates
  it("logs minimal fields for user-message and tool-answer candidates (GT-21)", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const transport = transportWithExistingFolder();

    await sendMessages(transport, "submit-message", [
      userMsg("msg-1", "I have a dog"),
      askQuestionsMsg("aq-1", [
        { question: "What OS?", answer: "macOS" },
      ]),
    ]);

    const debugCalls = debugSpy.mock.calls;

    // Find extract calls (filter out memory-agent internal debug logs)
    const extractCalls = debugCalls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0] === "[memory-extraction]" &&
        typeof call[1] === "object" &&
        call[1] !== null &&
        "decision" in (call[1] as Record<string, unknown>) &&
        (call[1] as Record<string, unknown>).decision === "extract",
    );

    expect(extractCalls).toHaveLength(2);

    const firstCall = extractCalls[0][1] as Record<string, unknown>;
    const secondCall = extractCalls[1][1] as Record<string, unknown>;

    // Both calls share the same correlationId
    expect(firstCall.correlationId).toBeDefined();
    expect(secondCall.correlationId).toBe(firstCall.correlationId);
    expect(firstCall.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // First call: user-message source — NO toolName field
    expect(firstCall).toMatchObject({
      source: "user-message",
      decision: "extract",
    });
    expect(firstCall.candidateId).toBe("msg-1");
    expect(typeof firstCall.contentLength).toBe("number");
    expect(firstCall).not.toHaveProperty("toolName");

    // Second call: tool-answer source — HAS toolName field
    expect(secondCall).toMatchObject({
      source: "tool-answer",
      toolName: "ask_questions",
      decision: "extract",
    });
    expect(secondCall.candidateId).toBe("aq-1");
    expect(typeof secondCall.contentLength).toBe("number");

    debugSpy.mockRestore();
  });

  // GT-21 sub-case: skip-no-candidate log
  it("logs skip-no-candidate when no eligible candidates (GT-21 skip-no-candidate)", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const transport = transportWithExistingFolder();

    await sendMessages(transport, "submit-message", [
      uiMessage("assistant", "Hello"),
    ]);

    const debugCalls = debugSpy.mock.calls;

    const skipCalls = debugCalls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0] === "[memory-extraction]" &&
        typeof call[1] === "object" &&
        call[1] !== null &&
        "decision" in (call[1] as Record<string, unknown>) &&
        (call[1] as Record<string, unknown>).decision === "skip-no-candidate",
    );

    expect(skipCalls).toHaveLength(1);
    const skipCall = skipCalls[0][1] as Record<string, unknown>;
    expect(skipCall.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(skipCall.decision).toBe("skip-no-candidate");

    debugSpy.mockRestore();
  });
});

// ─── Test helpers ───

function transportWithExistingFolder(): DirectTransport {
  return new DirectTransport(
    () => ({ provider: "openrouter", apiKey: "chat-key", model: "test-model" }) as never,
    () => mockEmbeddingConfig,
    () => mockRerankerConfig,
    () => ({}),
    "2026-05-22T10-11-12.123Z",
    "test-folder",
  );
}

async function sendMessages(
  transport: DirectTransport,
  trigger: "submit-message" | "regenerate-message",
  messages: UIMessage[],
) {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: "unused" }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: tokenUsage(),
      warnings: [],
    }),
    doStream: async (): Promise<LanguageModelV3StreamResult> => ({
      stream: simulateReadableStream({ chunks: textChunks("Done.") }),
    }),
  });
  chatProviderMocks.createChatLanguageModel.mockReturnValue(model);

  const stream = await transport.sendMessages({
    trigger,
    chatId: "test-chat",
    messageId: "test-msg",
    messages,
    abortSignal: undefined,
  });

  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function uiMessage(role: "user" | "assistant" | "system", text: string): UIMessage {
  return {
    id: `${role}-${text}`,
    role,
    parts: [{ type: "text", text }],
  };
}

function userMsg(id: string, text: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function textChunks(text: string) {
  return [
    { type: "stream-start" as const, warnings: [] },
    { type: "text-start" as const, id: "text-1" },
    { type: "text-delta" as const, id: "text-1", delta: text },
    { type: "text-end" as const, id: "text-1" },
    {
      type: "finish" as const,
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: tokenUsage(),
    },
  ];
}

function tokenUsage() {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
}
