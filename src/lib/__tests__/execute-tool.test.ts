import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/tauri-bridge", () => ({
  fetch: vi.fn(async () => new Response("")),
}));

vi.mock("@/lib/research-library-events", () => ({
  researchLibraryEvents: { subscribe: () => () => {} },
}));

vi.mock("@/lib/app-file-storage", () => ({
  listAppSubfolders: vi.fn(async () => ["acme-market-map"]),
  readAppFile: vi.fn(async () => ""),
  writeAppFile: vi.fn(async () => undefined),
  SafePathSegmentSchema: z.string().min(1).max(100),
  SafeSubfolderSchema: z.string().min(1).max(100),
}));

vi.mock("@/lib/chat-providers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/chat-providers")>();
  return {
    ...actual,
    createChatLanguageModel: vi.fn(() => ({})),
  };
});

vi.mock("deep-search-core/research-orchestrator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("deep-search-core/research-orchestrator")>();
  return {
    ...actual,
    createSearchTools: vi.fn(() => ({})),
    createResearchCheckpointTool: vi.fn(() => ({ execute: vi.fn() })),
    questionsTool: { execute: vi.fn() },
  };
});

vi.mock("deep-search-core/search-extract/core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("deep-search-core/search-extract/core")>();
  return {
    ...actual,
    searchQueryInputSchema: z.object({ query: z.string() }),
  };
});

import { getAvailableTools } from "@/lib/execute-tool";
import { listAppSubfolders } from "@/lib/app-file-storage";

describe("getAvailableTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when switch_research_folder is executed from the Tools panel instead of silently succeeding", async () => {
    vi.mocked(listAppSubfolders).mockResolvedValue(["existing-folder"]);

    const tools = getAvailableTools({
      researchFolder: "current-folder",
      getChatModel: () => ({
        provider: "openrouter",
        apiKey: "key",
        model: "m",
        baseURL: undefined,
      }),
    });
    const switchTool = tools.find((t) => t.name === "switch_research_folder");
    expect(switchTool).toBeTruthy();

    // The tool validates the folder exists, then invokes the panel callback,
    // which must surface that switching is unsupported rather than returning
    // a success payload via a no-op.
    await expect(
      switchTool!.execute({ folder: "existing-folder" }),
    ).rejects.toThrow(/Tools panel/i);
  });
});
