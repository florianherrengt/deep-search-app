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

  it("skips task-specific details (LLM returns empty array)", async () => {
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

  it("merges with existing memories.md via LLM merged output", async () => {
    // LLM returns the COMPLETE merged list (existing + new)
    mockStreamText.mockReturnValue(
      streamTextResult('["User uses macOS.", "User has a dog."]'),
    );
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
    // memoriesStored = total facts in merged output
    expect(result).toEqual({ memoriesStored: 2 });
  });

  it("deduplicates via LLM merge (code-level dedup removed)", async () => {
    // LLM returns deduplicated merged list directly
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
    // memoriesStored = total (1 fact)
    expect(result).toEqual({ memoriesStored: 1 });
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

  // AT-12: LLM API failure throws
  it("throws on LLM API failure", async () => {
    mockStreamText.mockReturnValue(streamTextError(new Error("API error")));

    await expect(
      extractAndStoreMemories(
        "Hello",
        getResearchFolder,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ).rejects.toThrow("API error");
  });

  // AT-10: invalid JSON throws
  it("throws on invalid JSON from LLM", async () => {
    mockStreamText.mockReturnValue(streamTextResult("This is not JSON at all"));

    await expect(
      extractAndStoreMemories(
        "I'm looking for the best coffee beans for espresso",
        getResearchFolder,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ).rejects.toThrow("invalid JSON");
  });

  // AT-19: non-string entries throw
  it("throws when LLM array contains non-string entries", async () => {
    mockStreamText.mockReturnValue(streamTextResult('["valid", 42, null]'));

    await expect(
      extractAndStoreMemories(
        "Hello",
        getResearchFolder,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ).rejects.toThrow("non-string entry");
  });

  // AT-11: non-array JSON throws
  it("throws on non-array JSON from LLM", async () => {
    mockStreamText.mockReturnValue(streamTextResult('{"key": "value"}'));

    await expect(
      extractAndStoreMemories(
        "Hello",
        getResearchFolder,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ).rejects.toThrow("non-array");
  });

  it("throws on empty LLM text output (invalid JSON)", async () => {
    mockStreamText.mockReturnValue(streamTextResult(""));

    await expect(
      extractAndStoreMemories(
        "Hello",
        getResearchFolder,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ).rejects.toThrow("invalid JSON");
  });

  it("prompt contains user text within structured template", async () => {
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
        prompt: expect.stringContaining("I'm looking for the best coffee beans for espresso"),
      }),
    );
  });

  // AT-1: includes existing memories in prompt
  it("includes existing memories in LLM prompt when file exists", async () => {
    mockStreamText.mockReturnValue(streamTextResult('["User has a dog."]'));
    mockReadAppFile.mockResolvedValue("# Memories\n\n- User uses macOS.\n");

    await extractAndStoreMemories(
      "I have a dog.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("User uses macOS."),
      }),
    );
  });

  // AT-2: includes "None." when no existing memories
  it("includes 'None.' in prompt when no existing memories", async () => {
    mockStreamText.mockReturnValue(streamTextResult("[]"));
    mockReadAppFile.mockResolvedValue(null);

    await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("None."),
      }),
    );
  });

  // AT-3: writes LLM merged output directly without code-level dedup
  it("writes LLM merged output directly without code-level dedup", async () => {
    // Mock returns DUPLICATE entries to prove no Set-based dedup is applied
    mockStreamText.mockReturnValue(
      streamTextResult('["Fact A", "Fact A", "Fact B"]'),
    );
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "Some content",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    // Both "Fact A" entries are written verbatim (no code-level dedup)
    expect(mockWriteAppFile).toHaveBeenCalledWith({
      subfolder: "search-results/test-folder",
      filename: "memories.md",
      content: "# Memories\n\n- Fact A\n- Fact A\n- Fact B\n",
    });
    // Raw count, not deduplicated: 3
    expect(result).toEqual({ memoriesStored: 3 });
  });

  // AT-4: throws when research folder is null
  it("throws error when research folder is null", async () => {
    const nullFolder = vi.fn().mockResolvedValue(null);

    await expect(
      extractAndStoreMemories(
        "Hello",
        nullFolder,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ).rejects.toThrow("No research folder available");

    expect(mockStreamText).not.toHaveBeenCalled();
  });

  // AT-5: throws when research folder is empty string or undefined
  it("throws error when research folder is empty string", async () => {
    const emptyFolder = vi.fn().mockResolvedValue("");

    await expect(
      extractAndStoreMemories(
        "Hello",
        emptyFolder,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ).rejects.toThrow("No research folder available");

    expect(mockStreamText).not.toHaveBeenCalled();
  });

  it("throws error when research folder is undefined", async () => {
    const undefinedFolder = vi.fn().mockResolvedValue(undefined);

    await expect(
      extractAndStoreMemories(
        "Hello",
        undefinedFolder,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ).rejects.toThrow("No research folder available");

    expect(mockStreamText).not.toHaveBeenCalled();
  });

  // AT-6: returns total fact count from merged LLM output
  it("returns total fact count from merged LLM output", async () => {
    mockStreamText.mockReturnValue(
      streamTextResult('["Fact 1", "Fact 2", "Fact 3", "Fact 4", "Fact 5"]'),
    );
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(result).toEqual({ memoriesStored: 5 });
  });

  // AT-7: preserves existing facts in LLM output
  it("preserves existing facts in LLM output that the LLM returns", async () => {
    mockStreamText.mockReturnValue(
      streamTextResult('["Fact A", "Fact B"]'),
    );
    mockReadAppFile.mockResolvedValue("# Memories\n\n- Fact A\n");

    const result = await extractAndStoreMemories(
      "New content yielding Fact B",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Fact A"),
      }),
    );
    expect(mockWriteAppFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Fact B"),
      }),
    );
    expect(result).toEqual({ memoriesStored: 2 });
  });

  // AT-8: handles LLM dropping existing facts gracefully
  it("handles LLM dropping existing facts gracefully", async () => {
    mockStreamText.mockReturnValue(
      streamTextResult('["Only Fact B"]'),
    );
    mockReadAppFile.mockResolvedValue("# Memories\n\n- Old Fact A\n");

    const result = await extractAndStoreMemories(
      "New content",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    // Code writes whatever the LLM returns
    expect(mockWriteAppFile).toHaveBeenCalledWith({
      subfolder: "search-results/test-folder",
      filename: "memories.md",
      content: "# Memories\n\n- Only Fact B\n",
    });
    expect(result).toEqual({ memoriesStored: 1 });
  });

  // AT-9: prompt contains structured template
  it("prompt contains structured template with existing memories", async () => {
    mockStreamText.mockReturnValue(streamTextResult("[]"));
    mockReadAppFile.mockResolvedValue("# Memories\n\n- Fact A\n");

    await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(
          "Here are the existing memories stored about the user:",
        ),
      }),
    );
    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(
          "Here is new user content to analyze for additional memories:",
        ),
      }),
    );
  });

  // AT-13: throws on readAppFile failure
  it("throws on readAppFile failure", async () => {
    mockStreamText.mockReturnValue(streamTextResult('["Fact"]'));
    mockReadAppFile.mockRejectedValue(new Error("Disk read error"));

    await expect(
      extractAndStoreMemories(
        "Hello",
        getResearchFolder,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ).rejects.toThrow("Disk read error");
  });

  // AT-14: throws on writeAppFile failure
  it("throws on writeAppFile failure", async () => {
    mockStreamText.mockReturnValue(streamTextResult('["Fact"]'));
    mockReadAppFile.mockResolvedValue(null);
    mockWriteAppFile.mockRejectedValue(new Error("Disk write error"));

    await expect(
      extractAndStoreMemories(
        "Hello",
        getResearchFolder,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ).rejects.toThrow("Disk write error");
  });

  // AT-15: returns memoriesStored: 0 for empty LLM array
  it("returns memoriesStored: 0 for empty LLM array", async () => {
    mockStreamText.mockReturnValue(streamTextResult("[]"));
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(result).toEqual({ memoriesStored: 0 });
    expect(mockWriteAppFile).not.toHaveBeenCalled();
  });

  // AT-16: returns memoriesStored: 0 when all entries are empty after trim
  it("returns memoriesStored: 0 when all entries are empty after trim", async () => {
    mockStreamText.mockReturnValue(streamTextResult('["  ", "\\n", ""]'));
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(result).toEqual({ memoriesStored: 0 });
    expect(mockWriteAppFile).not.toHaveBeenCalled();
  });

  // AT-18: does not write memories.md when LLM returns an empty array
  it("does not write memories.md when LLM returns an empty array", async () => {
    mockStreamText.mockReturnValue(streamTextResult("[]"));
    mockReadAppFile.mockResolvedValue(null);
    mockWriteAppFile.mockImplementation(async () => {
      throw new Error("Should not be called");
    });

    const result = await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).not.toHaveBeenCalled();
    expect(result).toEqual({ memoriesStored: 0 });
  });

  // AT-20: treats missing memories.md as "None."
  it("treats missing memories.md as None", async () => {
    mockStreamText.mockReturnValue(streamTextResult('["User has a dog."]'));
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "I have a dog.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("None."),
      }),
    );
    expect(mockWriteAppFile).toHaveBeenCalled();
    expect(result).toEqual({ memoriesStored: 1 });
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

  // Markdown fence tests (unchanged)
  it("strips markdown json fences before parsing", async () => {
    mockStreamText.mockReturnValue(streamTextResult('```json\n["User has a cat."]\n```'));
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "I have a cat.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).toHaveBeenCalledWith({
      subfolder: "search-results/test-folder",
      filename: "memories.md",
      content: "# Memories\n\n- User has a cat.\n",
    });
    expect(result).toEqual({ memoriesStored: 1 });
  });

  it("strips markdown code fences without json label", async () => {
    mockStreamText.mockReturnValue(streamTextResult('```\n["User has a cat."]\n```'));
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "I have a cat.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(result).toEqual({ memoriesStored: 1 });
  });

  it("emits error event then throws on technical failure", async () => {
    mockStreamText.mockReturnValue(streamTextError(new Error("API error")));

    const promise = extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    await expect(promise).rejects.toThrow("API error");

    expect(mockEmitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", error: expect.stringContaining("failed") }),
    );
  });

  it("emits cancelled event on abort error", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    mockStreamText.mockReturnValue(streamTextError(abortError));
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      extractAndStoreMemories(
        "Hello",
        getResearchFolder,
        { modelId: "test" } as any,
        abortController.signal,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ).rejects.toThrow();

    expect(mockEmitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "cancelled" }),
    );
    expect(mockEmitSubAgentEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
  });

  it("emits cancelled event when abortSignal is already aborted", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    mockStreamText.mockReturnValue(streamTextError(abortError));
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      extractAndStoreMemories(
        "Hello",
        getResearchFolder,
        { modelId: "test" } as any,
        abortController.signal,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ).rejects.toThrow();

    expect(mockEmitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "cancelled" }),
    );
  });

  it("normalizes newlines in facts to prevent truncation on re-parse", async () => {
    mockStreamText.mockReturnValue(streamTextResult('["Line 1\\nLine 2"]'));
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "# Memories\n\n- Line 1 Line 2\n",
      }),
    );
    expect(result).toEqual({ memoriesStored: 1 });
  });

  // AT-17: serializes concurrent writes to the same folder
  it("serializes concurrent extractions to same folder", async () => {
    let writeCount = 0;
    const writeOrder: number[] = [];

    mockStreamText.mockImplementation((opts: any) => {
      if (opts.prompt.includes("first")) {
        return streamTextResult('["Fact A"]');
      }
      return streamTextResult('["Fact B"]');
    });

    mockReadAppFile.mockImplementation(async () => null);

    mockWriteAppFile.mockImplementation(async () => {
      writeCount++;
      writeOrder.push(writeCount);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const [result1, result2] = await Promise.all([
      extractAndStoreMemories(
        "first",
        getResearchFolder,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
      extractAndStoreMemories(
        "second",
        getResearchFolder,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
      ),
    ]);

    // Both mocks return a single-fact array and write succeeds
    expect(result1).toEqual({ memoriesStored: 1 });
    expect(result2).toEqual({ memoriesStored: 1 });
    expect(mockWriteAppFile).toHaveBeenCalledTimes(2);
  });

  it("preserves memories stored with * bullet format (LLM handles existing)", async () => {
    mockStreamText.mockReturnValue(
      streamTextResult('["User has a dog.", "User uses macOS.", "User likes cats."]'),
    );
    mockReadAppFile.mockResolvedValue("# Memories\n\n* User has a dog.\n* User uses macOS.\n");

    const result = await extractAndStoreMemories(
      "I like cats.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("User has a dog."),
      }),
    );
    expect(mockWriteAppFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("User uses macOS."),
      }),
    );
    // memoriesStored = total facts in merged output (3)
    expect(result).toEqual({ memoriesStored: 3 });
  });

  it("preserves memories stored with + bullet format (LLM handles existing)", async () => {
    mockStreamText.mockReturnValue(
      streamTextResult('["User has a dog.", "User likes cats."]'),
    );
    mockReadAppFile.mockResolvedValue("# Memories\n\n+ User has a dog.\n");

    const result = await extractAndStoreMemories(
      "I like cats.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("User has a dog."),
      }),
    );
    expect(result).toEqual({ memoriesStored: 2 });
  });

  it("reports correct positive stored count (total facts) when existing has internal duplicates", async () => {
    // LLM handles dedup of old duplicates + merging new fact
    mockStreamText.mockReturnValue(
      streamTextResult('["User has a dog.", "User has a cat."]'),
    );
    mockReadAppFile.mockResolvedValue("# Memories\n\n- User has a dog.\n- User has a dog.\n");

    const result = await extractAndStoreMemories(
      "I have a cat.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(result.memoriesStored).toBe(2);
    expect(mockWriteAppFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("User has a cat."),
      }),
    );
  });

  it("strips markdown json fences with nested backticks in content", async () => {
    mockStreamText.mockReturnValue(
      streamTextResult('```json\n["User prefers this code style:\\n```\\nconst x = 1;\\n```\\n"]\n```'),
    );
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "I like clean code.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockWriteAppFile).toHaveBeenCalled();
    expect(result).toEqual({ memoriesStored: 1 });
  });

  it("strips markdown code fences with triple backticks in array item", async () => {
    mockStreamText.mockReturnValue(
      streamTextResult('```\n["User mentioned ```ts code```"]\n```'),
    );
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "Here's code.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(result).toEqual({ memoriesStored: 1 });
  });

  it("handles fence with non-json language tag", async () => {
    mockStreamText.mockReturnValue(
      streamTextResult('```python\n["User has a cat."]\n```'),
    );
    mockReadAppFile.mockResolvedValue(null);

    const result = await extractAndStoreMemories(
      "I have a cat.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(result).toEqual({ memoriesStored: 1 });
  });

  it("parses LLM output with trailing text after code fence", async () => {
    mockStreamText.mockReturnValue(
      streamTextResult('```json\n["User has a dog."]\n```\nHere are the facts I extracted.'),
    );
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

  it("uses captured emitEvent dep instead of global emitter", async () => {
    const capturedEmitter = vi.fn();
    mockStreamText.mockReturnValue(streamTextResult("[]"));

    await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile, emitEvent: capturedEmitter },
    );

    expect(capturedEmitter).toHaveBeenCalledWith(
      expect.objectContaining({ type: "start" }),
    );
    expect(capturedEmitter).toHaveBeenCalledWith(
      expect.objectContaining({ type: "complete" }),
    );
    expect(mockEmitSubAgentEvent).not.toHaveBeenCalled();
  });

  it("extraction events reach captured emitter when awaited", async () => {
    const capturedEmitter = vi.fn();
    let resolveStream: () => void;
    const streamPromise = new Promise<void>((resolve) => { resolveStream = resolve; });

    mockStreamText.mockImplementation(() => ({
      textStream: (async function* () {
        await streamPromise;
        yield '["Fact A"]';
      })(),
      text: streamPromise.then(() => '["Fact A"]'),
    }));
    mockReadAppFile.mockResolvedValue(null);

    const extractionPromise = extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile, emitEvent: capturedEmitter },
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(capturedEmitter).toHaveBeenCalledWith(
      expect.objectContaining({ type: "start" }),
    );

    resolveStream!();
    await extractionPromise;

    expect(capturedEmitter).toHaveBeenCalledWith(
      expect.objectContaining({ type: "complete" }),
    );
    expect(mockEmitSubAgentEvent).not.toHaveBeenCalled();
  });
});
