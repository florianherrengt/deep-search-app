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
  deleteAppFile,
  deleteAppSubfolder,
  listAppFiles,
  listAppSubfolders,
  readAppFile,
  renameAppFile,
  renameAppSubfolder,
  SafeSubfolderSchema,
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

  it("notifies when research files change", async () => {
    const events: Event[] = [];
    const target = new EventTarget();
    target.addEventListener("research-library-changed", (event) => {
      events.push(event);
    });
    vi.stubGlobal("window", target);
    vi.stubGlobal(
      "CustomEvent",
      class TestCustomEvent<T> extends Event {
        detail: T;

        constructor(type: string, init: CustomEventInit<T>) {
          super(type);
          this.detail = init.detail as T;
        }
      },
    );

    try {
      await writeAppFile({
        subfolder: "search-results/apartment-dogs",
        filename: "brave-initial.md",
        content: "Search results",
      });

      expect(events).toHaveLength(1);
      expect((events[0] as CustomEvent).detail).toEqual({
        changeType: "write",
        folderName: "apartment-dogs",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("can write research metadata without notifying listeners", async () => {
    const events: Event[] = [];
    const target = new EventTarget();
    target.addEventListener("research-library-changed", (event) => {
      events.push(event);
    });
    vi.stubGlobal("window", target);
    vi.stubGlobal(
      "CustomEvent",
      class TestCustomEvent<T> extends Event {
        detail: T;

        constructor(type: string, init: CustomEventInit<T>) {
          super(type);
          this.detail = init.detail as T;
        }
      },
    );

    try {
      await writeAppFile({
        subfolder: "search-results/apartment-dogs/chats",
        filename: "index.json",
        content: "{}",
        emitChange: false,
      });

      expect(events).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("deletes an existing file from an app data subfolder", async () => {
    fsMocks.exists.mockResolvedValueOnce(true);

    await deleteAppFile({
      subfolder: "notes",
      filename: "example.md",
    });

    expect(fsMocks.exists).toHaveBeenCalledWith("notes/example.md", {
      baseDir: BaseDirectory.AppData,
    });
    expect(fsMocks.remove).toHaveBeenCalledWith("notes/example.md", {
      baseDir: BaseDirectory.AppData,
    });
  });

  it("deletes an existing file from a nested app data subfolder", async () => {
    fsMocks.exists.mockResolvedValueOnce(true);

    await deleteAppFile({
      subfolder: "search-results/apartment-dogs",
      filename: "brave-initial.md",
    });

    expect(fsMocks.remove).toHaveBeenCalledWith(
      "search-results/apartment-dogs/brave-initial.md",
      {
        baseDir: BaseDirectory.AppData,
      },
    );
  });

  it("returns gracefully when file to delete does not exist", async () => {
    fsMocks.exists.mockResolvedValueOnce(false);

    await deleteAppFile({
      subfolder: "notes",
      filename: "missing.md",
    });

    expect(fsMocks.remove).not.toHaveBeenCalled();
  });

  it("rejects unsafe path segments in deleteAppFile without touching filesystem", async () => {
    await expect(
      deleteAppFile({
        subfolder: "../notes",
        filename: "example.md",
      }),
    ).rejects.toThrow();

    expect(fsMocks.exists).not.toHaveBeenCalled();
    expect(fsMocks.remove).not.toHaveBeenCalled();
  });

  it("renames a file within the same subfolder", async () => {
    fsMocks.exists.mockResolvedValueOnce(false);

    await renameAppFile({
      subfolder: "notes",
      oldFilename: "draft.md",
      newFilename: "final.md",
    });

    expect(fsMocks.rename).toHaveBeenCalledWith(
      "notes/draft.md",
      "notes/final.md",
      {
        oldPathBaseDir: BaseDirectory.AppData,
        newPathBaseDir: BaseDirectory.AppData,
      },
    );
  });

  it("skips rename when old and new filenames are the same", async () => {
    await renameAppFile({
      subfolder: "notes",
      oldFilename: "unchanged.md",
      newFilename: "unchanged.md",
    });

    expect(fsMocks.exists).not.toHaveBeenCalled();
    expect(fsMocks.rename).not.toHaveBeenCalled();
  });

  it("rejects rename when the target file already exists", async () => {
    fsMocks.exists.mockResolvedValueOnce(true);

    await expect(
      renameAppFile({
        subfolder: "notes",
        oldFilename: "draft.md",
        newFilename: "existing.md",
      }),
    ).rejects.toThrow("already exists");
  });

  it("rejects unsafe path segments in renameAppFile without touching filesystem", async () => {
    await expect(
      renameAppFile({
        subfolder: "../notes",
        oldFilename: "draft.md",
        newFilename: "final.md",
      }),
    ).rejects.toThrow();

    await expect(
      renameAppFile({
        subfolder: "notes",
        oldFilename: "../draft",
        newFilename: "final.md",
      }),
    ).rejects.toThrow();

    expect(fsMocks.exists).not.toHaveBeenCalled();
    expect(fsMocks.rename).not.toHaveBeenCalled();
  });

  it("rejects a SafeSubfolderSchema path with 5 or more segments", () => {
    const result = SafeSubfolderSchema.safeParse("a/b/c/d/e");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "Subfolder must not be more than 4 segments deep",
          }),
        ]),
      );
    }
  });
});
