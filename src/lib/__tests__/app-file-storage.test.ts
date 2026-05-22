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
  deleteAppSubfolder,
  listAppFiles,
  listAppSubfolders,
  readAppFile,
  renameAppSubfolder,
  writeAppFile,
} from "@/lib/app-file-storage";

describe("app file storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes text files under an app data subfolder", async () => {
    await writeAppFile({
      subfolder: "notes",
      filename: "example.md",
      content: "# Example\n\nHello from app data.",
    });

    expect(fsMocks.mkdir).toHaveBeenCalledWith("notes", {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "notes/example.md",
      "# Example\n\nHello from app data.",
      {
        baseDir: BaseDirectory.AppData,
      },
    );
  });

  it("writes text files under nested app data subfolders", async () => {
    await writeAppFile({
      subfolder: "search-results/apartment-dogs",
      filename: "brave-initial.md",
      content: "Search results",
    });

    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      "search-results/apartment-dogs",
      {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      },
    );
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/apartment-dogs/brave-initial.md",
      "Search results",
      {
        baseDir: BaseDirectory.AppData,
      },
    );
  });

  it("reads existing text files from app data", async () => {
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce("# Example");

    await expect(
      readAppFile({
        subfolder: "notes",
        filename: "example.md",
      }),
    ).resolves.toBe("# Example");

    expect(fsMocks.exists).toHaveBeenCalledWith("notes/example.md", {
      baseDir: BaseDirectory.AppData,
    });
    expect(fsMocks.readTextFile).toHaveBeenCalledWith("notes/example.md", {
      baseDir: BaseDirectory.AppData,
    });
  });

  it("returns null when a file does not exist", async () => {
    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      readAppFile({
        subfolder: "notes",
        filename: "missing.md",
      }),
    ).resolves.toBeNull();

    expect(fsMocks.readTextFile).not.toHaveBeenCalled();
  });

  it("lists safe app data subfolders", async () => {
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readDir.mockResolvedValueOnce([
      {
        name: "zebra-research",
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      },
      {
        name: "notes.md",
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      },
      {
        name: "apartment-dogs",
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      },
      {
        name: "..",
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      },
    ]);

    await expect(
      listAppSubfolders({ subfolder: "search-results" }),
    ).resolves.toEqual(["apartment-dogs", "zebra-research"]);

    expect(fsMocks.readDir).toHaveBeenCalledWith("search-results", {
      baseDir: BaseDirectory.AppData,
    });
  });

  it("lists safe app data files", async () => {
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readDir.mockResolvedValueOnce([
      {
        name: "2026-05-22T11-12-13.456Z.json",
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      },
      {
        name: "raw",
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      },
      {
        name: "..",
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      },
    ]);

    await expect(
      listAppFiles({ subfolder: "search-results/apartment-dogs/chats" }),
    ).resolves.toEqual(["2026-05-22T11-12-13.456Z.json"]);

    expect(fsMocks.readDir).toHaveBeenCalledWith(
      "search-results/apartment-dogs/chats",
      {
        baseDir: BaseDirectory.AppData,
      },
    );
  });

  it("returns an empty list when the app data subfolder does not exist", async () => {
    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      listAppSubfolders({ subfolder: "search-results" }),
    ).resolves.toEqual([]);

    expect(fsMocks.readDir).not.toHaveBeenCalled();
  });

  it("deletes app data subfolders recursively", async () => {
    fsMocks.exists.mockResolvedValueOnce(true);

    await deleteAppSubfolder({ subfolder: "search-results/apartment-dogs" });

    expect(fsMocks.remove).toHaveBeenCalledWith(
      "search-results/apartment-dogs",
      {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      },
    );
  });

  it("skips deleting app data subfolders that do not exist", async () => {
    fsMocks.exists.mockResolvedValueOnce(false);

    await deleteAppSubfolder({ subfolder: "search-results/apartment-dogs" });

    expect(fsMocks.remove).not.toHaveBeenCalled();
  });

  it("renames app data subfolders without overwriting an existing target", async () => {
    fsMocks.exists.mockResolvedValueOnce(false);

    await renameAppSubfolder({
      oldSubfolder: "search-results/apartment-dogs",
      newSubfolder: "search-results/city-dogs",
    });

    expect(fsMocks.rename).toHaveBeenCalledWith(
      "search-results/apartment-dogs",
      "search-results/city-dogs",
      {
        oldPathBaseDir: BaseDirectory.AppData,
        newPathBaseDir: BaseDirectory.AppData,
      },
    );

    fsMocks.exists.mockResolvedValueOnce(true);

    await expect(
      renameAppSubfolder({
        oldSubfolder: "search-results/apartment-dogs",
        newSubfolder: "search-results/city-dogs",
      }),
    ).rejects.toThrow("already exists");
  });

  it("rejects unsafe path segments before touching the filesystem", async () => {
    await expect(
      writeAppFile({
        subfolder: "../notes",
        filename: "example.md",
        content: "# Example",
      }),
    ).rejects.toThrow();

    await expect(
      readAppFile({
        subfolder: "notes/../search-results",
        filename: "..",
      }),
    ).rejects.toThrow();

    expect(fsMocks.mkdir).not.toHaveBeenCalled();
    expect(fsMocks.exists).not.toHaveBeenCalled();
    expect(fsMocks.readDir).not.toHaveBeenCalled();
    expect(fsMocks.remove).not.toHaveBeenCalled();
    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
    expect(fsMocks.readTextFile).not.toHaveBeenCalled();
  });
});
