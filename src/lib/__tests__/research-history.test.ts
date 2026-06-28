import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/tauri-bridge", () => ({
  ...fsMocks,
  ...tauriMocks,
  BaseDirectory: {
    AppData: "AppData",
  },
}));


import {
  createResearchChatId,
  deleteResearchFolder,
  listResearchChats,
  listResearchFolders,
  moveResearchChatToFolder,
  readResearchChatMessages,
  renameResearchFolder,
  saveResearchChatMessages,
} from "@/lib/research-history";

describe("research history", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tauriMocks.invoke.mockResolvedValue(undefined);
  });

  it("lists research folders from search-results", async () => {
    mockAppStorage({
      directories: {
        "search-results": [
          directoryEntry("market-map"),
          fileEntry("README.md"),
        ],
      },
    });

    await expect(listResearchFolders()).resolves.toEqual([
      { name: "market-map", updatedAt: null },
    ]);
  });

  it("lists research folders sorted by latest chat update date", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hi" }],
      },
    ];

    mockAppStorage({
      directories: {
        "search-results": [
          directoryEntry("older-topic"),
          directoryEntry("empty-topic"),
          directoryEntry("latest-topic"),
        ],
        "search-results/older-topic/chats": [
          fileEntry("2026-05-21T10-00-00.000Z.json"),
        ],
        "search-results/latest-topic/chats": [
          fileEntry("2026-05-23T10-00-00.000Z.json"),
        ],
      },
      files: {
        "search-results/older-topic/chats/2026-05-21T10-00-00.000Z.json":
          JSON.stringify({
            id: "2026-05-21T10-00-00.000Z",
            title: "Older topic",
            createdAt: "2026-05-21T10:00:00.000Z",
            updatedAt: "2026-05-21T10:30:00.000Z",
            messages,
          }),
        "search-results/latest-topic/chats/2026-05-23T10-00-00.000Z.json":
          JSON.stringify({
            id: "2026-05-23T10-00-00.000Z",
            title: "Latest topic",
            createdAt: "2026-05-23T10:00:00.000Z",
            updatedAt: "2026-05-23T10:30:00.000Z",
            messages,
          }),
      },
    });

    await expect(listResearchFolders()).resolves.toEqual([
      { name: "latest-topic", updatedAt: "2026-05-23T10:30:00.000Z" },
      { name: "older-topic", updatedAt: "2026-05-21T10:30:00.000Z" },
      { name: "empty-topic", updatedAt: null },
    ]);
  });

  it("keeps listing folders when one folder metadata read fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const directories = {
      "search-results": [
        directoryEntry("healthy-topic"),
        directoryEntry("unreadable-topic"),
      ],
      "search-results/healthy-topic/chats": [fileEntry("index.json")],
      "search-results/unreadable-topic/chats": [],
    };

    mockAppStorage({
      directories,
      files: {
        "search-results/healthy-topic/chats/index.json": JSON.stringify({
          version: 1,
          chats: [
            {
              id: "2026-05-22T10-00-00.000Z",
              title: "Healthy topic",
              createdAt: "2026-05-22T10:00:00.000Z",
              updatedAt: "2026-05-22T10:30:00.000Z",
              messageCount: 2,
            },
          ],
        }),
      },
    });
    fsMocks.readDir.mockImplementation(async (path: string) => {
      if (path === "search-results/unreadable-topic/chats") {
        throw new Error("Permission denied");
      }
      return directories[path as keyof typeof directories] ?? [];
    });

    await expect(listResearchFolders()).resolves.toEqual([
      { name: "healthy-topic", updatedAt: "2026-05-22T10:30:00.000Z" },
      { name: "unreadable-topic", updatedAt: null },
    ]);
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[research-history] Failed to read update timestamp for "unreadable-topic":',
      ),
      expect.any(Error),
    );

    consoleWarn.mockRestore();
  });

  it("lists saved research chats sorted by update date", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hi" }],
      },
    ];
    mockAppStorage({
      directories: {
        "search-results/market-map/chats": [
          fileEntry("2026-05-21T10-00-00.000Z.json"),
          fileEntry("2026-05-22T10-00-00.000Z.json"),
        ],
      },
      files: {
        "search-results/market-map/chats/2026-05-21T10-00-00.000Z.json":
          JSON.stringify({
            id: "2026-05-21T10-00-00.000Z",
            title: "Older chat",
            createdAt: "2026-05-21T10:00:00.000Z",
            updatedAt: "2026-05-21T10:30:00.000Z",
            messages,
          }),
        "search-results/market-map/chats/2026-05-22T10-00-00.000Z.json":
          JSON.stringify({
            id: "2026-05-22T10-00-00.000Z",
            title: "Newer chat",
            createdAt: "2026-05-22T10:00:00.000Z",
            updatedAt: "2026-05-22T10:30:00.000Z",
            messages,
          }),
      },
    });

    await expect(listResearchChats("market-map")).resolves.toEqual([
      {
        id: "2026-05-22T10-00-00.000Z",
        title: "Newer chat",
        createdAt: "2026-05-22T10:00:00.000Z",
        updatedAt: "2026-05-22T10:30:00.000Z",
        messageCount: 2,
      },
      {
        id: "2026-05-21T10-00-00.000Z",
        title: "Older chat",
        createdAt: "2026-05-21T10:00:00.000Z",
        updatedAt: "2026-05-21T10:30:00.000Z",
        messageCount: 2,
      },
    ]);
  });

  it("reads a saved chat transcript", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hi" }],
      },
    ];
    const chatId = "2026-05-22T10-00-00.000Z";
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce(
      JSON.stringify({
        id: chatId,
        title: "Hello",
        createdAt: "2026-05-22T10:00:00.000Z",
        updatedAt: "2026-05-22T10:30:00.000Z",
        messages,
      }),
    );

    await expect(readResearchChatMessages("market-map", chatId)).resolves.toEqual(
      messages,
    );
  });

  it("returns an empty transcript when saved chat JSON is missing or invalid", async () => {
    const chatId = "2026-05-22T10-00-00.000Z";
    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(readResearchChatMessages("market-map", chatId)).resolves.toEqual(
      [],
    );

    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce("{");

    await expect(readResearchChatMessages("market-map", chatId)).resolves.toEqual(
      [],
    );
  });

  it("continues listing chats when one file has a read error", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hi" }],
      },
    ];
    const badChatId = "2026-05-21T10-00-00.000Z";
    const goodChatId = "2026-05-22T10-00-00.000Z";
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockAppStorage({
      directories: {
        "search-results/market-map/chats": [
          fileEntry(`${badChatId}.json`),
          fileEntry(`${goodChatId}.json`),
        ],
      },
      files: {
        [`search-results/market-map/chats/${badChatId}.json`]: undefined as unknown as string,
        [`search-results/market-map/chats/${goodChatId}.json`]: JSON.stringify({
          id: goodChatId,
          title: "Good chat",
          createdAt: "2026-05-22T10:00:00.000Z",
          updatedAt: "2026-05-22T10:30:00.000Z",
          messages,
        }),
      },
    });
    fsMocks.readTextFile.mockImplementation(async (path: string) => {
      if (path.includes(badChatId)) throw new Error("Permission denied");
      if (path.includes(goodChatId)) {
        return JSON.stringify({
          id: goodChatId,
          title: "Good chat",
          createdAt: "2026-05-22T10:00:00.000Z",
          updatedAt: "2026-05-22T10:30:00.000Z",
          messages,
        });
      }
      throw new Error(`Unexpected read: ${path}`);
    });

    const chats = await listResearchChats("market-map");

    expect(chats).toHaveLength(1);
    expect(chats[0].id).toBe(goodChatId);
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to read stored chat "${badChatId}"`),
      expect.any(Error),
    );

    consoleWarn.mockRestore();
  });

  it("saves chat transcripts into a dated chat file", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    ];
    const chatId = createResearchChatId(
      new Date("2026-05-22T10:11:12.123Z"),
    );
    fsMocks.exists.mockResolvedValueOnce(false);

    await saveResearchChatMessages("market-map", chatId, messages as never);

    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      "search-results/market-map/chats",
      { recursive: true },
    );
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/market-map/chats/2026-05-22T10-11-12.123Z.json",
      expect.any(String),
    );
    const written = parseWrittenChat(fsMocks.writeTextFile.mock.calls[0][1]);
    expect(written.meta).toEqual(
      expect.objectContaining({
        id: "2026-05-22T10-11-12.123Z",
        title: "Hello",
        createdAt: "2026-05-22T10:11:12.123Z",
      }),
    );
    expect(written.messages).toEqual(messages);
  });

  it("renames research folders", async () => {
    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      renameResearchFolder("market-map", "pricing-review"),
    ).resolves.toEqual({ name: "pricing-review" });

    expect(fsMocks.rename).toHaveBeenCalledWith(
      "search-results/market-map",
      "search-results/pricing-review",
    );
  });

  it("deletes research folders", async () => {
    fsMocks.exists.mockResolvedValueOnce(true);

    await deleteResearchFolder("market-map");

    expect(fsMocks.remove).toHaveBeenCalledWith("search-results/market-map", {
      recursive: true,
    });
  });

  it("sets title to Untitled chat for empty messages", async () => {
    const chatId = "2026-05-22T10-00-00.000Z";
    fsMocks.exists.mockResolvedValueOnce(false);

    await saveResearchChatMessages("market-map", chatId, [] as never);

    const { meta } = parseWrittenChat(fsMocks.writeTextFile.mock.calls[0][1]);
    expect(meta.title).toBe("Untitled chat");
  });

  it("truncates long chat titles over 56 characters", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [
          {
            type: "text",
            text: "This is a very long message that exceeds fifty six characters and should be truncated",
          },
        ],
      },
    ];
    const chatId = "2026-05-22T10-00-00.000Z";
    fsMocks.exists.mockResolvedValueOnce(false);

    await saveResearchChatMessages("market-map", chatId, messages as never);

    const { meta } = parseWrittenChat(fsMocks.writeTextFile.mock.calls[0][1]);
    expect(meta.title?.length).toBe(56);
    expect(meta.title).toContain("...");
  });

  it("collapses multi-line messages into single line for title", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Hello\nworld\ntest",
          },
        ],
      },
    ];
    const chatId = "2026-05-22T10-00-00.000Z";
    fsMocks.exists.mockResolvedValueOnce(false);

    await saveResearchChatMessages("market-map", chatId, messages as never);

    const { meta } = parseWrittenChat(fsMocks.writeTextFile.mock.calls[0][1]);
    expect(meta.title).toBe("Hello world test");
  });

  it("derives createdAt from valid chat ID", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    ];
    const chatId = "2026-05-22T10-11-12.123Z";
    fsMocks.exists.mockResolvedValueOnce(false);

    await saveResearchChatMessages("market-map", chatId, messages as never);

    const { meta } = parseWrittenChat(fsMocks.writeTextFile.mock.calls[0][1]);
    expect(meta.createdAt).toBe("2026-05-22T10:11:12.123Z");
  });

  it("moves a research chat to a different folder", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    ];
    fsMocks.exists.mockImplementation(async (path: string) => {
      if (path === "search-results/provisional-folder/chats/2026-05-22T10-11-12.123Z.json") return true;
      if (path === "search-results/provisional-folder") return true;
      return false;
    });

    await moveResearchChatToFolder({
      fromFolderName: "provisional-folder",
      toFolderName: "final-folder",
      chatId: "2026-05-22T10-11-12.123Z",
      messages: messages as never,
    });

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/final-folder/chats/2026-05-22T10-11-12.123Z.json",
      expect.any(String),
    );

    expect(fsMocks.remove).toHaveBeenCalledWith(
      "search-results/provisional-folder/chats/2026-05-22T10-11-12.123Z.json",
    );

    expect(fsMocks.remove).not.toHaveBeenCalledWith(
      "search-results/provisional-folder",
      { recursive: true },
    );
  });

  it("moving a research chat to the same folder just saves without deleting", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    ];

    await moveResearchChatToFolder({
      fromFolderName: "market-map",
      toFolderName: "market-map",
      chatId: "2026-05-22T10-11-12.123Z",
      messages: messages as never,
    });

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/market-map/chats/2026-05-22T10-11-12.123Z.json",
      expect.any(String),
    );

    expect(fsMocks.remove).not.toHaveBeenCalled();
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });

  it("deletes only the moved chat file from the source folder, not the folder itself", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    ];
    const chatId = "2026-05-22T10-11-12.123Z";
    fsMocks.exists.mockImplementation(async (path: string) => {
      if (path === `search-results/source-folder/chats/${chatId}.json`) return true;
      if (path === "search-results/source-folder") return true;
      return false;
    });

    await moveResearchChatToFolder({
      fromFolderName: "source-folder",
      toFolderName: "dest-folder",
      chatId,
      messages: messages as never,
    });

    expect(fsMocks.remove).toHaveBeenCalledWith(
      `search-results/source-folder/chats/${chatId}.json`,
    );

    expect(fsMocks.remove).not.toHaveBeenCalledWith(
      "search-results/source-folder",
      { recursive: true },
    );
  });

  it("throws and rolls back destination when source deletion fails during move", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    ];
    const chatId = "2026-05-22T10-11-12.123Z";
    fsMocks.exists.mockImplementation(async (path: string) => {
      if (path === `search-results/source-folder/chats/${chatId}.json`) return true;
      if (path === `search-results/dest-folder/chats/${chatId}.json`) return true;
      if (path === "search-results/source-folder") return true;
      return false;
    });
    fsMocks.remove.mockImplementation(async (path: string) => {
      if (path === `search-results/source-folder/chats/${chatId}.json`) {
        throw new Error("Permission denied");
      }
    });

    await expect(
      moveResearchChatToFolder({
        fromFolderName: "source-folder",
        toFolderName: "dest-folder",
        chatId,
        messages: messages as never,
      }),
    ).rejects.toThrow("source deletion failed");

    expect(fsMocks.remove).toHaveBeenCalledWith(
      `search-results/dest-folder/chats/${chatId}.json`,
    );
  });

  it("rolls back destination chat INDEX (not just the file) when source deletion fails", async () => {
    // Regression: previously the rollback deleted the destination chat FILE
    // but left the destination chat INDEX pointing at it. listResearchChats
    // would then return a ghost entry whose readResearchChatMessages is empty.
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    ];
    const chatId = "2026-05-22T10-11-12.123Z";
    const sourceChatPath = `search-results/source-folder/chats/${chatId}.json`;
    const files: Record<string, string> = {
      [sourceChatPath]:
        JSON.stringify({ _meta: 1, id: chatId, title: "Original", createdAt: "2026-05-22T10:11:12.123Z", updatedAt: "2026-05-22T10:11:12.123Z", count: 1 }) +
        "\n" +
        JSON.stringify({ id: "user-1", role: "user", parts: [{ type: "text", text: "Hello" }] }) +
        "\n",
    };
    const dirs = new Set<string>([
      "search-results",
      "search-results/source-folder",
      "search-results/source-folder/chats",
      "search-results/dest-folder",
      "search-results/dest-folder/chats",
    ]);

    fsMocks.exists.mockImplementation(async (path: string) => dirs.has(path) || path in files);
    fsMocks.readDir.mockImplementation(async (path: string) => {
      const prefix = `${path}/`;
      const seen = new Set<string>();
      const entries: Array<Record<string, unknown>> = [];
      for (const dir of dirs) {
        if (!dir.startsWith(prefix)) continue;
        const name = dir.slice(prefix.length).split("/")[0];
        if (name && !seen.has(name)) {
          seen.add(name);
          entries.push({ name, isDirectory: true, isFile: false });
        }
      }
      for (const filePath of Object.keys(files)) {
        if (!filePath.startsWith(prefix)) continue;
        const name = filePath.slice(prefix.length).split("/")[0];
        if (name && !seen.has(name)) {
          seen.add(name);
          entries.push({ name, isDirectory: false, isFile: true });
        }
      }
      return entries;
    });
    fsMocks.readTextFile.mockImplementation(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`Missing mocked file: ${path}`);
      return content;
    });
    fsMocks.writeTextFile.mockImplementation(async (path: string, content: string) => {
      files[path] = content;
    });
    fsMocks.mkdir.mockImplementation(async (path: string) => {
      dirs.add(path);
    });
    fsMocks.remove.mockImplementation(async (path: string) => {
      if (path === `search-results/source-folder/chats/${chatId}.json`) {
        throw new Error("Permission denied");
      }
      delete files[path];
    });

    await expect(
      moveResearchChatToFolder({
        fromFolderName: "source-folder",
        toFolderName: "dest-folder",
        chatId,
        messages: messages as never,
      }),
    ).rejects.toThrow("source deletion failed");

    // The destination must NOT advertise the moved chat — neither via the
    // index nor via a stray chat file.
    const destChats = await listResearchChats("dest-folder");
    expect(destChats.find((c) => c.id === chatId)).toBeUndefined();
  });

  it("saveResearchChatMessages writes the legacy chat transcript at chat.json and indexes it as legacy", async () => {
    // Regression: the LEGACY_CHAT_TRANSCRIPT_ID branch of
    // saveResearchChatMessages had zero coverage. It writes the chat as a
    // single JSON array at search-results/<folder>/chat.json (NOT in chats/)
    // and upserts a summary with legacy: true and null timestamps. A bug in
    // either step silently breaks migration of pre-existing v0 chats.
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    ];
    const writtenFiles: Record<string, string> = {};
    const writtenDirs = new Set<string>(["search-results/legacy-folder"]);

    fsMocks.exists.mockImplementation(async (path: string) =>
      writtenDirs.has(path) || path in writtenFiles,
    );
    fsMocks.readDir.mockImplementation(async (path: string) => {
      const prefix = `${path}/`;
      const seen = new Set<string>();
      const entries: Array<Record<string, unknown>> = [];
      for (const dir of writtenDirs) {
        if (!dir.startsWith(prefix)) continue;
        const name = dir.slice(prefix.length).split("/")[0];
        if (name && !seen.has(name)) {
          seen.add(name);
          entries.push({ name, isDirectory: true, isFile: false });
        }
      }
      for (const filePath of Object.keys(writtenFiles)) {
        if (!filePath.startsWith(prefix)) continue;
        const name = filePath.slice(prefix.length).split("/")[0];
        if (name && !seen.has(name)) {
          seen.add(name);
          entries.push({ name, isDirectory: false, isFile: true });
        }
      }
      return entries;
    });
    fsMocks.readTextFile.mockImplementation(async (path: string) => {
      const content = writtenFiles[path];
      if (content === undefined) throw new Error(`Missing mocked file: ${path}`);
      return content;
    });
    fsMocks.writeTextFile.mockImplementation(async (path: string, content: string) => {
      writtenFiles[path] = content;
    });
    fsMocks.mkdir.mockImplementation(async (path: string) => {
      writtenDirs.add(path);
    });

    await saveResearchChatMessages(
      "legacy-folder",
      "legacy-chat",
      messages as never,
    );

    // 1. Transcript written to the legacy path (folder root, not chats/).
    expect(
      writtenFiles["search-results/legacy-folder/chat.json"],
    ).toBeDefined();
    // 2. No per-chat transcript file is written under chats/.
    expect(
      Object.keys(writtenFiles).some((p) =>
        p.startsWith("search-results/legacy-folder/chats/") &&
        !p.endsWith("index.json"),
      ),
    ).toBe(false);

    // 3. The chat appears in listResearchChats flagged as legacy.
    const chats = await listResearchChats("legacy-folder");
    const legacy = chats.find((c) => c.id === "legacy-chat");
    expect(legacy).toBeDefined();
    expect(legacy?.legacy).toBe(true);
    expect(legacy?.messageCount).toBe(1);

    // 4. The transcript is readable via the same id.
    const readBack = await readResearchChatMessages(
      "legacy-folder",
      "legacy-chat",
    );
    expect(readBack).toHaveLength(1);
    expect((readBack[0] as { parts: Array<{ text?: string }> }).parts[0]?.text).toBe("Hello");
  });
});

interface WrittenChatMeta {
  title?: string;
  createdAt?: string;
  id?: string;
  [key: string]: unknown;
}

function parseWrittenChat(
  content: string,
): { meta: WrittenChatMeta; messages: unknown[] } {
  const lines = content.trim().split("\n");
  const meta = JSON.parse(lines[0]) as WrittenChatMeta;
  const messages = lines.slice(1).filter(Boolean).map((l) => JSON.parse(l));
  return { meta, messages };
}

function mockAppStorage({
  directories = {},
  files = {},
}: {
  directories?: Record<string, Array<Record<string, unknown>>>;
  files?: Record<string, string>;
}) {
  fsMocks.exists.mockImplementation(async (path: string) => {
    return path in directories || path in files;
  });
  fsMocks.readDir.mockImplementation(async (path: string) => {
    return directories[path] ?? [];
  });
  fsMocks.readTextFile.mockImplementation(async (path: string) => {
    const content = files[path];
    if (content === undefined) {
      throw new Error(`Missing mocked file: ${path}`);
    }
    return content;
  });
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

describe("chat history metadata index", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tauriMocks.invoke.mockResolvedValue(undefined);
  });
  const folderName = "perf-test";
  const chatId = "2026-06-08T10-00-00.000Z";

  function generateLargeConversation({
    researchSteps = 30,
    avgToolResultsPerStep = 6,
    avgExtractChars = 8000,
  } = {}) {
    const messages: Array<Record<string, unknown>> = [];
    let msgIndex = 0;

    for (let step = 0; step < researchSteps; step++) {
      const stepLetter = String.fromCharCode(97 + (step % 26));

      messages.push({
        id: `user-${++msgIndex}`,
        role: "user",
        parts: [
          { type: "text", text: `Find information about topic ${stepLetter} for my research on AI infrastructure step ${step + 1}.` },
        ],
      });

      messages.push({
        id: `assistant-tool-${++msgIndex}`,
        role: "assistant",
        parts: [
          ...Array.from({ length: 3 }, (_, i) => ({
            type: "tool-call",
            toolCallId: `call-${step}-${i}`,
            toolName: i === 0 ? "web_search" : i === 1 ? "extract_page_content" : "search_research",
            args: { query: `research topic ${stepLetter} part ${i}` },
          })),
        ],
      });

      for (let t = 0; t < avgToolResultsPerStep; t++) {
        const isExtract = t % 3 === 0;
        const resultText = isExtract
          ? "Extracted page content:\n\n" + "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(avgExtractChars / 56)
          : `Search result ${t + 1} for topic ${stepLetter}: found relevant data with key insights about ${stepLetter}-related technologies. `.repeat(30);

        messages.push({
          id: `tool-result-${++msgIndex}`,
          role: "user",
          parts: [
            {
              type: "tool-result",
              toolCallId: `call-${step}-${t % 3}`,
              toolName: t % 3 === 0 ? "web_search" : t % 3 === 1 ? "extract_page_content" : "search_research",
              result: isExtract ? { success: true, content: resultText, url: `https://example.com/page-${step}-${t}` } : { success: true, results: [{ title: `Result ${t}`, url: `https://example.com/${step}-${t}` }] },
            },
          ],
        });
      }

      messages.push({
        id: `assistant-${++msgIndex}`,
        role: "assistant",
        parts: [
          { type: "text", text: `Based on the research for topic ${stepLetter}, here's what I found. `.repeat(20) },
        ],
      });
    }

    return messages;
  }

  function serializedForm(
    messages: Array<Record<string, unknown>>,
    overrides: Record<string, unknown> = {},
  ) {
    return JSON.stringify({
      id: chatId,
      title: "Large performance test conversation",
      createdAt: "2026-06-08T10:00:00.000Z",
      updatedAt: "2026-06-08T11:00:00.000Z",
      messages,
      ...overrides,
    });
  }

  function serializedIndex(chats: Array<Record<string, unknown>>) {
    return JSON.stringify({ version: 1, chats });
  }

  it("lists chats from the metadata index without reading transcripts", async () => {
    const messages = generateLargeConversation({ researchSteps: 30 });
    const json = serializedForm(messages);
    const index = serializedIndex([
      {
        id: chatId,
        title: "Large performance test conversation",
        createdAt: "2026-06-08T10:00:00.000Z",
        updatedAt: "2026-06-08T11:00:00.000Z",
        messageCount: messages.length,
      },
    ]);

    mockAppStorage({
      directories: {
        [`search-results/${folderName}`]: [directoryEntry("chats")],
        [`search-results/${folderName}/chats`]: [
          fileEntry("index.json"),
          fileEntry(`${chatId}.json`),
        ],
      },
      files: {
        [`search-results/${folderName}/chats/index.json`]: index,
        [`search-results/${folderName}/chats/${chatId}.json`]: json,
      },
    });

    await expect(listResearchChats(folderName)).resolves.toEqual([
      {
        id: chatId,
        title: "Large performance test conversation",
        createdAt: "2026-06-08T10:00:00.000Z",
        updatedAt: "2026-06-08T11:00:00.000Z",
        messageCount: messages.length,
      },
    ]);

    expect(fsMocks.readTextFile).toHaveBeenCalledWith(
      `search-results/${folderName}/chats/index.json`,
    );
    expect(fsMocks.readTextFile).not.toHaveBeenCalledWith(
      `search-results/${folderName}/chats/${chatId}.json`,
    );
  });

  it("rebuilds and writes the metadata index for transcript-only folders", async () => {
    const messages = generateLargeConversation({ researchSteps: 3 });
    const olderChatId = "2026-06-07T10-00-00.000Z";
    const dirs: Record<string, Array<Record<string, unknown>>> = {
      [`search-results/${folderName}`]: [directoryEntry("chats")],
      [`search-results/${folderName}/chats`]: [
        fileEntry(`${olderChatId}.json`),
        fileEntry(`${chatId}.json`),
      ],
    };
    const files: Record<string, string> = {
      [`search-results/${folderName}/chats/${olderChatId}.json`]:
        serializedForm(messages, {
          id: olderChatId,
          title: "Older chat",
          createdAt: "2026-06-07T10:00:00.000Z",
          updatedAt: "2026-06-07T11:00:00.000Z",
        }),
      [`search-results/${folderName}/chats/${chatId}.json`]: serializedForm(
        messages,
        { title: "Newer chat" },
      ),
    };

    mockAppStorage({ directories: dirs, files });

    const result = await listResearchChats(folderName);

    expect(result.map((chat) => chat.title)).toEqual([
      "Newer chat",
      "Older chat",
    ]);

    const indexWrite = fsMocks.writeTextFile.mock.calls.find(
      ([path]) => path === `search-results/${folderName}/chats/index.json`,
    );
    expect(indexWrite).toBeDefined();
    expect(JSON.parse(indexWrite?.[1] as string)).toEqual({
      version: 1,
      chats: [
        {
          id: chatId,
          title: "Newer chat",
          createdAt: "2026-06-08T10:00:00.000Z",
          updatedAt: "2026-06-08T11:00:00.000Z",
          messageCount: messages.length,
        },
        {
          id: olderChatId,
          title: "Older chat",
          createdAt: "2026-06-07T10:00:00.000Z",
          updatedAt: "2026-06-07T11:00:00.000Z",
          messageCount: messages.length,
        },
      ],
    });
  });

  it("reads only the selected transcript after resolving the latest chat from the index", async () => {
    const messages = generateLargeConversation({ researchSteps: 2 });

    mockAppStorage({
      directories: {
        [`search-results/${folderName}`]: [directoryEntry("chats")],
        [`search-results/${folderName}/chats`]: [
          fileEntry("index.json"),
          fileEntry(`${chatId}.json`),
        ],
      },
      files: {
        [`search-results/${folderName}/chats/index.json`]: serializedIndex([
          {
            id: chatId,
            title: "Latest chat",
            createdAt: "2026-06-08T10:00:00.000Z",
            updatedAt: "2026-06-08T11:00:00.000Z",
            messageCount: messages.length,
          },
        ]),
        [`search-results/${folderName}/chats/${chatId}.json`]:
          serializedForm(messages),
      },
    });

    await expect(readResearchChatMessages(folderName)).resolves.toEqual(
      messages,
    );
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(
      `search-results/${folderName}/chats/index.json`,
    );
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(
      `search-results/${folderName}/chats/${chatId}.json`,
    );
  });

  it("listResearchFolders reads the chat index fast path without scanning transcripts", async () => {
    // Regression: listResearchFolders used to call listResearchChats per
    // folder (full Zod parse + normalize + sort) just to read the latest
    // chat's updatedAt. The optimized getResearchFolderUpdatedAt reads the
    // raw index JSON and scans for max(updatedAt) in a single pass.
    const olderChatId = "2026-06-07T10-00-00.000Z";
    const latestChatId = "2026-06-08T10-00-00.000Z";

    mockAppStorage({
      directories: {
        "search-results": [
          directoryEntry(folderName),
          directoryEntry("empty-folder"),
        ],
        [`search-results/${folderName}`]: [directoryEntry("chats")],
        [`search-results/${folderName}/chats`]: [
          fileEntry("index.json"),
          fileEntry(`${olderChatId}.json`),
          fileEntry(`${latestChatId}.json`),
        ],
        "search-results/empty-folder": [directoryEntry("chats")],
        "search-results/empty-folder/chats": [
          fileEntry("index.json"),
        ],
      },
      files: {
        [`search-results/${folderName}/chats/index.json`]: serializedIndex([
          {
            id: olderChatId,
            title: "Older",
            createdAt: "2026-06-07T10:00:00.000Z",
            updatedAt: "2026-06-07T11:00:00.000Z",
            messageCount: 4,
          },
          {
            id: latestChatId,
            title: "Latest",
            createdAt: "2026-06-08T10:00:00.000Z",
            updatedAt: "2026-06-08T11:00:00.000Z",
            messageCount: 4,
          },
        ]),
        [`search-results/${folderName}/chats/${olderChatId}.json`]:
          serializedForm(generateLargeConversation({ researchSteps: 2 }), {
            id: olderChatId,
            title: "Older",
          }),
        [`search-results/${folderName}/chats/${latestChatId}.json`]:
          serializedForm(generateLargeConversation({ researchSteps: 2 }), {
            id: latestChatId,
            title: "Latest",
          }),
        // Empty folder: index exists with no chat entries.
        "search-results/empty-folder/chats/index.json":
          JSON.stringify({ version: 1, chats: [] }),
      },
    });

    const folders = await listResearchFolders();

    expect(folders).toEqual([
      {
        name: folderName,
        updatedAt: "2026-06-08T11:00:00.000Z",
      },
      {
        name: "empty-folder",
        updatedAt: null,
      },
    ]);

    // Fast-path proof: the index file was read once per folder, and the
    // transcript files were NOT opened (the old path scanned them via
    // listResearchChats only when no index was present; with an index, the
    // old path still Zod-parsed + sorted every entry, but never opened
    // transcripts either — so this assertion guards against regressions
    // that drop the index fast path entirely).
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(
      `search-results/${folderName}/chats/index.json`,
    );
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(
      "search-results/empty-folder/chats/index.json",
    );
    expect(fsMocks.readTextFile).not.toHaveBeenCalledWith(
      `search-results/${folderName}/chats/${olderChatId}.json`,
    );
    expect(fsMocks.readTextFile).not.toHaveBeenCalledWith(
      `search-results/${folderName}/chats/${latestChatId}.json`,
    );
  });

  it("listResearchFolders falls back to listResearchChats when the index is corrupt", async () => {
    // Correctness invariant: a corrupt or wrong-version index must not
    // change folder sort order. The fast path falls through to the full
    // listResearchChats() scan when tryParseJson or version check fails.
    const messages = generateLargeConversation({ researchSteps: 1 });

    mockAppStorage({
      directories: {
        "search-results": [directoryEntry(folderName)],
        [`search-results/${folderName}`]: [directoryEntry("chats")],
        [`search-results/${folderName}/chats`]: [
          fileEntry("index.json"),
          fileEntry(`${chatId}.json`),
        ],
      },
      files: {
        // Garbage in index.json — fast path must reject and fall back.
        [`search-results/${folderName}/chats/index.json`]:
          "this is not json {",
        [`search-results/${folderName}/chats/${chatId}.json`]:
          serializedForm(messages),
      },
    });

    const folders = await listResearchFolders();
    expect(folders).toEqual([
      {
        name: folderName,
        updatedAt: "2026-06-08T11:00:00.000Z",
      },
    ]);
  });
});

