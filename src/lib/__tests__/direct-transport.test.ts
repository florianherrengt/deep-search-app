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

import {
  DirectTransport,
  type ResearchFolderChangeOptions,
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

  it("creates a timestamp folder before previous-research lookup and keeps it provisional when no match exists", async () => {
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === "search_research") return [];
      return undefined;
    });
    const model = createModel();
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

    const firstWritePath = fsMocks.writeTextFile.mock.calls[0]?.[0];
    expect(firstWritePath).toBe(
      "search-results/2026-05-22_10-11-12/chats/2026-05-22T10-11-12.123Z.json",
    );

    const searchOrder = tauriMocks.invoke.mock.invocationCallOrder[
      tauriMocks.invoke.mock.calls.findIndex(([command]) => command === "search_research")
    ];
    expect(fsMocks.writeTextFile.mock.invocationCallOrder[0]).toBeLessThan(
      searchOrder,
    );
    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(onFolderChange).toHaveBeenCalledWith("2026-05-22_10-11-12", {
      isProvisional: true,
    });
  });

  it("keeps the timestamp folder while previous research is unresolved, then moves the chat on continue", async () => {
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
    fsMocks.exists.mockImplementation(async (path: string) => {
      return path === "search-results/2026-05-22_10-11-12";
    });
    const model = createModel();
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

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/market-map/chats/2026-05-22T10-11-12.123Z.json",
      expect.any(String),
      expect.any(Object),
    );
    expect(fsMocks.remove).toHaveBeenCalledWith(
      "search-results/2026-05-22_10-11-12",
      expect.any(Object),
    );
    expect(onFolderChange).toHaveBeenCalledWith("market-map", {
      isProvisional: false,
      previousFolderName: "2026-05-22_10-11-12",
    });
  });

  it("keeps the provisional folder after a previous-research start-fresh answer", async () => {
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
    const model = createModel();
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
    expect(onFolderChange).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ isProvisional: false }),
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

  it("rejects promptly when aborted during previous-research lookup", async () => {
    let searchStarted!: () => void;
    const searchStartedPromise = new Promise<void>((resolve) => {
      searchStarted = resolve;
    });
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "search_research") {
        searchStarted();
        return new Promise<never>(() => {});
      }
      return Promise.resolve(undefined);
    });
    const model = createModel();
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = createTransport(vi.fn());
    const abortController = new AbortController();

    const pending = transport.sendMessages({
      trigger: "submit-message",
      chatId: "runtime-chat",
      messageId: "user-1",
      messages: [userMessage("Find earnings calls for ACME?")],
      abortSignal: abortController.signal,
    });

    await searchStartedPromise;
    abortController.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

function createTransport(
  onFolderChange: (
    folderName: string,
    options: ResearchFolderChangeOptions,
  ) => void,
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
    false,
    onFolderChange,
  );
}

function createModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: "{}" }],
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
