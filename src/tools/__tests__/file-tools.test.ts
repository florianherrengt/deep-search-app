import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingConfig } from "@/lib/research-search";

const mockEmbeddingConfig: EmbeddingConfig = { api_key: "test-key", base_url: "https://openrouter.ai/api/v1", model: "qwen/qwen3-embedding-4b", dimensions: 1024, query_prefix: "Represent this sentence for searching relevant passages: " };

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

const researchSearchMocks = vi.hoisted(() => ({
  indexResearchFile: vi.fn(),
  deleteResearchFileIndex: vi.fn(),
}));

vi.mock("@/lib/research-search", () => ({
  indexResearchFile: researchSearchMocks.indexResearchFile,
  deleteResearchFileIndex: researchSearchMocks.deleteResearchFileIndex,
}));

const researchLibraryMocks = vi.hoisted(() => ({
  emitResearchLibraryChanged: vi.fn(),
}));

vi.mock("@/lib/research-library-events", () => ({
  emitResearchLibraryChanged: researchLibraryMocks.emitResearchLibraryChanged,
}));

import {
  createCreateFileTool,
  createReadFileTool,
  createUpdateFileTool,
  createMoveFileTool,
  createDeleteFileTool,
  createListFilesTool,
} from "@/tools/file-tools";

const getFolder = async () => "test-folder";

beforeEach(() => {
  vi.clearAllMocks();
  fsMocks.mkdir.mockResolvedValue(undefined);
  fsMocks.writeTextFile.mockResolvedValue(undefined);
  fsMocks.remove.mockResolvedValue(undefined);
  fsMocks.rename.mockResolvedValue(undefined);
  researchSearchMocks.indexResearchFile.mockResolvedValue(undefined);
  researchSearchMocks.deleteResearchFileIndex.mockResolvedValue(undefined);
});