describe("saveResearchChatMessages error propagation", () => {
  const folderName = "test-folder";
  const chatId = "2026-06-10T10-00-00.000Z";
  const messages = [
    {
      id: "user-1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Hello" }],
    },
  ];

  function validIndexJson(chats: Array<Record<string, unknown>>) {
    return JSON.stringify({ version: 1, chats });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    tauriMocks.invoke.mockResolvedValue(undefined);
  });

  it("rejects when upsertResearchChatSummary fails via index write failure", async () => {
    fsMocks.exists.mockImplementation(async (path: string) => {
      return path === `search-results/${folderName}/chats/index.json`;
    });
    fsMocks.readTextFile.mockImplementation(async (path: string) => {
      if (path === `search-results/${folderName}/chats/index.json`) {
        return validIndexJson([]);
      }
      throw new Error(`Unexpected read: ${path}`);
    });

    let writeCount = 0;
    fsMocks.writeTextFile.mockImplementation(async () => {
      writeCount++;
      if (writeCount === 1) return;
      throw new Error("disk full");
    });

    await expect(
      saveResearchChatMessages(folderName, chatId, messages as never),
    ).rejects.toThrow("disk full");

    expect(writeCount).toBe(2);
  });

  it("returns chats from rebuild when writeResearchChatIndex fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    fsMocks.exists.mockImplementation(async (path: string) => {
      if (path === `search-results/${folderName}/chats/index.json`) return false;
      if (path === `search-results/${folderName}/chats/${chatId}.json`) return true;
      if (
        path === `search-results/${folderName}` ||
        path === `search-results/${folderName}/chats`
      )
        return true;
      return false;
    });
    fsMocks.readDir.mockImplementation(async (path: string) => {
      if (path === `search-results/${folderName}`) {
        return [directoryEntry("chats")];
      }
      if (path === `search-results/${folderName}/chats`) {
        return [fileEntry(`${chatId}.json`)];
      }
      return [];
    });
    fsMocks.readTextFile.mockImplementation(async (path: string) => {
      if (path === `search-results/${folderName}/chats/${chatId}.json`) {
        return JSON.stringify({
          id: chatId,
          title: "Recovered chat",
          createdAt: "2026-06-10T10:00:00.000Z",
          updatedAt: "2026-06-10T11:00:00.000Z",
          messages,
        });
      }
      throw new Error(`Unexpected read: ${path}`);
    });
    fsMocks.writeTextFile.mockRejectedValue(new Error("index write failed"));

    const result = await listResearchChats(folderName);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Recovered chat");
    expect(fsMocks.writeTextFile).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        `[research-history] Failed to write chat index for "${folderName}" after rebuild:`,
      ),
      expect.any(Error),
    );

    consoleError.mockRestore();
  });
});

