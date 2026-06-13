import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MockLanguageModelV3,
  simulateReadableStream,
} from "ai/test";
import type { UIMessage } from "ai";
import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";

const mockEmbeddingConfig: EmbeddingConfig = { api_key: "test-key", base_url: "https://openrouter.ai/api/v1", model: "qwen/qwen3-embedding-4b", dimensions: 1024, query_prefix: "Represent this sentence for searching relevant passages: " };
const mockRerankerConfig: RerankerConfig = { api_key: "test-key", base_url: "https://openrouter.ai/api/v1", model: "cohere/rerank-4-pro" };

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
  BaseDirectory: {
    AppData: "AppData",
  },
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

import {
  DirectTransport,
} from "@/lib/transport";
import { extractAndStoreMemories } from "@/lib/memory-agent";

const mockedExtractAndStoreMemories = vi.mocked(extractAndStoreMemories);

describe("DirectTransport research folder lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.exists.mockResolvedValue(false);
    fsMocks.readDir.mockResolvedValue([]);
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeTextFile.mockResolvedValue(undefined);
    fsMocks.rename.mockResolvedValue(undefined);
    fsMocks.remove.mockResolvedValue(undefined);
    tauriMocks.invoke.mockResolvedValue(undefined);
    mockedExtractAndStoreMemories.mockResolvedValue({ memoriesStored: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the folder from the user message before creating it", async () => {
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "search_research") return [];
      return undefined;
    });
    const model = createModel("acme-earnings-calls");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = createTransport(onFolderChange);

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "runtime-chat",
      messageId: "user-1",
      messages: [userMessage("Find earnings calls for ACME?")],
      abortSignal: undefined,
    });
    await consumeStream(stream);

    expect(fsMocks.mkdir).toHaveBeenNthCalledWith(
      1,
      "search-results/acme-earnings-calls",
      { recursive: true },
    );
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/acme-earnings-calls/chats/2026-05-22T10-11-12.123Z.json",
      expect.any(String),
    );
    expect(fsMocks.mkdir.mock.invocationCallOrder[0]).toBeLessThan(
      fsMocks.writeTextFile.mock.invocationCallOrder[0],
    );
    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(onFolderChange).toHaveBeenCalledWith("acme-earnings-calls", {});
  });

  it("creates and persists the folder before memory extraction or streaming starts", async () => {
    const events: string[] = [];
    fsMocks.mkdir.mockImplementation(async (path: string) => {
      if (path === "search-results/acme-ordering") {
        events.push("folder-created");
      }
    });
    fsMocks.writeTextFile.mockImplementation(async (path: string) => {
      events.push(`write:${path}`);
    });
    mockedExtractAndStoreMemories.mockImplementation(async () => {
      events.push("memory-started");
      return { memoriesStored: 0 };
    });

    let streamCallIndex = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "acme-ordering" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: tokenUsage(),
        warnings: [],
      }),
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        streamCallIndex++;
        if (streamCallIndex === 1) {
          return {
            stream: simulateReadableStream({ chunks: textChunks("acme-ordering") }),
          };
        }
        events.push("stream-started");
        return {
          stream: simulateReadableStream({ chunks: textChunks("Done.") }),
        };
      },
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);

    await consumeStream(
      await createTransport(vi.fn()).sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Research ACME ordering")],
        abortSignal: undefined,
      }),
    );

    const firstChatWriteIndex = events.findIndex((event) =>
      event.startsWith("write:search-results/acme-ordering/chats/"),
    );
    expect(events.indexOf("folder-created")).toBeLessThan(firstChatWriteIndex);
    expect(firstChatWriteIndex).toBeLessThan(events.indexOf("memory-started"));
    expect(firstChatWriteIndex).toBeLessThan(events.indexOf("stream-started"));

    const writePaths = fsMocks.writeTextFile.mock.calls.map(([path]) => path);
    expect(writePaths.length).toBeGreaterThan(0);
    expect(
      writePaths.every((path) => path.startsWith("search-results/acme-ordering/")),
    ).toBe(true);
    expect(writePaths).toContain(
      "search-results/acme-ordering/chats/index.json",
    );
  });

  it("does not stream tool calls before the folder exists", async () => {
    const events: string[] = [];
    fsMocks.mkdir.mockImplementation(async (path: string) => {
      if (path === "search-results/acme-tools") {
        events.push("folder-created");
      }
    });
    fsMocks.writeTextFile.mockImplementation(async (path: string) => {
      if (path.startsWith("search-results/acme-tools/chats/")) {
        events.push("chat-written");
      }
    });

    let streamCallIndex = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "acme-tools" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: tokenUsage(),
        warnings: [],
      }),
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        streamCallIndex++;
        if (streamCallIndex === 1) {
          return {
            stream: simulateReadableStream({ chunks: textChunks("acme-tools") }),
          };
        }
        events.push("tool-stream-started");
        return {
          stream: simulateReadableStream({
            chunks: toolCallChunks("ask_questions", "call-question", {
              questions: [
                {
                  question: "Which market?",
                  candidates: [{ label: "AI search", value: "ai-search" }],
                },
              ],
            }),
          }),
        };
      },
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);

    const chunks = await collectChunks(
      await createTransport(vi.fn()).sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Research ACME tooling")],
        abortSignal: undefined,
      }),
    );

    expect(events.indexOf("folder-created")).toBeLessThan(
      events.indexOf("chat-written"),
    );
    expect(events.indexOf("chat-written")).toBeLessThan(
      events.indexOf("tool-stream-started"),
    );
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-input-available",
        toolName: "ask_questions",
      }),
    );
  });

  it("moves the chat to an existing folder when user chooses continue", async () => {
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "search_research") {
        return [
          {
            chunk_id: 1,
            content: "Market map notes",
            filename: "README.md",
            folder_name: "market-map",
            header_path: null,
            score: 0.9,
            adjacent_chunks: null,
          },
        ];
      }
      return undefined;
    });
    const model = createModel("earnings-research");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = createTransport(onFolderChange);

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Find earnings calls for ACME?")],
        abortSignal: undefined,
      }),
    );

    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(onFolderChange).toHaveBeenCalledWith("earnings-research", {});

    fsMocks.exists.mockResolvedValue(true);

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "question-1",
        messages: [
          userMessage("Find earnings calls for ACME?"),
          assistantQuestionAnswer("continue:market-map"),
        ],
        abortSignal: undefined,
      }),
    );

    expect(fsMocks.remove).toHaveBeenCalledWith(
      "search-results/earnings-research/chats/2026-05-22T10-11-12.123Z.json",
    );
    expect(fsMocks.remove).not.toHaveBeenCalledWith(
      "search-results/earnings-research",
      { recursive: true },
    );
    expect(onFolderChange).toHaveBeenCalledWith("market-map", {
      previousFolderName: "earnings-research",
    });
  });

  it("keeps the current folder when user chooses start-fresh", async () => {
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "search_research") {
        return [
          {
            chunk_id: 1,
            content: "Market map notes",
            filename: "README.md",
            folder_name: "market-map",
            header_path: null,
            score: 0.9,
            adjacent_chunks: null,
          },
        ];
      }
      return undefined;
    });
    const model = createModel("earnings-research");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = createTransport(onFolderChange);

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Find earnings calls for ACME?")],
        abortSignal: undefined,
      }),
    );

    expect(onFolderChange).toHaveBeenCalledWith("earnings-research", {});

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "question-1",
        messages: [
          userMessage("Find earnings calls for ACME?"),
          assistantQuestionAnswer("new"),
        ],
        abortSignal: undefined,
      }),
    );

    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(fsMocks.remove).not.toHaveBeenCalled();
  });

  it("opens an existing folder without renaming", async () => {
    const model = createModel("unused-name");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = new DirectTransport(
      () => ({ provider: "openrouter", apiKey: "chat-key", model: "test-model" }) as never,
      () => mockEmbeddingConfig,
      () => mockRerankerConfig,
      () => ({}),
      "2026-05-22T10-11-12.123Z",
      "existing-folder",
    );

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "runtime-chat",
      messageId: "user-1",
      messages: [userMessage("Continue my research")],
      abortSignal: undefined,
    });
    const chunks = await collectChunks(stream);

    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      "search-results/existing-folder",
      { recursive: true },
    );
    const finishChunks = chunks.filter(
      (c) => typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "finish",
    );
    expect(finishChunks.length).toBeGreaterThanOrEqual(1);
  });

  it("reuses an existing folder on resume without generating a second folder", async () => {
    const doGenerate = vi.fn(async (): Promise<LanguageModelV3GenerateResult> => ({
      content: [{ type: "text", text: "unexpected-new-folder" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: tokenUsage(),
      warnings: [],
    }));
    const model = new MockLanguageModelV3({
      doGenerate,
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({ chunks: textChunks("Done.") }),
      }),
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = new DirectTransport(
      () => ({ provider: "openrouter", apiKey: "chat-key", model: "test-model" }) as never,
      () => mockEmbeddingConfig,
      () => mockRerankerConfig,
      () => ({}),
      "2026-05-22T10-11-12.123Z",
      "existing-folder",
      onFolderChange,
    );

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Continue my research")],
        abortSignal: undefined,
      }),
    );

    expect(doGenerate).not.toHaveBeenCalled();
    expect(onFolderChange).not.toHaveBeenCalled();
    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      "search-results/existing-folder",
      { recursive: true },
    );
    expect(fsMocks.mkdir).not.toHaveBeenCalledWith(
      "search-results/unexpected-new-folder",
      expect.anything(),
    );
    expect(
      fsMocks.writeTextFile.mock.calls.every(([path]) =>
        path.startsWith("search-results/existing-folder/"),
      ),
    ).toBe(true);
  });

  it("throws when no chat model is configured", async () => {
    const transport = new DirectTransport(
      () => null,
      () => mockEmbeddingConfig,
      () => mockRerankerConfig,
      () => ({}),
      "chat-id",
    );

    await expect(
      transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Hello")],
        abortSignal: undefined,
      }),
    ).rejects.toThrow("No chat model is configured.");
  });

  it("reconnectToStream resolves to null", async () => {
    const transport = createTransport(vi.fn());
    await expect(transport.reconnectToStream()).resolves.toBeNull();
  });

  it("does not call nameFolderFromMessage when folder already set", async () => {
    const model = createModel("unused-name");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = new DirectTransport(
      () => ({ provider: "openrouter", apiKey: "chat-key", model: "test-model" }) as never,
      () => mockEmbeddingConfig,
      () => mockRerankerConfig,
      () => ({}),
      "2026-05-22T10-11-12.123Z",
      "preset-folder",
      onFolderChange,
    );

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "runtime-chat",
      messageId: "user-1",
      messages: [userMessage("Continue my research")],
      abortSignal: undefined,
    });
    await consumeStream(stream);

    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      "search-results/preset-folder",
      { recursive: true },
    );
    expect(onFolderChange).not.toHaveBeenCalled();
  });

  it("emits sub-agent events through the stream during naming", async () => {
    const model = createModel("acme-research");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = createTransport(vi.fn());

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "runtime-chat",
      messageId: "user-1",
      messages: [userMessage("Research ACME")],
      abortSignal: undefined,
    });
    const chunks = await collectChunks(stream);

    const subAgentChunks = chunks.filter(
      (c) => typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "data-subagent_event",
    );
    expect(subAgentChunks.length).toBeGreaterThanOrEqual(2);
  });

  it("uses deterministic fallback when model output fails validation", async () => {
    let streamCallIndex = 0;
    const doStream = vi.fn(async (): Promise<LanguageModelV3StreamResult> => {
      streamCallIndex++;
      const text = streamCallIndex === 1
        ? "The folder should be named something very descriptive with many words"
        : "Done.";
      return {
        stream: simulateReadableStream({ chunks: textChunks(text) }),
      };
    });
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "The folder should be named something very descriptive with many words" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: tokenUsage(),
        warnings: [],
      }),
      doStream,
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = createTransport(onFolderChange);

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "runtime-chat",
      messageId: "user-1",
      messages: [userMessage("Research ACME")],
      abortSignal: undefined,
    });
    const chunks = await collectChunks(stream);

    const finishChunks = chunks.filter(
      (c) => typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "finish",
    );
    expect(finishChunks.length).toBeGreaterThanOrEqual(1);
    expect(fsMocks.mkdir).toHaveBeenCalled();
    expect(fsMocks.writeTextFile).toHaveBeenCalled();
    expect(onFolderChange).toHaveBeenCalled();
  });

  it("uses deterministic fallback when model returns empty output", async () => {
    let streamCallIndex = 0;
    const doStream = vi.fn(async (): Promise<LanguageModelV3StreamResult> => {
      streamCallIndex++;
      const text = streamCallIndex === 1 ? "" : "Done.";
      return {
        stream: simulateReadableStream({ chunks: textChunks(text) }),
      };
    });
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: tokenUsage(),
        warnings: [],
      }),
      doStream,
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);

    const chunks = await collectChunks(
      await createTransport(vi.fn()).sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Research ACME")],
        abortSignal: undefined,
      }),
    );

    const finishChunks = chunks.filter(
      (c) => typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "finish",
    );
    expect(finishChunks.length).toBeGreaterThanOrEqual(1);
    expect(fsMocks.mkdir).toHaveBeenCalled();
    expect(fsMocks.writeTextFile).toHaveBeenCalled();
    expect(doStream).toHaveBeenCalled();
  });

  it("stops startup with a clear error when folder creation fails", async () => {
    let streamCallIndex = 0;
    const doStream = vi.fn(async (): Promise<LanguageModelV3StreamResult> => {
      streamCallIndex++;
      const text = streamCallIndex === 1 ? "acme-failure" : "Done.";
      return {
        stream: simulateReadableStream({ chunks: textChunks(text) }),
      };
    });
    fsMocks.mkdir.mockImplementation(async (path: string) => {
      if (path === "search-results/acme-failure") {
        throw new Error("disk denied");
      }
    });
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "acme-failure" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: tokenUsage(),
        warnings: [],
      }),
      doStream,
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();

    const chunks = await collectChunks(
      await createTransport(onFolderChange).sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Research ACME")],
        abortSignal: undefined,
      }),
    );

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorText: expect.stringContaining("could not be created"),
      }),
    );
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorText: expect.stringContaining("disk denied"),
      }),
    );
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
    expect(mockedExtractAndStoreMemories).not.toHaveBeenCalled();
    expect(doStream).toHaveBeenCalledTimes(1);
    expect(onFolderChange).not.toHaveBeenCalled();
  });

  it("names folder only once on the first message, reuses on subsequent", async () => {
    const model = createModel("acme-earnings");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = createTransport(onFolderChange);

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Find earnings calls for ACME?")],
        abortSignal: undefined,
      }),
    );

    expect(onFolderChange).toHaveBeenCalledWith("acme-earnings", {});
    onFolderChange.mockClear();

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-2",
        messages: [
          userMessage("Find earnings calls for ACME?"),
          userMessage("Tell me more"),
        ],
        abortSignal: undefined,
      }),
    );

    expect(onFolderChange).not.toHaveBeenCalled();
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      expect.stringContaining("search-results/acme-earnings"),
      expect.any(String),
    );
  });

  it("names folder from the first user message in the conversation", async () => {
    const model = createModel("first-msg-topic");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = createTransport(onFolderChange);

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [
          userMessage("Research topic A"),
          userMessage("But also tell me about topic B"),
        ],
        abortSignal: undefined,
      }),
    );

    expect(onFolderChange).toHaveBeenCalledWith("first-msg-topic", {});
  });

  it("emits an abort chunk when aborted during folder naming", async () => {
    const abortController = new AbortController();
    let streamStarted!: () => void;
    const streamStartedPromise = new Promise<void>((resolve) => {
      streamStarted = resolve;
    });
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        return new Promise<never>((_, reject) => {
          abortController.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        });
      },
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        streamStarted();
        return new Promise<never>((_, reject) => {
          abortController.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        });
      },
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = createTransport(vi.fn());

    const streamPromise = transport.sendMessages({
      trigger: "submit-message",
      chatId: "runtime-chat",
      messageId: "user-1",
      messages: [userMessage("Find earnings calls for ACME?")],
      abortSignal: abortController.signal,
    });

    await streamStartedPromise;
    abortController.abort();

    const stream = await streamPromise;
    const chunks = await collectChunks(stream);

    const hasAbortChunk = chunks.some(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "type" in c &&
        (c as { type: string }).type === "abort",
    );
    expect(hasAbortChunk).toBe(true);
  });
});

