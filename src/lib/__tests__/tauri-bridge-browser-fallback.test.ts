import { beforeEach, describe, expect, it, vi } from "vitest";

function createLocalStorageMock() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => {
      values.clear();
    }),
  };
}

describe("tauri bridge browser fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("window", {
      localStorage: createLocalStorageMock(),
      open: vi.fn(),
    });
  });

  it("stores plugin-store data in localStorage outside Tauri", async () => {
    const { loadStore } = await import("@/lib/tauri-bridge");

    const store = await loadStore("settings.json", {
      autoSave: false,
      defaults: { theme: "system" },
    });

    await expect(store.get("theme")).resolves.toBe("system");
    await store.set("theme", "dark");
    await store.save();

    const reloaded = await loadStore("settings.json", {
      autoSave: false,
      defaults: { theme: "system" },
    });
    await expect(reloaded.get("theme")).resolves.toBe("dark");
  });

  it("stores app-data files in localStorage outside Tauri", async () => {
    const {
      exists,
      mkdir,
      readDir,
      readTextFile,
      writeTextFile,
    } = await import("@/lib/tauri-bridge");

    await expect(exists("search-results")).resolves.toBe(false);

    await mkdir("search-results/topic-a");
    await writeTextFile("search-results/topic-a/README.md", "Research notes");

    await expect(exists("search-results")).resolves.toBe(true);
    await expect(readTextFile("search-results/topic-a/README.md")).resolves.toBe(
      "Research notes",
    );
    await expect(readDir("search-results")).resolves.toEqual([
      { name: "topic-a", isDirectory: true, isFile: false },
    ]);
  });
});