describe("upsertResearchChatSummary serialization", () => {
  const folderName = "concurrency-test";

  beforeEach(() => {
    vi.resetAllMocks();
    tauriMocks.invoke.mockResolvedValue(undefined);
  });

  it("concurrent saves to the same folder do not lose entries", async () => {
    const chatIdA = "2026-06-12T10-00-00.000Z";
    const chatIdB = "2026-06-12T11-00-00.000Z";
    const messagesA = [
      { id: "1", role: "user" as const, parts: [{ type: "text" as const, text: "Chat A" }] },
    ];
    const messagesB = [
      { id: "2", role: "user" as const, parts: [{ type: "text" as const, text: "Chat B" }] },
    ];

    let indexContent: string | null = null;

    fsMocks.exists.mockImplementation(async (path: string) => {
      if (path === `search-results/${folderName}/chats/index.json`) return indexContent !== null;
      if (path.includes(`search-results/${folderName}/chats/${chatIdA}.json`)) return true;
      if (path.includes(`search-results/${folderName}/chats/${chatIdB}.json`)) return true;
      if (path === `search-results/${folderName}` || path === `search-results/${folderName}/chats`) return true;
      return false;
    });

    fsMocks.readDir.mockImplementation(async (path: string) => {
      if (path === `search-results/${folderName}/chats`) {
        return [fileEntry(`${chatIdA}.json`), fileEntry(`${chatIdB}.json`)];
      }
      if (path === `search-results/${folderName}`) {
        return [directoryEntry("chats")];
      }
      return [];
    });

    fsMocks.readTextFile.mockImplementation(async (path: string) => {
      if (path === `search-results/${folderName}/chats/index.json` && indexContent) {
        return indexContent;
      }
      if (path === `search-results/${folderName}/chats/${chatIdA}.json`) {
        return JSON.stringify({
          id: chatIdA, title: "Chat A",
          createdAt: "2026-06-12T10:00:00.000Z", updatedAt: "2026-06-12T10:00:00.000Z",
          messages: messagesA,
        });
      }
      if (path === `search-results/${folderName}/chats/${chatIdB}.json`) {
        return JSON.stringify({
          id: chatIdB, title: "Chat B",
          createdAt: "2026-06-12T11:00:00.000Z", updatedAt: "2026-06-12T11:00:00.000Z",
          messages: messagesB,
        });
      }
      return "";
    });

    fsMocks.writeTextFile.mockImplementation(async (_path: string, content: string) => {
      if (typeof content === "string" && content.includes('"version"')) {
        indexContent = content;
      }
    });

    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.remove.mockResolvedValue(undefined);

    await Promise.all([
      saveResearchChatMessages(folderName, chatIdA, messagesA as never),
      saveResearchChatMessages(folderName, chatIdB, messagesB as never),
    ]);

    const parsed = JSON.parse(indexContent!);
    const chatIds = parsed.chats.map((c: { id: string }) => c.id);
    expect(chatIds).toContain(chatIdA);
    expect(chatIds).toContain(chatIdB);
  });
});