describe("create_file", () => {
  it("creates a new file and indexes it", async () => {
    const tool = createCreateFileTool(getFolder, mockEmbeddingConfig) as unknown as {
      execute: (i: { filename: string; content: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      tool.execute({ filename: "notes.md", content: "hello" }),
    ).resolves.toBe("OK");

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/test-folder/notes.md",
      "hello",
      { baseDir: "AppData" },
    );
    expect(researchSearchMocks.indexResearchFile).toHaveBeenCalledWith(
      mockEmbeddingConfig,
      "test-folder",
      "notes.md",
      "hello",
    );
  });

  it("rejects if the file already exists", async () => {
    const tool = createCreateFileTool(getFolder) as unknown as {
      execute: (i: { filename: string; content: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce("existing content");

    await expect(
      tool.execute({ filename: "notes.md", content: "hello" }),
    ).rejects.toThrow("already exists");

    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("skips indexing when no api key is provided", async () => {
    const tool = createCreateFileTool(getFolder) as unknown as {
      execute: (i: { filename: string; content: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      tool.execute({ filename: "notes.md", content: "hello" }),
    ).resolves.toBe("OK");

    expect(researchSearchMocks.indexResearchFile).not.toHaveBeenCalled();
  });
});

describe("read_file", () => {
  it("returns file contents", async () => {
    const tool = createReadFileTool(getFolder) as unknown as {
      execute: (i: { filename: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce("file content here");

    await expect(
      tool.execute({ filename: "notes.md" }),
    ).resolves.toBe("file content here");
  });

  it("throws when file does not exist", async () => {
    const tool = createReadFileTool(getFolder) as unknown as {
      execute: (i: { filename: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      tool.execute({ filename: "missing.md" }),
    ).rejects.toThrow("not found");
  });
});

describe("update_file", () => {
  it("replaces a unique string in the file", async () => {
    const tool = createUpdateFileTool(getFolder, mockEmbeddingConfig) as unknown as {
      execute: (i: {
        filename: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean;
      }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce("hello world");

    await expect(
      tool.execute({
        filename: "notes.md",
        old_string: "world",
        new_string: "universe",
      }),
    ).resolves.toBe("OK");

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/test-folder/notes.md",
      "hello universe",
      { baseDir: "AppData" },
    );
    expect(researchSearchMocks.indexResearchFile).toHaveBeenCalledWith(
      mockEmbeddingConfig,
      "test-folder",
      "notes.md",
      "hello universe",
    );
  });

  it("throws when file does not exist", async () => {
    const tool = createUpdateFileTool(getFolder) as unknown as {
      execute: (i: {
        filename: string;
        old_string: string;
        new_string: string;
      }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      tool.execute({
        filename: "missing.md",
        old_string: "a",
        new_string: "b",
      }),
    ).rejects.toThrow("not found");
  });

  it("throws when old_string is not in the file", async () => {
    const tool = createUpdateFileTool(getFolder) as unknown as {
      execute: (i: {
        filename: string;
        old_string: string;
        new_string: string;
      }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce("hello world");

    await expect(
      tool.execute({
        filename: "notes.md",
        old_string: "goodbye",
        new_string: "see ya",
      }),
    ).rejects.toThrow("old_string not found");
  });

  it("throws when old_string matches multiple times without replace_all", async () => {
    const tool = createUpdateFileTool(getFolder) as unknown as {
      execute: (i: {
        filename: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean;
      }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce("foo bar foo baz foo");

    await expect(
      tool.execute({
        filename: "notes.md",
        old_string: "foo",
        new_string: "qux",
      }),
    ).rejects.toThrow("multiple times");
  });

  it("replaces all occurrences when replace_all is true", async () => {
    const tool = createUpdateFileTool(getFolder) as unknown as {
      execute: (i: {
        filename: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean;
      }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce("foo bar foo baz foo");

    await expect(
      tool.execute({
        filename: "notes.md",
        old_string: "foo",
        new_string: "qux",
        replace_all: true,
      }),
    ).resolves.toBe("OK");

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/test-folder/notes.md",
      "qux bar qux baz qux",
      { baseDir: "AppData" },
    );
  });
});

describe("move_file", () => {
  it("renames a file, deletes old index, and re-indexes under new name", async () => {
    const tool = createMoveFileTool(getFolder, mockEmbeddingConfig) as unknown as {
      execute: (i: { source: string; destination: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(false);
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce("file content");

    await expect(
      tool.execute({ source: "old.md", destination: "new.md" }),
    ).resolves.toBe("OK");

    expect(researchSearchMocks.deleteResearchFileIndex).toHaveBeenCalledWith(
      "test-folder",
      "old.md",
    );
    expect(fsMocks.rename).toHaveBeenCalledWith(
      "search-results/test-folder/old.md",
      "search-results/test-folder/new.md",
      {
        oldPathBaseDir: "AppData",
        newPathBaseDir: "AppData",
      },
    );
    expect(researchSearchMocks.indexResearchFile).toHaveBeenCalledWith(
      mockEmbeddingConfig,
      "test-folder",
      "new.md",
      "file content",
    );
  });

  it("deletes old index even without api key", async () => {
    const tool = createMoveFileTool(getFolder) as unknown as {
      execute: (i: { source: string; destination: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      tool.execute({ source: "old.md", destination: "new.md" }),
    ).resolves.toBe("OK");

    expect(researchSearchMocks.deleteResearchFileIndex).toHaveBeenCalledWith(
      "test-folder",
      "old.md",
    );
    expect(researchSearchMocks.indexResearchFile).not.toHaveBeenCalled();
  });

  it("throws when destination already exists", async () => {
    const tool = createMoveFileTool(getFolder) as unknown as {
      execute: (i: { source: string; destination: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(true);

    await expect(
      tool.execute({ source: "old.md", destination: "existing.md" }),
    ).rejects.toThrow("already exists");
  });

  it("no-ops when source and destination are the same", async () => {
    const tool = createMoveFileTool(getFolder) as unknown as {
      execute: (i: { source: string; destination: string }) => Promise<string>;
    };

    await expect(
      tool.execute({ source: "same.md", destination: "same.md" }),
    ).resolves.toBe("OK");

    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(researchSearchMocks.deleteResearchFileIndex).not.toHaveBeenCalled();
  });
});

describe("delete_file", () => {
  it("deletes an existing file and removes its index", async () => {
    const tool = createDeleteFileTool(getFolder) as unknown as {
      execute: (i: { filename: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(true);

    await expect(
      tool.execute({ filename: "notes.md" }),
    ).resolves.toBe("OK");

    expect(researchSearchMocks.deleteResearchFileIndex).toHaveBeenCalledWith(
      "test-folder",
      "notes.md",
    );
    expect(fsMocks.remove).toHaveBeenCalledWith(
      "search-results/test-folder/notes.md",
      { baseDir: "AppData" },
    );
  });

  it("removes index even when file does not exist on disk", async () => {
    const tool = createDeleteFileTool(getFolder) as unknown as {
      execute: (i: { filename: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      tool.execute({ filename: "ghost.md" }),
    ).resolves.toBe("OK");

    expect(researchSearchMocks.deleteResearchFileIndex).toHaveBeenCalledWith(
      "test-folder",
      "ghost.md",
    );
    expect(fsMocks.remove).not.toHaveBeenCalled();
  });
});

describe("list_files", () => {
  it("returns sorted file names from the research folder", async () => {
    const tool = createListFilesTool(getFolder) as unknown as {
      execute: () => Promise<{ folder: string; files: string[] }>;
    };

    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readDir.mockResolvedValueOnce([
      { name: "sources.md", isFile: true, isDirectory: false, isSymlink: false },
      { name: "notes.md", isFile: true, isDirectory: false, isSymlink: false },
      { name: "subfolder", isFile: false, isDirectory: true, isSymlink: false },
    ]);

    await expect(tool.execute()).resolves.toEqual({
      folder: "test-folder",
      files: ["notes.md", "sources.md"],
    });
  });

  it("returns empty array when folder does not exist", async () => {
    const tool = createListFilesTool(getFolder) as unknown as {
      execute: () => Promise<{ folder: string; files: string[] }>;
    };

    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(tool.execute()).resolves.toEqual({
      folder: "test-folder",
      files: [],
    });
  });
});
