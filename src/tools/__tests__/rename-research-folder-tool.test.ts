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

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
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

import { createRenameResearchFolderTool } from "@/tools/rename-research-folder-tool";

type ExecutableRenameTool = {
  execute: (input: { name: string }) => Promise<{
    folderName: string;
  }>;
};

describe("createRenameResearchFolderTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeTextFile.mockResolvedValue(undefined);
    fsMocks.rename.mockResolvedValue(undefined);
    fsMocks.readDir.mockResolvedValue([]);
    fsMocks.exists.mockResolvedValue(false);
    tauriMocks.invoke.mockResolvedValue(undefined);
  });

  it("renames the current folder and writes README", async () => {
    const onFolderRenamed = vi.fn();
    const tool = createRenameResearchFolderTool({
      getResearchFolder: async () => "2026-05-22_10-11-12",
      onFolderRenamed,
      embeddingConfig: mockEmbeddingConfig,
    }) as unknown as ExecutableRenameTool;

    const result = await tool.execute({ name: "acme-market-map" });

    expect(result.folderName).toBe("acme-market-map");
    expect(fsMocks.rename).toHaveBeenCalledWith(
      "search-results/2026-05-22_10-11-12",
      "search-results/acme-market-map",
      expect.any(Object),
    );
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/acme-market-map/README.md",
      expect.stringContaining("acme-market-map"),
      expect.any(Object),
    );
    expect(onFolderRenamed).toHaveBeenCalledWith("acme-market-map");
  });

  it("slugifies the provided name", async () => {
    const tool = createRenameResearchFolderTool({
      getResearchFolder: async () => "2026-05-22_10-11-12",
      onFolderRenamed: async () => {},
      embeddingConfig: mockEmbeddingConfig,
    }) as unknown as ExecutableRenameTool;

    const result = await tool.execute({ name: "How Do LLMs Work?!" });
    expect(result.folderName).toBe("how-do-llms-work");
  });

  it("resolves name collisions by appending date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    fsMocks.exists.mockImplementation(async (path: unknown) => {
      const p = typeof path === "string" ? path : "";
      if (p.startsWith("search-results/acme-market-map-")) return false;
      return true;
    });
    fsMocks.readDir.mockResolvedValue([
      { name: "acme-market-map", isDirectory: true, isFile: false, isSymlink: false },
    ]);

    const tool = createRenameResearchFolderTool({
      getResearchFolder: async () => "2026-05-22_10-11-12",
      onFolderRenamed: async () => {},
      embeddingConfig: mockEmbeddingConfig,
    }) as unknown as ExecutableRenameTool;

    const result = await tool.execute({ name: "acme-market-map" });
    expect(result.folderName).toMatch(/^acme-market-map-2026-06-1[45]$/);

    vi.useRealTimers();
  });

  it("skips rename when the resolved name matches the current folder", async () => {
    const tool = createRenameResearchFolderTool({
      getResearchFolder: async () => "acme-market-map",
      onFolderRenamed: async () => {},
      embeddingConfig: mockEmbeddingConfig,
    }) as unknown as ExecutableRenameTool;

    await tool.execute({ name: "acme-market-map" });

    expect(fsMocks.rename).not.toHaveBeenCalled();
    expect(fsMocks.writeTextFile).toHaveBeenCalled();
  });

  it("uses fallback name 'research' for empty input", async () => {
    const onFolderRenamed = vi.fn();
    const tool = createRenameResearchFolderTool({
      getResearchFolder: async () => "2026-05-22_10-11-12",
      onFolderRenamed,
      embeddingConfig: mockEmbeddingConfig,
    }) as unknown as ExecutableRenameTool;

    const result = await tool.execute({ name: "" });

    expect(result.folderName).toBe("research");
    expect(fsMocks.rename).toHaveBeenCalledWith(
      "search-results/2026-05-22_10-11-12",
      "search-results/research",
      expect.any(Object),
    );
    expect(onFolderRenamed).toHaveBeenCalledWith("research");
  });

  it("truncates very long name to RESEARCH_FOLDER_SLUG_MAX_LENGTH", async () => {
    const onFolderRenamed = vi.fn();
    const tool = createRenameResearchFolderTool({
      getResearchFolder: async () => "2026-05-22_10-11-12",
      onFolderRenamed,
      embeddingConfig: mockEmbeddingConfig,
    }) as unknown as ExecutableRenameTool;

    const longName = "x".repeat(200);

    const result = await tool.execute({ name: longName });

    expect(result.folderName).toHaveLength(100);
    expect(result.folderName).toBe("x".repeat(100));
    expect(fsMocks.rename).toHaveBeenCalledWith(
      "search-results/2026-05-22_10-11-12",
      `search-results/${"x".repeat(100)}`,
      expect.any(Object),
    );
    expect(onFolderRenamed).toHaveBeenCalledWith("x".repeat(100));
  });

  it("calls onFolderRenamed with the final folder name", async () => {
    const onFolderRenamed = vi.fn();
    const tool = createRenameResearchFolderTool({
      getResearchFolder: async () => "2026-05-22_10-11-12",
      onFolderRenamed,
      embeddingConfig: mockEmbeddingConfig,
    }) as unknown as ExecutableRenameTool;

    await tool.execute({ name: "my-research" });
    expect(onFolderRenamed).toHaveBeenCalledWith("my-research");
  });
});