describe("listResearchChats index write serialization", () => {
  const folderName = "index-serialization-test";
  const chatIdA = "2026-06-14T10-00-00.000Z";
  const chatIdB = "2026-06-14T11-00-00.000Z";

  beforeEach(() => {
    vi.resetAllMocks();
    tauriMocks.invoke.mockResolvedValue(undefined);
  });

  it("does not overwrite index created by concurrent upsertResearchChatSummary", async () => {
    const messagesA = [
      { id: "1", role: "user" as const, parts: [{ type: "text" as const, text: "Chat A" }] },
    ];

    let indexContent: string | null = null;

    fsMocks.exists.mockImplementation(async (path: string) => {
      if (path === `search-results/${folderName}/chats/index.json`) return indexContent !== null;
      if (path.includes(`search-results/${folderName}/chats/${chatIdA}.json`)) return true;
      if (path.includes(`search-results/${folderName}/chats/${chatIdB}.json`)) return true;
      if (path === `search-results/${folderName}` || path === `search-results/${folderName}/chats`) return true;
      return false;
    });

    fsMocks.readDir.mockImplementation(async (path: string) => {
      if (path === `search-results/${folderName}/chats`) {
        return [fileEntry(`${chatIdA}.json`), fileEntry(`${chatIdB}.json`)];
      }
      if (path === `search-results/${folderName}`) {
        return [directoryEntry("chats")];
      }
      return [];
    });

    fsMocks.readTextFile.mockImplementation(async (path: string) => {
      if (path === `search-results/${folderName}/chats/index.json` && indexContent) {
        return indexContent;
      }
      if (path === `search-results/${folderName}/chats/${chatIdA}.json`) {
        return JSON.stringify({
          id: chatIdA, title: "Chat A",
          createdAt: "2026-06-14T10:00:00.000Z", updatedAt: "2026-06-14T10:00:00.000Z",
          messages: messagesA,
        });
      }
      if (path === `search-results/${folderName}/chats/${chatIdB}.json`) {
        return JSON.stringify({
          id: chatIdB, title: "Chat B",
          createdAt: "2026-06-14T11:00:00.000Z", updatedAt: "2026-06-14T11:00:00.000Z",
          messages: messagesA,
        });
      }
      return "";
    });

    const writeCalls: string[] = [];
    fsMocks.writeTextFile.mockImplementation(async (_path: string, content: string) => {
      if (typeof content === "string" && content.includes('"version"')) {
        indexContent = content;
        writeCalls.push(content);
      }
    });

    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.remove.mockResolvedValue(undefined);

    const messagesB = [
      { id: "2", role: "user" as const, parts: [{ type: "text" as const, text: "Chat B save" }] },
    ];

    await Promise.all([
      listResearchChats(folderName),
      saveResearchChatMessages(folderName, chatIdB, messagesB as never),
    ]);

    expect(indexContent).not.toBeNull();
    const parsed = JSON.parse(indexContent!);
    const chatIds = parsed.chats.map((c: { id: string }) => c.id);
    expect(chatIds).toContain(chatIdA);
    expect(chatIds).toContain(chatIdB);
  });
});

