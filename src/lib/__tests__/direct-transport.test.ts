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

const researchMemoryMocks = vi.hoisted(() => ({
  mergeResearchMemoriesWithLockedCleanup: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => ({
  ...fsMocks,
  invoke: tauriMocks.invoke,
  fetch: vi.fn(),
  isTauri: vi.fn(() => false),
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

vi.mock("@/lib/research-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/research-memory")>();
  return {
    ...actual,
    mergeResearchMemoriesWithLockedCleanup:
      researchMemoryMocks.mergeResearchMemoriesWithLockedCleanup,
  };
});

vi.mock("@/lib/skills-store", () => ({
  skillsStore: {
    get: vi.fn().mockResolvedValue({ skills: [] }),
  },
}));

import {
  DirectTransport,
} from "@/lib/transport";
import { extractAndStoreMemories } from "@/lib/memory-agent";
import { setDirectEventHandler } from "@/lib/sub-agent-emitter";

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
    researchMemoryMocks.mergeResearchMemoriesWithLockedCleanup.mockImplementation(
      async (_source, _destination, cleanup) => ({
        memoriesMerged: 0,
        cleanupResult: await cleanup(),
      }),
    );
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

  it("moves the chat to an existing folder and deletes the initial folder when user chooses continue", async () => {
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
    mockResearchFolderExists("market-map");

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
    expect(fsMocks.remove).toHaveBeenCalledWith(
      "search-results/earnings-research",
      { recursive: true },
    );
    expect(onFolderChange).toHaveBeenCalledWith("market-map", {
      previousFolderName: "earnings-research",
    });
    expect(
      researchMemoryMocks.mergeResearchMemoriesWithLockedCleanup,
    ).toHaveBeenCalledWith(
      "earnings-research",
      "market-map",
      expect.any(Function),
    );
    const recursiveDeleteCall = fsMocks.remove.mock.calls.findIndex(
      ([path, options]) =>
        path === "search-results/earnings-research" &&
        (options as { recursive?: boolean } | undefined)?.recursive === true,
    );
    expect(recursiveDeleteCall).toBeGreaterThanOrEqual(0);
    expect(
      researchMemoryMocks.mergeResearchMemoriesWithLockedCleanup.mock
        .invocationCallOrder[0],
    ).toBeLessThan(fsMocks.remove.mock.invocationCallOrder[recursiveDeleteCall]);
  });

  it("preserves provisional-folder ownership across clarification before continuation", async () => {
    const model = createModel("clarified-research");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = createTransport(vi.fn());
    const original = userMessage("Research regional demand");
    const clarification = assistantClarificationAnswer("France");

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [original],
        abortSignal: undefined,
      }),
    );
    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "clarification-1",
        messages: [original, clarification],
        abortSignal: undefined,
      }),
    );

    fsMocks.exists.mockResolvedValue(true);
    mockResearchFolderExists("market-map");
    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "continue-1",
        messages: [
          original,
          clarification,
          assistantQuestionAnswer("continue:market-map"),
        ],
        abortSignal: undefined,
      }),
    );

    expect(
      researchMemoryMocks.mergeResearchMemoriesWithLockedCleanup,
    ).toHaveBeenCalledWith(
      "clarified-research",
      "market-map",
      expect.any(Function),
    );
    expect(fsMocks.remove).toHaveBeenCalledWith(
      "search-results/clarified-research",
      { recursive: true },
    );
  });

  it("completes the folder switch but retains the source folder when memory merge fails", async () => {
    const model = createModel("temporary-research");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = createTransport(onFolderChange);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Continue my market research")],
        abortSignal: undefined,
      }),
    );

    fsMocks.exists.mockResolvedValue(true);
    mockResearchFolderExists("market-map");
    researchMemoryMocks.mergeResearchMemoriesWithLockedCleanup.mockRejectedValueOnce(
      new Error("write failed"),
    );
    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "question-1",
        messages: [
          userMessage("Continue my market research"),
          assistantQuestionAnswer("continue:market-map"),
        ],
        abortSignal: undefined,
      }),
    );

    expect(onFolderChange).toHaveBeenLastCalledWith("market-map", {
      previousFolderName: "temporary-research",
    });
    expect(fsMocks.remove).not.toHaveBeenCalledWith(
      "search-results/temporary-research",
      { recursive: true },
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("The source folder was retained"),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("retains a provisional source folder that already contains research artifacts", async () => {
    const model = createModel("artifact-research");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = createTransport(vi.fn());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Research the market")],
        abortSignal: undefined,
      }),
    );

    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockImplementation(async (path: string) => {
      if (path === "search-results") return [directoryEntry("market-map")];
      if (path === "search-results/artifact-research") {
        return [fileEntry("summary.md"), directoryEntry("attachments")];
      }
      return [];
    });
    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "continue-1",
        messages: [
          userMessage("Research the market"),
          assistantQuestionAnswer("continue:market-map"),
        ],
        abortSignal: undefined,
      }),
    );

    expect(
      researchMemoryMocks.mergeResearchMemoriesWithLockedCleanup,
    ).toHaveBeenCalledWith(
      "artifact-research",
      "market-map",
      expect.any(Function),
    );
    expect(fsMocks.remove).not.toHaveBeenCalledWith(
      "search-results/artifact-research",
      { recursive: true },
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("still contains research data"),
      expect.objectContaining({
        rootFiles: ["summary.md"],
        subfolders: ["attachments"],
      }),
    );
    warn.mockRestore();
  });

  it("retains a provisional source folder that still contains another chat", async () => {
    const model = createModel("multi-chat-research");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = createTransport(vi.fn());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Research the market")],
        abortSignal: undefined,
      }),
    );

    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockImplementation(async (path: string) => {
      if (path === "search-results") return [directoryEntry("market-map")];
      if (path === "search-results/multi-chat-research/chats") {
        return [
          fileEntry("index.json"),
          fileEntry("2026-07-16T10-00-00.000Z--other-chat.json"),
        ];
      }
      return [];
    });

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "continue-1",
        messages: [
          userMessage("Research the market"),
          assistantQuestionAnswer("continue:market-map"),
        ],
        abortSignal: undefined,
      }),
    );

    expect(fsMocks.remove).not.toHaveBeenCalledWith(
      "search-results/multi-chat-research",
      { recursive: true },
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("still contains research data"),
      expect.objectContaining({
        chatFiles: ["2026-07-16T10-00-00.000Z--other-chat.json"],
      }),
    );
    warn.mockRestore();
  });

  it("keeps the provisional folder when the recalled destination was deleted", async () => {
    const model = createModel("missing-target-research");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = createTransport(onFolderChange);

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Research the market")],
        abortSignal: undefined,
      }),
    );

    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([]);
    fsMocks.writeTextFile.mockClear();
    const chunks = await collectChunks(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "continue-1",
        messages: [
          userMessage("Research the market"),
          assistantQuestionAnswer("continue:market-map"),
        ],
        abortSignal: undefined,
      }),
    );

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorText: "Research folder no longer exists: market-map",
      }),
    );
    expect(
      fsMocks.writeTextFile.mock.calls.some(([path]) =>
        path.startsWith("search-results/market-map/"),
      ),
    ).toBe(false);
    expect(
      researchMemoryMocks.mergeResearchMemoriesWithLockedCleanup,
    ).not.toHaveBeenCalled();
    expect(fsMocks.remove).not.toHaveBeenCalledWith(
      "search-results/missing-target-research",
      { recursive: true },
    );
    expect(onFolderChange).toHaveBeenCalledTimes(1);
  });

  it("recovers persisted provisional ownership after transport reconstruction", async () => {
    const model = createModel("reconstructed-research");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const originalTransport = createTransport(vi.fn());
    const original = userMessage("Research the market");

    await consumeStream(
      await originalTransport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [original],
        abortSignal: undefined,
      }),
    );
    const chatPath =
      "search-results/reconstructed-research/chats/2026-05-22T10-11-12.123Z.json";
    const initialChatWrite = fsMocks.writeTextFile.mock.calls.find(
      ([path]) => path === chatPath,
    );
    expect(initialChatWrite?.[1]).toContain('"provisional":true');

    const storedChat = String(initialChatWrite?.[1]);
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockImplementation(async (path: string) =>
      path === chatPath ? storedChat : "",
    );
    mockResearchFolderExists("market-map");
    const reconstructedTransport = new DirectTransport(
      () => ({
        provider: "openrouter",
        apiKey: "chat-key",
        model: "test-model",
      }) as never,
      () => ({}),
      "2026-05-22T10-11-12.123Z",
      "reconstructed-research",
      vi.fn(),
    );

    await consumeStream(
      await reconstructedTransport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "continue-1",
        messages: [
          original,
          assistantQuestionAnswer("continue:market-map"),
        ],
        abortSignal: undefined,
      }),
    );

    expect(
      researchMemoryMocks.mergeResearchMemoriesWithLockedCleanup,
    ).toHaveBeenCalledWith(
      "reconstructed-research",
      "market-map",
      expect.any(Function),
    );
    expect(fsMocks.remove).toHaveBeenCalledWith(
      "search-results/reconstructed-research",
      { recursive: true },
    );
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
    const currentChatWrites = fsMocks.writeTextFile.mock.calls.filter(
      ([path]) =>
        path ===
        "search-results/earnings-research/chats/2026-05-22T10-11-12.123Z.json",
    );
    expect(currentChatWrites[currentChatWrites.length - 1]?.[1]).toContain(
      '"provisional":false',
    );
  });

  it("does not switch folders when a continuation answer was backed only by memory recall", async () => {
    const model = createModel("temporary-research");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = createTransport(onFolderChange);

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [userMessage("Research the market")],
        abortSignal: undefined,
      }),
    );
    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "question-1",
        messages: [
          userMessage("Research the market"),
          assistantMemoryOnlyQuestionAnswer("continue:market-map"),
        ],
        abortSignal: undefined,
      }),
    );

    expect(
      researchMemoryMocks.mergeResearchMemoriesWithLockedCleanup,
    ).not.toHaveBeenCalled();
    expect(onFolderChange).toHaveBeenCalledTimes(1);
    expect(onFolderChange).toHaveBeenLastCalledWith("temporary-research", {});
    expect(fsMocks.remove).not.toHaveBeenCalledWith(
      "search-results/temporary-research",
      { recursive: true },
    );
  });

  it("does not replay an old continuation choice on a later user turn", async () => {
    const model = createModel("temporary-research");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = createTransport(onFolderChange);
    const original = userMessage("Research the market");
    const continuation = assistantQuestionAnswer("continue:market-map");

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-1",
        messages: [original],
        abortSignal: undefined,
      }),
    );
    fsMocks.exists.mockResolvedValue(true);
    mockResearchFolderExists("market-map");
    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "continue-1",
        messages: [original, continuation],
        abortSignal: undefined,
      }),
    );
    const callsAfterContinuation = onFolderChange.mock.calls.length;

    await consumeStream(
      await transport.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-chat",
        messageId: "user-2",
        messages: [
          original,
          continuation,
          userMessage("Now compare pricing"),
        ],
        abortSignal: undefined,
      }),
    );

    expect(onFolderChange).toHaveBeenCalledTimes(callsAfterContinuation);
    expect(
      researchMemoryMocks.mergeResearchMemoriesWithLockedCleanup,
    ).toHaveBeenCalledTimes(1);
  });

  it("opens an existing folder without renaming", async () => {
    const model = createModel("unused-name");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = new DirectTransport(
      () => ({ provider: "openrouter", apiKey: "chat-key", model: "test-model" }) as never,
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

  it("does not generate folder name when folder already set", async () => {
    const model = createModel("unused-name");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const onFolderChange = vi.fn();
    const transport = new DirectTransport(
      () => ({ provider: "openrouter", apiKey: "chat-key", model: "test-model" }) as never,
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

  it("emits sub-agent events directly without mutating the main chat stream", async () => {
    const model = createModel("acme-research");
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = createTransport(vi.fn());
    const directHandler = vi.fn();
    setDirectEventHandler("2026-05-22T10-11-12.123Z", directHandler);

    try {
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
      expect(subAgentChunks).toHaveLength(0);
      expect(directHandler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "start", name: "Folder Naming" }),
      );
      expect(directHandler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "complete" }),
      );
    } finally {
      setDirectEventHandler("2026-05-22T10-11-12.123Z", null);
    }
  });

  it("isolates folder-naming events between concurrent transports", async () => {
    const chatA = "2026-05-22T10-11-12.123Z-a";
    const chatB = "2026-05-22T10-11-12.123Z-b";
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    setDirectEventHandler(chatA, handlerA);
    setDirectEventHandler(chatB, handlerB);

    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    let markStartedA!: () => void;
    let markStartedB!: () => void;
    const startedA = new Promise<void>((resolve) => {
      markStartedA = resolve;
    });
    const startedB = new Promise<void>((resolve) => {
      markStartedB = resolve;
    });

    const createGatedModel = (
      folderName: string,
      gate: Promise<void>,
      markStarted: () => void,
    ) => {
      let streamCallCount = 0;
      return new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: "text", text: folderName }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: tokenUsage(),
          warnings: [],
        }),
        doStream: async (): Promise<LanguageModelV3StreamResult> => {
          streamCallCount++;
          if (streamCallCount === 1) {
            markStarted();
            await gate;
            return {
              stream: simulateReadableStream({ chunks: textChunks(folderName) }),
            };
          }
          return {
            stream: simulateReadableStream({ chunks: textChunks("Done.") }),
          };
        },
      });
    };

    const modelA = createGatedModel("chat-a-topic", gateA, markStartedA);
    const modelB = createGatedModel("chat-b-topic", gateB, markStartedB);
    chatProviderMocks.createChatLanguageModel.mockImplementation(
      (config: { model: string }) => config.model === "model-a" ? modelA : modelB,
    );

    const transportA = new DirectTransport(
      () => ({ provider: "openrouter", apiKey: "chat-key", model: "model-a" }) as never,
      () => ({}),
      chatA,
    );
    const transportB = new DirectTransport(
      () => ({ provider: "openrouter", apiKey: "chat-key", model: "model-b" }) as never,
      () => ({}),
      chatB,
    );

    try {
      const doneA = consumeStream(await transportA.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-a",
        messageId: "user-a",
        messages: [userMessage("Research topic A")],
        abortSignal: undefined,
      }));
      await startedA;

      const doneB = consumeStream(await transportB.sendMessages({
        trigger: "submit-message",
        chatId: "runtime-b",
        messageId: "user-b",
        messages: [userMessage("Research topic B")],
        abortSignal: undefined,
      }));
      await startedB;

      releaseA();
      await doneA;
      releaseB();
      await doneB;

      const textDeltas = (handler: typeof handlerA) => handler.mock.calls
        .map(([event]) => event)
        .filter((event) => event.type === "text-delta")
        .map((event) => event.delta);

      expect(textDeltas(handlerA)).toContain("chat-a-topic");
      expect(textDeltas(handlerA)).not.toContain("chat-b-topic");
      expect(textDeltas(handlerB)).toContain("chat-b-topic");
      expect(textDeltas(handlerB)).not.toContain("chat-a-topic");
    } finally {
      releaseA();
      releaseB();
      setDirectEventHandler(chatA, null);
      setDirectEventHandler(chatB, null);
    }
  });

  it("uses deterministic fallback when model output fails validation", async () => {
    let streamCallIndex = 0;
    const doStream = vi.fn(async (): Promise<LanguageModelV3StreamResult> => {
      streamCallIndex++;
      const text = streamCallIndex <= 3
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
    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      "search-results/acme",
      { recursive: true },
    );
    expect(fsMocks.writeTextFile).toHaveBeenCalled();
    expect(onFolderChange).toHaveBeenCalledWith("acme", {});
  });

  it("uses deterministic fallback when model returns empty output", async () => {
    let streamCallIndex = 0;
    const doStream = vi.fn(async (): Promise<LanguageModelV3StreamResult> => {
      streamCallIndex++;
      const text = streamCallIndex <= 3 ? "" : "Done.";
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
    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      "search-results/acme",
      { recursive: true },
    );
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
    expect(doStream).toHaveBeenCalled();
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

  it("emits an abort chunk without a finish when aborted during folder naming", async () => {
    const abortController = new AbortController();
    let markFolderNamingStarted!: () => void;
    const folderNamingStarted = new Promise<void>((resolve) => {
      markFolderNamingStarted = resolve;
    });
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "test" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: tokenUsage(),
        warnings: [],
      }),
      doStream: async (): Promise<LanguageModelV3StreamResult> => {
        markFolderNamingStarted();
        return new Promise<never>((_, reject) => {
          abortController.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });
    chatProviderMocks.createChatLanguageModel.mockReturnValue(model);
    const transport = createTransport(vi.fn());

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "runtime-chat",
      messageId: "user-1",
      messages: [userMessage("Find earnings calls for ACME?")],
      abortSignal: abortController.signal,
    });

    await folderNamingStarted;
    abortController.abort();
    const chunks = await collectChunks(stream);

    expect(chunksOfType(chunks, "abort")).toHaveLength(1);
    expect(chunksOfType(chunks, "finish")).toHaveLength(0);
  }, 10000);
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
    researchMemoryMocks.mergeResearchMemoriesWithLockedCleanup.mockImplementation(
      async (_source, _destination, cleanup) => ({
        memoriesMerged: 0,
        cleanupResult: await cleanup(),
      }),
    );
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

  it("uses deterministic fallback when model fails all coffee-beans naming attempts", async () => {
    let streamCallIndex = 0;
    const doStream = vi.fn(async (): Promise<LanguageModelV3StreamResult> => {
      streamCallIndex++;
      const text = streamCallIndex <= 3
        ? "invalid output with spaces and special chars plus extra filler words here more"
        : "Done.";
      return {
        stream: simulateReadableStream({ chunks: textChunks(text) }),
      };
    });
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "invalid output with spaces and special chars plus extra filler words here more" }],
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
      messages: [userMessage("I'm looking for the best coffee beans for espresso")],
      abortSignal: undefined,
    });
    const chunks = await collectChunks(stream);

    const errorChunk = chunks.find((c: unknown) => (c as any)?.type === "error");
    expect(errorChunk).toBeUndefined();
    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      "search-results/best-coffee-beans-espresso",
      { recursive: true },
    );
    expect(onFolderChange).toHaveBeenCalledWith("best-coffee-beans-espresso", {});
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

  it("emits abort without finish(stop) when aborted during model streaming", async () => {
    const abortController = new AbortController();
    const model = new MockLanguageModelV3({
      doStream: async () => {
        abortController.abort();
        return {
          stream: simulateReadableStream({ chunks: textChunks("Interrupted.") }),
        };
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
        abortSignal: abortController.signal,
      }),
    );

    expect(chunksOfType(chunks, "abort")).toHaveLength(1);
    expect(chunksOfType(chunks, "finish")).toHaveLength(0);
    expect(chunksOfType(chunks, "error")).toHaveLength(0);
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
      const text = streamCallCount <= 1 ? folderNameResponse : "Done.";
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

function mockResearchFolderExists(folderName: string) {
  fsMocks.readDir.mockImplementation(async (path: string) =>
    path === "search-results" ? [directoryEntry(folderName)] : [],
  );
}

function directoryEntry(name: string) {
  return {
    name,
    isDirectory: true,
    isFile: false,
    isSymlink: false,
  };
}

function fileEntry(name: string) {
  return {
    name,
    isDirectory: false,
    isFile: true,
    isSymlink: false,
  };
}

function assistantQuestionAnswer(answer: string): UIMessage {
  return {
    id: "assistant-question",
    role: "assistant",
    parts: [
      {
        type: "tool-search_research",
        toolCallId: "search-1",
        state: "output-available",
        input: { query: "market research" },
        output: [
          {
            result_type: "research_chat",
            folder_name: "market-map",
            chat_id: "chat-market-size",
            title: "Market map",
            matched_query: "market research",
            updated_at: null,
            score: 0.9,
            relevant_memories: [],
          },
        ],
      } as UIMessage["parts"][number],
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

function assistantClarificationAnswer(answer: string): UIMessage {
  return {
    id: "assistant-clarification",
    role: "assistant",
    parts: [
      {
        type: "tool-ask_questions",
        toolCallId: "clarification-1",
        state: "output-available",
        input: {
          questions: [
            {
              question: "Which region?",
              candidates: [
                { label: "France", value: "France" },
                { label: "Germany", value: "Germany" },
              ],
            },
          ],
        },
        output: {
          answers: [{ question: "Which region?", answer }],
        },
      } as UIMessage["parts"][number],
    ],
  };
}

function assistantMemoryOnlyQuestionAnswer(answer: string): UIMessage {
  return {
    id: "assistant-memory-question",
    role: "assistant",
    parts: [
      {
        type: "tool-search_research",
        toolCallId: "search-memory-1",
        state: "output-available",
        input: { query: "market preferences" },
        output: [
          {
            result_type: "memory",
            source_folder: "market-map",
            memory: "User prefers France-focused analysis.",
            updated_at: null,
            score: 0.9,
          },
        ],
      } as UIMessage["parts"][number],
      {
        type: "tool-ask_questions",
        toolCallId: "question-memory-1",
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

function chunksOfType(chunks: unknown[], type: string): unknown[] {
  return chunks.filter(
    (chunk) =>
      typeof chunk === "object" &&
      chunk !== null &&
      "type" in chunk &&
      (chunk as { type: string }).type === type,
  );
}
