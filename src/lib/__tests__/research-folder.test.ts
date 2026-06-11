import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/research-library-events", () => ({
  emitResearchLibraryChanged: vi.fn(),
}));

import {
  resolveUniqueFolderName,
  resolveUniqueFolderNameFromExisting,
  slugifyFolderName,
  validateResearchFolderName,
} from "@/lib/transport/research-folder";

describe("slugifyFolderName", () => {
  it("slugifies a simple phrase to kebab-case", () => {
    expect(slugifyFolderName("acme market map")).toBe("acme-market-map");
  });

  it("handles special characters", () => {
    expect(slugifyFolderName("How do LLMs work?!")).toBe("how-do-llms-work");
  });

  it("does not fallback for empty input", () => {
    expect(slugifyFolderName("")).toBe("");
  });

  it("does not fallback for special-char-only input", () => {
    expect(slugifyFolderName("!!!")).toBe("");
  });

  it("converts underscores to hyphens", () => {
    expect(slugifyFolderName("hello_world")).toBe("hello-world");
  });

  it("converts multiple underscores to hyphens", () => {
    expect(slugifyFolderName("foo_bar_baz")).toBe("foo-bar-baz");
  });

  it("lowercases input", () => {
    expect(slugifyFolderName("HELLO WORLD")).toBe("hello-world");
  });

  it("transliterates accented characters", () => {
    expect(slugifyFolderName("café résumé")).toBe("cafe-resume");
  });

  it("does not fallback for non-latin scripts that produce empty output", () => {
    expect(slugifyFolderName("北京")).toBe("");
  });

  it("does not fallback for emoji-only input", () => {
    expect(slugifyFolderName("🎉🚀")).toBe("");
  });

  it("strips emoji from mixed input", () => {
    expect(slugifyFolderName("emoji 🎉 party")).toBe("emoji-party");
  });

  it("handles tabs and newlines", () => {
    expect(slugifyFolderName("tab\there")).toBe("tab-here");
    expect(slugifyFolderName("line\nbreak")).toBe("line-break");
  });

  it("collapses multiple spaces into a single hyphen", () => {
    expect(slugifyFolderName("extra   spaces")).toBe("extra-spaces");
  });

  it("trims leading and trailing whitespace", () => {
    expect(slugifyFolderName("  spaces  ")).toBe("spaces");
  });

  it("removes leading and trailing hyphens from slugify output", () => {
    expect(slugifyFolderName("trailing-")).toBe("trailing");
    expect(slugifyFolderName("-leading")).toBe("leading");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugifyFolderName("double--hyphen")).toBe("double-hyphen");
  });

  it("removes dots from input", () => {
    expect(slugifyFolderName("node.js express")).toBe("nodejs-express");
  });

  it("truncates to 100 characters", () => {
    const long = "a".repeat(120);
    expect(slugifyFolderName(long).length).toBeLessThanOrEqual(100);
    expect(slugifyFolderName(long)).toBe("a".repeat(100));
  });

  it("preserves hyphens in already-kebab input", () => {
    expect(slugifyFolderName("acme-earnings-calls")).toBe("acme-earnings-calls");
  });

  it("handles numeric input", () => {
    expect(slugifyFolderName("123")).toBe("123");
  });

  it("handles mixed alphanumeric input", () => {
    expect(slugifyFolderName("project 2026 roadmap")).toBe("project-2026-roadmap");
  });

  it("can sanitize input to a single character for later validation", () => {
    expect(slugifyFolderName("c++")).toBe("c");
  });

  it("handles input that is already a valid slug", () => {
    expect(slugifyFolderName("my-research")).toBe("my-research");
  });
});

