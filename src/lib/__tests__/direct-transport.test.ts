import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MockLanguageModelV3,
  simulateReadableStream,
} from "ai/test";
import type { UIMessage } from "ai";
import type {
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

vi.mock("@tauri-apps/plugin-fs", () => ({
  ...fsMocks,
  BaseDirectory: {
    AppData: "AppData",
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
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

import {
  DirectTransport,
} from "@/lib/transport";

describe("DirectTransport research folder lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 22, 10, 11, 12));
    vi.clearAllMocks();
    fsMocks.exists.mockResolvedValue(false);
    fsMocks.readDir.mockResolvedValue([]);
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeTextFile.mockResolvedValue(undefined);
    fsMocks.rename.mockResolvedValue(undefined);
    fsMocks.remove.mockResolvedValue(undefined);
    tauriMocks.invoke.mockResolvedValue(undefined);
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
    await stream.cancel();

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/acme-earnings-calls/chats/2026-05-22T10-11-12.123Z.json",
      expect.any(String),
      expect.any(Object),
    );
    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(onFolderChange).toHaveBeenCalledWith("acme-earnings-calls", {});
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

    await cancelStream(
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

    await cancelStream(
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
      "search-results/earnings-research",
      expect.any(Object),
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

    await cancelStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Find earnings calls for ACME?")],
        abortSignal: undefined,
      }),
    );

    expect(onFolderChange).toHaveBeenCalledWith("earnings-research", {});

    await cancelStream(
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
    await stream.cancel();
    await vi.runAllTimersAsync();

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      expect.stringContaining("search-results/existing-folder"),
      expect.any(String),
      expect.any(Object),
    );
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

  it("rejects promptly when aborted during folder naming", async () => {
    const abortController = new AbortController();
    let generateStarted!: () => void;
    const generateStartedPromise = new Promise<void>((resolve) => {
      generateStarted = resolve;
    });
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        generateStarted();
        return new Promise<never>((_, reject) => {
          abortController.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        });
      },
      doStream: async (): Promise<LanguageModelV3StreamResult> => ({
        stream: simulateReadableStream({ chunks: textChunks("Done.") }),
      }),
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = createTransport(vi.fn());

    const pending = transport.sendMessages({
      trigger: "submit-message",
      chatId: "runtime-chat",
      messageId: "user-1",
      messages: [userMessage("Find earnings calls for ACME?")],
      abortSignal: abortController.signal,
    });

    await generateStartedPromise;
    abortController.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
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
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: folderNameResponse }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: tokenUsage(),
      warnings: [],
    }),
    doStream: async (): Promise<LanguageModelV3StreamResult> => ({
      stream: simulateReadableStream({
        chunks: textChunks("Done."),
      }),
    }),
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

async function cancelStream(stream: ReadableStream<unknown>): Promise<void> {
  await stream.cancel().catch(() => {});
}
