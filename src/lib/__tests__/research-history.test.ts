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

vi.mock("@tauri-apps/plugin-fs", () => ({
  ...fsMocks,
  BaseDirectory: {
    AppData: "AppData",
  },
}));

import { BaseDirectory } from "@tauri-apps/plugin-fs";
import {
  createResearchChatId,
  deleteResearchFolder,
  listResearchChats,
  listResearchFolders,
  readResearchChatMessages,
  renameResearchFolder,
  saveResearchChatMessages,
} from "@/lib/research-history";

describe("research history", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    fsMocks.exists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    fsMocks.readDir.mockResolvedValueOnce([
      {
        name: "2026-05-21T10-00-00.000Z.json",
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      },
      {
        name: "2026-05-22T10-00-00.000Z.json",
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      },
    ]);
    fsMocks.readTextFile
      .mockResolvedValueOnce(
        JSON.stringify({
          id: "2026-05-21T10-00-00.000Z",
          title: "Older chat",
          createdAt: "2026-05-21T10:00:00.000Z",
          updatedAt: "2026-05-21T10:30:00.000Z",
          messages,
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          id: "2026-05-22T10-00-00.000Z",
          title: "Newer chat",
          createdAt: "2026-05-22T10:00:00.000Z",
          updatedAt: "2026-05-22T10:30:00.000Z",
          messages,
        }),
      );

    await expect(listResearchChats("market-map")).resolves.toEqual([
      {
        id: "2026-05-22T10-00-00.000Z",
        title: "Newer chat",
        createdAt: "2026-05-22T10:00:00.000Z",
        updatedAt: "2026-05-22T10:30:00.000Z",
        messageCount: 2,
        legacy: false,
      },
      {
        id: "2026-05-21T10-00-00.000Z",
        title: "Older chat",
        createdAt: "2026-05-21T10:00:00.000Z",
        updatedAt: "2026-05-21T10:30:00.000Z",
        messageCount: 2,
        legacy: false,
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
      {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      },
    );
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/market-map/chats/2026-05-22T10-11-12.123Z.json",
      expect.any(String),
      {
        baseDir: BaseDirectory.AppData,
      },
    );
    expect(JSON.parse(fsMocks.writeTextFile.mock.calls[0][1])).toEqual(
      expect.objectContaining({
        id: "2026-05-22T10-11-12.123Z",
        title: "Hello",
        createdAt: "2026-05-22T10:11:12.123Z",
        messages,
      }),
    );
  });

  it("renames research folders", async () => {
    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      renameResearchFolder("market-map", "pricing-review"),
    ).resolves.toEqual({ name: "pricing-review" });

    expect(fsMocks.rename).toHaveBeenCalledWith(
      "search-results/market-map",
      "search-results/pricing-review",
      {
        oldPathBaseDir: BaseDirectory.AppData,
        newPathBaseDir: BaseDirectory.AppData,
      },
    );
  });

  it("deletes research folders", async () => {
    fsMocks.exists.mockResolvedValueOnce(true);

    await deleteResearchFolder("market-map");

    expect(fsMocks.remove).toHaveBeenCalledWith("search-results/market-map", {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
  });
});

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