describe("incremental JSONL chat persistence", () => {
  let files: Map<string, string>;
  let allWrites: { path: string; content: string; append: boolean }[];

  beforeEach(() => {
    vi.resetAllMocks();
    tauriMocks.invoke.mockResolvedValue(undefined);
    files = new Map();
    allWrites = [];
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.remove.mockResolvedValue(undefined);
    fsMocks.readDir.mockResolvedValue([]);
    fsMocks.exists.mockImplementation(async (path: string) => files.has(path));
    fsMocks.readTextFile.mockImplementation(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`Missing mocked file: ${path}`);
      return content;
    });
    fsMocks.writeTextFile.mockImplementation(
      async (path: string, content: string, opts?: { append?: boolean }) => {
        const append = opts?.append === true;
        allWrites.push({ path, content, append });
        files.set(path, append ? (files.get(path) ?? "") + content : content);
      },
    );
  });

  const msg = (id: string, text: string) => ({
    id,
    role: id.startsWith("a") ? ("assistant" as const) : ("user" as const),
    parts: [{ type: "text", text }],
  });
  const ids = (arr: { id: string }[]) => arr.map((m) => m.id);
  const chatPath = (chatId: string) =>
    `search-results/folder/chats/${chatId}.json`;
  const chatOps = (chatId: string) => ({
    rewrites: allWrites.filter(
      (w) => w.path === chatPath(chatId) && !w.append,
    ),
    appends: allWrites.filter(
      (w) => w.path === chatPath(chatId) && w.append,
    ),
  });

  it("appends only new messages on subsequent saves", async () => {
    const chatId = "2026-05-22T10-11-12.123Z";
    await saveResearchChatMessages("folder", chatId, [
      msg("u1", "hello"),
      msg("a1", "hi"),
    ] as never);
    expect(chatOps(chatId).rewrites).toHaveLength(1);
    expect(chatOps(chatId).appends).toHaveLength(0);

    await saveResearchChatMessages("folder", chatId, [
      msg("u1", "hello"),
      msg("a1", "hi"),
      msg("u2", "second"),
      msg("a2", "answer"),
    ] as never);

    expect(chatOps(chatId).rewrites).toHaveLength(1);
    expect(chatOps(chatId).appends).toHaveLength(1);
    expect(chatOps(chatId).appends[0].content).toContain('"u2"');
    expect(chatOps(chatId).appends[0].content).toContain('"a2"');
    expect(chatOps(chatId).appends[0].content).not.toContain('"u1"');

    const read = await readResearchChatMessages("folder", chatId);
    expect(ids(read)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("rewrites fully when message prefix diverges", async () => {
    const chatId = "2026-05-22T10-11-12.123Z";
    await saveResearchChatMessages("folder", chatId, [
      msg("u1", "a"),
      msg("a1", "b"),
    ] as never);

    await saveResearchChatMessages("folder", chatId, [
      msg("u1-new", "x"),
      msg("a1", "b"),
    ] as never);

    expect(chatOps(chatId).rewrites).toHaveLength(2);
    expect(chatOps(chatId).appends).toHaveLength(0);

    const read = await readResearchChatMessages("folder", chatId);
    expect(ids(read)).toEqual(["u1-new", "a1"]);
  });

  it("reads back legacy single-object JSON format", async () => {
    const chatId = "2026-05-22T10-11-12.123Z";
    files.set(
      chatPath(chatId),
      JSON.stringify({
        id: chatId,
        title: "Legacy",
        createdAt: "2026-05-22T10:11:12.123Z",
        updatedAt: "2026-05-22T10:12:00.000Z",
        messages: [msg("u1", "legacy q"), msg("a1", "legacy a")],
      }),
    );

    const read = await readResearchChatMessages("folder", chatId);
    expect(ids(read)).toEqual(["u1", "a1"]);
  });

  it("migrates legacy format to JSONL then appends on subsequent saves", async () => {
    const chatId = "2026-05-22T10-11-12.123Z";
    files.set(
      chatPath(chatId),
      JSON.stringify({
        id: chatId,
        title: "Legacy",
        createdAt: "2026-05-22T10:11:12.123Z",
        updatedAt: "2026-05-22T10:12:00.000Z",
        messages: [msg("u1", "old")],
      }),
    );

    await saveResearchChatMessages("folder", chatId, [
      msg("u1", "old"),
      msg("a1", "new"),
    ] as never);

    expect(chatOps(chatId).rewrites).toHaveLength(1);
    expect(chatOps(chatId).appends).toHaveLength(0);

    await saveResearchChatMessages("folder", chatId, [
      msg("u1", "old"),
      msg("a1", "new"),
      msg("u2", "more"),
    ] as never);

    expect(chatOps(chatId).rewrites).toHaveLength(1);
    expect(chatOps(chatId).appends).toHaveLength(1);
    expect(chatOps(chatId).appends[0].content).toContain('"u2"');

    const read = await readResearchChatMessages("folder", chatId);
    expect(ids(read)).toEqual(["u1", "a1", "u2"]);
  });
});
