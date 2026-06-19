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

vi.mock("@/lib/tauri-bridge", () => ({
  ...fsMocks,
  BaseDirectory: {
    AppData: "AppData",
  },
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
import { SafePathSegmentSchema } from "@/lib/app-file-storage";

const getFolder = async () => "test-folder";

beforeEach(() => {
  vi.resetAllMocks();
  fsMocks.mkdir.mockResolvedValue(undefined);
  fsMocks.writeTextFile.mockResolvedValue(undefined);
  fsMocks.remove.mockResolvedValue(undefined);
  fsMocks.rename.mockResolvedValue(undefined);
});
describe("create_file", () => {
  it("creates a new file", async () => {
    const tool = createCreateFileTool(getFolder) as unknown as {
      execute: (i: { filename: string; content: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      tool.execute({ filename: "notes.md", content: "hello" }),
    ).resolves.toBe("OK");

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/test-folder/notes.md",
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
    const tool = createUpdateFileTool(getFolder) as unknown as {
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
    );
  });
});

describe("move_file", () => {
  it("renames a file", async () => {
    const tool = createMoveFileTool(getFolder) as unknown as {
      execute: (i: { source: string; destination: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(false);
    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readTextFile.mockResolvedValueOnce("file content");

    await expect(
      tool.execute({ source: "old.md", destination: "new.md" }),
    ).resolves.toBe("OK");

    expect(fsMocks.rename).toHaveBeenCalledWith(
      "search-results/test-folder/old.md",
      "search-results/test-folder/new.md",
    );
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
  });
});

describe("delete_file", () => {
  it("deletes an existing file", async () => {
    const tool = createDeleteFileTool(getFolder) as unknown as {
      execute: (i: { filename: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(true);

    await expect(
      tool.execute({ filename: "notes.md" }),
    ).resolves.toBe("OK");

    expect(fsMocks.remove).toHaveBeenCalledWith(
      "search-results/test-folder/notes.md",
    );
  });

  it("skips delete when file does not exist on disk", async () => {
    const tool = createDeleteFileTool(getFolder) as unknown as {
      execute: (i: { filename: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      tool.execute({ filename: "ghost.md" }),
    ).resolves.toBe("OK");

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

describe("SafePathSegmentSchema", () => {
  it("rejects path traversal with ../", () => {
    const result = SafePathSegmentSchema.safeParse("../../etc/passwd");
    expect(result.success).toBe(false);
  });

  it("rejects path with forward slashes", () => {
    const result = SafePathSegmentSchema.safeParse("folder/file.md");
    expect(result.success).toBe(false);
  });

  it("rejects path with backslashes", () => {
    const result = SafePathSegmentSchema.safeParse("folder\\file.md");
    expect(result.success).toBe(false);
  });

  it("rejects '..' as a filename", () => {
    const result = SafePathSegmentSchema.safeParse("..");
    expect(result.success).toBe(false);
  });

  it("rejects '.' as a filename", () => {
    const result = SafePathSegmentSchema.safeParse(".");
    expect(result.success).toBe(false);
  });

  it("accepts a plain filename", () => {
    const result = SafePathSegmentSchema.safeParse("notes.md");
    expect(result.success).toBe(true);
  });
});

describe("file tool edge cases", () => {
  it("rejects create_file with empty content", async () => {
    const tool = createCreateFileTool(getFolder) as unknown as {
      execute: (i: { filename: string; content: string }) => Promise<string>;
    };

    fsMocks.exists.mockResolvedValueOnce(false);

    await expect(
      tool.execute({ filename: "empty.md", content: "" }),
    ).resolves.toBe("OK");

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/test-folder/empty.md",
      "",
    );
  });

  it("rejects update_file with empty old_string", async () => {
    const tool = createUpdateFileTool(getFolder) as unknown as {
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
        old_string: "",
        new_string: "replaced",
      }),
    ).rejects.toThrow("multiple times");
  });
});
