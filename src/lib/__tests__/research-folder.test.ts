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

import { slugifyFolderName, resolveUniqueFolderName } from "@/lib/transport/research-folder";

describe("slugifyFolderName", () => {
  it("slugifies a simple phrase to kebab-case", () => {
    expect(slugifyFolderName("acme market map")).toBe("acme-market-map");
  });

  it("handles special characters", () => {
    expect(slugifyFolderName("How do LLMs work?!")).toBe("how-do-llms-work");
  });

  it("returns fallback for empty input", () => {
    expect(slugifyFolderName("")).toBe("research");
  });

  it("returns fallback for special-char-only input", () => {
    expect(slugifyFolderName("!!!")).toBe("research");
  });
});

describe("resolveUniqueFolderName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.exists.mockResolvedValue(false);
    fsMocks.readDir.mockResolvedValue([]);
  });

  it("returns the candidate when no collision", async () => {
    fsMocks.readDir.mockResolvedValue(["other-folder"]);
    await expect(resolveUniqueFolderName("my-folder")).resolves.toBe("my-folder");
  });

  it("appends date when candidate exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([
      { name: "my-folder", isDirectory: true, isFile: false, isSymlink: false },
    ]);
    const result = await resolveUniqueFolderName("my-folder");
    expect(result).toMatch(/^my-folder-2026-06-1[45]$/);
    expect(result).not.toBe("my-folder");
    vi.useRealTimers();
  });

  it("appends counter when candidate with date also exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    const dateStr = new Date().toISOString().slice(0, 10);
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([
      { name: "my-folder", isDirectory: true, isFile: false, isSymlink: false },
      { name: `my-folder-${dateStr}`, isDirectory: true, isFile: false, isSymlink: false },
    ]);
    await expect(resolveUniqueFolderName("my-folder")).resolves.toBe(`my-folder-${dateStr}-2`);
    vi.useRealTimers();
  });
});