describe("validateResearchFolderName", () => {
  it("accepts safe kebab-case folder names", () => {
    expect(validateResearchFolderName("acme-earnings-calls")).toBeNull();
  });

  it("rejects empty names", () => {
    expect(validateResearchFolderName("")).toBe("must not be empty");
  });

  it("rejects unsafe path segments", () => {
    expect(validateResearchFolderName("../escape")).toContain("kebab-case");
    expect(validateResearchFolderName("a\\b")).toContain("kebab-case");
  });

  it("rejects names that are too short", () => {
    expect(validateResearchFolderName("a")).toContain("too short");
  });

  it("rejects names with too many words", () => {
    expect(validateResearchFolderName("one-two-three-four-five-six")).toContain(
      "too many words",
    );
  });

  it("rejects timestamp-only names", () => {
    expect(validateResearchFolderName("2026-06-11")).toContain("timestamp");
  });
});

describe("resolveUniqueFolderName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the candidate when search-results folder does not exist", async () => {
    fsMocks.exists.mockResolvedValue(false);
    await expect(resolveUniqueFolderName("my-folder")).resolves.toBe("my-folder");
  });

  it("returns the candidate when no existing folders match", async () => {
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([
      dirEntry("other-folder"),
      dirEntry("unrelated"),
    ]);
    await expect(resolveUniqueFolderName("my-folder")).resolves.toBe("my-folder");
  });

  it("returns the candidate when only files exist (no directories)", async () => {
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([
      { name: "my-folder", isDirectory: false, isFile: true, isSymlink: false },
    ]);
    await expect(resolveUniqueFolderName("my-folder")).resolves.toBe("my-folder");
  });

  it("ignores entries with invalid path segments", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([
      dirEntry("my-folder"),
      { name: "../traversal", isDirectory: true, isFile: false, isSymlink: false },
      { name: "", isDirectory: true, isFile: false, isSymlink: false },
    ]);
    await expect(resolveUniqueFolderName("my-folder")).resolves.toBe("my-folder-2026-06-15");
  });

  it("appends date when exact candidate exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([dirEntry("my-folder")]);
    const result = await resolveUniqueFolderName("my-folder");
    expect(result).toBe("my-folder-2026-06-15");
    expect(result).not.toBe("my-folder");
  });

  it("appends counter when candidate with date also exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([
      dirEntry("my-folder"),
      dirEntry("my-folder-2026-06-15"),
    ]);
    await expect(resolveUniqueFolderName("my-folder")).resolves.toBe("my-folder-2026-06-15-2");
  });

  it("increments counter when multiple dated folders exist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([
      dirEntry("my-folder"),
      dirEntry("my-folder-2026-06-15"),
      dirEntry("my-folder-2026-06-15-2"),
      dirEntry("my-folder-2026-06-15-3"),
    ]);
    await expect(resolveUniqueFolderName("my-folder")).resolves.toBe("my-folder-2026-06-15-4");
  });

  it("does not confuse similar prefix names as collisions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([
      dirEntry("my-folder-old"),
      dirEntry("my-folder-v2"),
    ]);
    await expect(resolveUniqueFolderName("my-folder")).resolves.toBe("my-folder");
  });

  it("returns candidate unchanged when folder list is empty", async () => {
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([]);
    await expect(resolveUniqueFolderName("unique-name")).resolves.toBe("unique-name");
  });

  it("handles candidate that looks like a dated name but is not in the list", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00"));
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readDir.mockResolvedValue([
      dirEntry("project-2026-06-14"),
    ]);
    await expect(resolveUniqueFolderName("project-2026-06-14")).resolves.toBe("project-2026-06-14-2026-06-15");
  });
});

describe("resolveUniqueFolderNameFromExisting", () => {
  it("handles duplicate folder names deterministically from inputs", () => {
    expect(
      resolveUniqueFolderNameFromExisting(
        "my-folder",
        ["my-folder", "my-folder-2026-06-15"],
        new Date("2026-06-15T12:00:00Z"),
      ),
    ).toBe("my-folder-2026-06-15-2");
  });

  it("does not mutate unique candidates", () => {
    expect(
      resolveUniqueFolderNameFromExisting(
        "unique-folder",
        ["other-folder"],
        new Date("2026-06-15T12:00:00Z"),
      ),
    ).toBe("unique-folder");
  });
});

function dirEntry(name: string) {
  return { name, isDirectory: true, isFile: false, isSymlink: false };
}
