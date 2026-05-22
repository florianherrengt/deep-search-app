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

import { createSwitchResearchFolderTool } from "@/tools/switch-research-folder-tool";

type ExecutableSwitchTool = {
  execute: (input: { folder: string }) => Promise<{
    researchFolder: string;
  }>;
};

describe("createSwitchResearchFolderTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("switches to an existing folder and returns the folder name", async () => {
    const switchResearchFolder = vi.fn();
    const tool = createSwitchResearchFolderTool(
      switchResearchFolder,
    ) as unknown as ExecutableSwitchTool;

    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readDir.mockResolvedValueOnce([
      {
        name: "market-map",
        isDirectory: true,
        isFile: false,
        isSymlink: false,
      },
    ]);

    await expect(tool.execute({ folder: "market-map" })).resolves.toEqual({
      researchFolder: "market-map",
    });
    expect(switchResearchFolder).toHaveBeenCalledWith("market-map");
  });

  it("rejects missing folders without switching", async () => {
    const switchResearchFolder = vi.fn();
    const tool = createSwitchResearchFolderTool(
      switchResearchFolder,
    ) as unknown as ExecutableSwitchTool;

    fsMocks.exists.mockResolvedValueOnce(true);
    fsMocks.readDir.mockResolvedValueOnce([]);

    await expect(tool.execute({ folder: "missing" })).rejects.toThrow(
      "Research folder not found: missing",
    );
    expect(switchResearchFolder).not.toHaveBeenCalled();
  });
});
