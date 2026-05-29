import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { UIMessage } from "ai";

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

import { generateResearchFolder } from "@/lib/transport/research-folder";

describe("generateResearchFolder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.writeTextFile.mockResolvedValue(undefined);
    tauriMocks.invoke.mockResolvedValue(undefined);
  });

  it("falls back to a local slug when model folder-name output misses the schema", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "{}" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: tokenUsage(),
        warnings: [],
      }),
    });

    await expect(
      generateResearchFolder(
        model,
        [userMessage("Find earnings calls for ACME?")],
        "test-key",
      ),
    ).resolves.toBe("find-earnings-calls-for-acme");

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "search-results/find-earnings-calls-for-acme/README.md",
      expect.stringContaining("Query: Find earnings calls for ACME?"),
      { baseDir: "AppData" },
    );
  });
});

function userMessage(text: string): UIMessage {
  return {
    id: `user-${text}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function tokenUsage() {
  return {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: 1,
      text: 1,
      reasoning: 0,
    },
  };
}