describe("DirectTransport coffee beans scenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.exists.mockResolvedValue(false);
    fsMocks.readDir.mockResolvedValue([]);
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeTextFile.mockResolvedValue(undefined);
    fsMocks.rename.mockResolvedValue(undefined);
    fsMocks.remove.mockResolvedValue(undefined);
    tauriMocks.invoke.mockResolvedValue(undefined);
    mockedExtractAndStoreMemories.mockResolvedValue({ memoriesStored: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses LLM folder name for coffee beans query", async () => {
    const model = createModel("best-coffee-beans-espresso");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = createTransport(onFolderChange);

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "runtime-chat",
      messageId: "user-1",
      messages: [userMessage("I'm looking for the best coffee beans for espresso")],
      abortSignal: undefined,
    });
    await consumeStream(stream);

    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      "search-results/best-coffee-beans-espresso",
      { recursive: true },
    );
    expect(onFolderChange).toHaveBeenCalledWith("best-coffee-beans-espresso", {});
  });

  it("triggers memory extraction with the raw user query", async () => {
    const model = createModel("best-coffee-beans-espresso");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    mockedExtractAndStoreMemories.mockResolvedValue({ memoriesStored: 1 });
    const transport = createTransport(vi.fn());

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("I'm looking for the best coffee beans for espresso")],
        abortSignal: undefined,
      }),
    );

    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(1);
    expect(mockedExtractAndStoreMemories).toHaveBeenCalledWith(
      "I'm looking for the best coffee beans for espresso",
      expect.any(Function),
      expect.anything(),
      undefined,
      { emitEvent: expect.any(Function) },
    );
  });

  it("uses deterministic fallback with topic words when model fails", async () => {
    let streamCallIndex = 0;
    const maxFolderNamingAttempts = 3;
    const doStream = vi.fn(async (): Promise<LanguageModelV3StreamResult> => {
      streamCallIndex++;
      const text = streamCallIndex <= maxFolderNamingAttempts
        ? "invalid output with spaces and special chars!"
        : "Done.";
      return {
        stream: simulateReadableStream({ chunks: textChunks(text) }),
      };
    });
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "invalid output with spaces and special chars!" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: tokenUsage(),
        warnings: [],
      }),
      doStream,
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = createTransport(onFolderChange);

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("I'm looking for the best coffee beans for espresso")],
        abortSignal: undefined,
      }),
    );

    expect(onFolderChange).toHaveBeenCalled();
    const folderName = onFolderChange.mock.calls[0][0];
    expect(folderName).not.toBe("im-looking-for-the-best");
    expect(folderName).toContain("coffee");
  });

  it("does not extract memory from assistant or tool messages", async () => {
    const model = createModel("coffee-beans");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = createTransport(vi.fn());

    const assistantMsg: UIMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Here are some results about coffee beans" }],
    };
    const toolMsg: UIMessage = {
      id: "tool-1",
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

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [
          userMessage("I'm looking for the best coffee beans for espresso"),
          assistantMsg,
          toolMsg,
        ],
        abortSignal: undefined,
      }),
    );

    expect(mockedExtractAndStoreMemories).toHaveBeenCalledTimes(1);
    expect(mockedExtractAndStoreMemories).toHaveBeenCalledWith(
      "I'm looking for the best coffee beans for espresso",
      expect.any(Function),
      expect.anything(),
      undefined,
      { emitEvent: expect.any(Function) },
    );
  });
});

