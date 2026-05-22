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
  deleteResearchFolder,
  listResearchFolders,
  readResearchChatMessages,
  renameResearchFolder,
  saveResearchChatMessages,
} from "@/lib/research-history";

describe("research history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists research folders from search-results", async () => {
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readDir.mockResolvedValueOnce([
      {
        name: "market-map",
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      },
      {
        name: "README.md",
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      },
    ]);

    await expect(listResearchFolders()).resolves.toEqual([
      { name: "market-map" },
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
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce(JSON.stringify(messages));

    await expect(readResearchChatMessages("market-map")).resolves.toEqual(
      messages,
    );
  });

  it("returns an empty transcript when saved chat JSON is missing or invalid", async () => {
    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(readResearchChatMessages("market-map")).resolves.toEqual([]);

    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce("{");

    await expect(readResearchChatMessages("market-map")).resolves.toEqual([]);
  });

  it("saves chat transcripts into the selected research folder", async () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    ];

    await saveResearchChatMessages("market-map", messages as never);

    expect(fsMocks.mkdir).toHaveBeenCalledWith("search-results/market-map", {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/market-map/chat.json",
      JSON.stringify(messages, null, 2),
      {
        baseDir: BaseDirectory.AppData,
      },
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
