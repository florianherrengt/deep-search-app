import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStreamText = vi.hoisted(() => vi.fn());
const mockEmitSubAgentEvent = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: mockStreamText,
  };
});

function streamTextResult(text: string) {
  return {
    textStream: (async function* () { yield text; })(),
    text: Promise.resolve(text),
  };
}

function streamTextError(error: Error) {
  return {
    textStream: (async function* () { throw error; })(),
    text: new Promise(() => {}),
  };
}

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
    mockStreamText.mockReturnValue(streamTextResult('["User has a dog."]'));
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
    mockStreamText.mockReturnValue(streamTextResult("[]"));

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
    mockStreamText.mockReturnValue(streamTextResult('["User has a dog."]'));
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
    mockStreamText.mockReturnValue(streamTextResult('["User has a dog."]'));
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
    mockStreamText.mockReturnValue(streamTextResult('["User uses macOS."]'));
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
    mockStreamText.mockReturnValue(streamTextError(new Error("API error")));

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
    mockStreamText.mockReturnValue(streamTextResult('"not an array"'));

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

  it("sends the raw user message as the LLM prompt", async () => {
    mockStreamText.mockReturnValue(streamTextResult("[]"));
    mockReadAppFile.mockResolvedValue(null);

    await extractAndStoreMemories(
      "I'm looking for the best coffee beans for espresso",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "I'm looking for the best coffee beans for espresso",
      }),
    );
  });

  it("saves a preference extracted from a research query when the LLM returns one", async () => {
    mockStreamText.mockReturnValue(streamTextResult('["User drinks espresso."]'));
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "I'm looking for the best coffee beans for espresso",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).toHaveBeenCalledWith({
      subfolder: "search-results/test-folder",
      filename: "memories.md",
      content: "# Memories\n\n- User drinks espresso.\n",
    });
    expect(result).toEqual({ memoriesStored: 1 });
  });

  it("accepts and saves a concise preference over a task restatement", async () => {
    mockStreamText.mockReturnValue(streamTextResult('["User is interested in espresso."]'));
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "I'm looking for the best coffee beans for espresso",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).toHaveBeenCalledWith({
      subfolder: "search-results/test-folder",
      filename: "memories.md",
      content: "# Memories\n\n- User is interested in espresso.\n",
    });
    expect(result).toEqual({ memoriesStored: 1 });
  });

  it("returns empty when the LLM returns empty array for a research query", async () => {
    mockStreamText.mockReturnValue(streamTextResult("[]"));

    const result = await extractAndStoreMemories(
      "Find me the latest news about AI",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).not.toHaveBeenCalled();
    expect(result).toEqual({ memoriesStored: 0 });
  });

  it("handles malformed LLM output gracefully", async () => {
    mockStreamText.mockReturnValue(streamTextResult("This is not JSON at all"));

    const result = await extractAndStoreMemories(
      "I'm looking for the best coffee beans for espresso",
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

  it("handles empty LLM text output gracefully", async () => {
    mockStreamText.mockReturnValue(streamTextResult(""));

    const result = await extractAndStoreMemories(
      "I'm looking for the best coffee beans for espresso",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).not.toHaveBeenCalled();
    expect(result).toEqual({ memoriesStored: 0 });
  });
});