describe("DirectTransport error handling", () => {
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits error + finish(error) when model streaming throws", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error("Provider connection refused");
      },
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = createTransport(vi.fn());
    transport.setResearchFolder("test-folder");

    const chunks = await collectChunks(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("test query")],
        abortSignal: undefined,
      }),
    );

    const errorChunk = chunks.find(
      (c) => typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "error",
    );
    const finishChunk = chunks.find(
      (c) => typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "finish",
    );

    expect(errorChunk).toEqual(
      expect.objectContaining({
        type: "error",
        errorText: "Provider connection refused",
      }),
    );
    expect(finishChunk).toEqual(
      expect.objectContaining({
        type: "finish",
        finishReason: "error",
      }),
    );
  });

  it("emits finish(stop) on successful completion", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: textChunks("All done.") }),
      }),
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = createTransport(vi.fn());
    transport.setResearchFolder("test-folder");

    const chunks = await collectChunks(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("test query")],
        abortSignal: undefined,
      }),
    );

    const finishChunk = chunks.find(
      (c) => typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "finish",
    );
    expect(finishChunk).toEqual(
      expect.objectContaining({
        type: "finish",
        finishReason: "stop",
      }),
    );

    const errorChunks = chunks.filter(
      (c) => typeof c === "object" && c !== null && "type" in c && (c as { type: string }).type === "error",
    );
    expect(errorChunks).toHaveLength(0);
  });
});

