import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
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
  readAppFile,
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
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
    expect(fsMocks.readTextFile).not.toHaveBeenCalled();
  });
});
