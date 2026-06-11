import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateText = vi.hoisted(() => vi.fn());
const mockEmitSubAgentEvent = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: mockGenerateText,
  };
});

vi.mock("@/lib/sub-agent-emitter", () => ({
  emitSubAgentEvent: mockEmitSubAgentEvent,
}));

import { extractAndStoreMemories } from "@/lib/memory-agent";

type ReadAppFileFn = (input: { subfolder: string; filename: string }) => Promise<string | null>;
type WriteAppFileFn = (input: { subfolder: string; filename: string; content: string; emitChange?: boolean }) => Promise<void>;

describe("extractAndStoreMemories", () => {
  let mockReadAppFile: ReturnType<typeof vi.fn<ReadAppFileFn>>;
  let mockWriteAppFile: ReturnType<typeof vi.fn<WriteAppFileFn>>;
  let getResearchFolder: () => Promise<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadAppFile = vi.fn<ReadAppFileFn>();
    mockWriteAppFile = vi.fn<WriteAppFileFn>();
    getResearchFolder = vi.fn().mockResolvedValue("test-folder");
  });

  it("extracts facts from explicit statement", async () => {
    mockGenerateText.mockResolvedValue({ text: '["User has a dog."]' });
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "I have a dog.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).toHaveBeenCalledWith({
      subfolder: "search-results/test-folder",
      filename: "memories.md",
      content: "# Memories\n\n- User has a dog.\n",
    });
    expect(result).toEqual({ memoriesStored: 1 });
  });

  it("skips task-specific details", async () => {
    mockGenerateText.mockResolvedValue({ text: "[]" });

    const result = await extractAndStoreMemories(
      "Find the latest news about AI.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).not.toHaveBeenCalled();
    expect(result).toEqual({ memoriesStored: 0 });
    expect(mockEmitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "complete" }),
    );
  });

  it("merges with existing memories.md", async () => {
    mockGenerateText.mockResolvedValue({ text: '["User has a dog."]' });
    mockReadAppFile.mockResolvedValue("# Memories\n\n- User uses macOS.\n");

    const result = await extractAndStoreMemories(
      "I have a dog.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).toHaveBeenCalledWith({
      subfolder: "search-results/test-folder",
      filename: "memories.md",
      content: "# Memories\n\n- User uses macOS.\n- User has a dog.\n",
    });
    expect(result).toEqual({ memoriesStored: 1 });
  });

  it("deduplicates", async () => {
    mockGenerateText.mockResolvedValue({ text: '["User has a dog."]' });
    mockReadAppFile.mockResolvedValue("# Memories\n\n- User has a dog.\n");

    const result = await extractAndStoreMemories(
      "I have a dog.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).toHaveBeenCalledWith({
      subfolder: "search-results/test-folder",
      filename: "memories.md",
      content: "# Memories\n\n- User has a dog.\n",
    });
    expect(result).toEqual({ memoriesStored: 0 });
  });

  it("creates new file when none exists", async () => {
    mockGenerateText.mockResolvedValue({ text: '["User uses macOS."]' });
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "I use macOS.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).toHaveBeenCalledWith({
      subfolder: "search-results/test-folder",
      filename: "memories.md",
      content: "# Memories\n\n- User uses macOS.\n",
    });
    expect(result).toEqual({ memoriesStored: 1 });
  });

  it("does not throw on failure", async () => {
    mockGenerateText.mockRejectedValue(new Error("API error"));

    const result = await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(result).toEqual({ memoriesStored: 0 });
  });

  it("skips non-array response", async () => {
    mockGenerateText.mockResolvedValue({ text: '"not an array"' });

    const result = await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).not.toHaveBeenCalled();
    expect(result).toEqual({ memoriesStored: 0 });
    expect(mockEmitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "complete" }),
    );
  });
});