function createTransport(
  onFolderChange: (folderName: string, options: { previousFolderName?: string }) => void,
) {
  return new DirectTransport(
    () =>
      ({
        provider: "openrouter",
        apiKey: "chat-key",
        model: "test-model",
      }) as never,
    () => mockEmbeddingConfig,
    () => mockRerankerConfig,
    () => ({}),
    "2026-05-22T10-11-12.123Z",
    null,
    onFolderChange,
  );
}

function createModel(folderNameResponse: string) {
  let streamCallCount = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: folderNameResponse }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: tokenUsage(),
      warnings: [],
    }),
    doStream: async (): Promise<LanguageModelV3StreamResult> => {
      streamCallCount++;
      const text = streamCallCount === 1 ? folderNameResponse : "Done.";
      return {
        stream: simulateReadableStream({
          chunks: textChunks(text),
        }),
      };
    },
  });
}

function userMessage(text: string): UIMessage {
  return {
    id: `user-${text}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function assistantQuestionAnswer(answer: string): UIMessage {
  return {
    id: "assistant-question",
    role: "assistant",
    parts: [
      {
        type: "tool-ask_questions",
        toolCallId: "question-1",
        state: "output-available",
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
        output: {
          answers: [{ question: "Continue previous research?", answer }],
        },
      } as UIMessage["parts"][number],
    ],
  };
}

function textChunks(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: "stream-start" as const, warnings: [] },
    { type: "text-start" as const, id: "text-1" },
    { type: "text-delta" as const, id: "text-1", delta: text },
    { type: "text-end" as const, id: "text-1" },
    {
      type: "finish" as const,
      finishReason: { unified: "stop", raw: "stop" },
      usage: tokenUsage(),
    },
  ];
}

function toolCallChunks(
  toolName: string,
  toolCallId: string,
  input: unknown,
): LanguageModelV3StreamPart[] {
  return [
    { type: "stream-start" as const, warnings: [] },
    {
      type: "tool-call" as const,
      toolCallId,
      toolName,
      input: JSON.stringify(input),
    },
    {
      type: "finish" as const,
      finishReason: { unified: "tool-calls", raw: "tool-calls" },
      usage: tokenUsage(),
    },
  ];
}

function tokenUsage() {
  return {
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
  };
}

async function consumeStream(stream: ReadableStream<unknown>): Promise<void> {
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

async function collectChunks(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const reader = stream.getReader();
  const chunks: unknown[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return chunks;
}
