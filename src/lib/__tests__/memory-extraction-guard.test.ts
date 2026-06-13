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
import { isEligibleForMemoryExtraction } from "@/lib/transport";

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
});

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
