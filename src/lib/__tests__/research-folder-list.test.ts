import { describe, expect, it, vi } from "vitest";
import {
  mergeResearchFoldersWithCurrent,
  upsertRecentResearchFolder,
} from "@/lib/research-folder-list";

describe("research folder list helpers", () => {
  it("keeps the newest timestamp when merging refreshed folders", () => {
    const folders = [
      { name: "alpha", updatedAt: "2026-07-01T10:00:00.000Z" },
    ];
    const currentFolders = [
      { name: "alpha", updatedAt: "2026-07-02T10:00:00.000Z" },
    ];

    expect(mergeResearchFoldersWithCurrent(folders, currentFolders)).toEqual([
      { name: "alpha", updatedAt: "2026-07-02T10:00:00.000Z" },
    ]);
  });

  it("upserts a touched folder with the current timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T10:00:00.000Z"));

    try {
      expect(
        upsertRecentResearchFolder(
          [{ name: "alpha", updatedAt: "2026-07-01T10:00:00.000Z" }],
          "beta",
        ),
      ).toEqual([
        { name: "beta", updatedAt: "2026-07-03T10:00:00.000Z" },
        { name: "alpha", updatedAt: "2026-07-01T10:00:00.000Z" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
