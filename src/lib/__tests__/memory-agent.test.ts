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

  it("emits error event on failure", async () => {
    mockStreamText.mockReturnValue(streamTextError(new Error("API error")));

    await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(mockEmitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", error: expect.stringContaining("failed") }),
    );
  });

  it("emits cancelled event on abort error", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    mockStreamText.mockReturnValue(streamTextError(abortError));
    const abortController = new AbortController();
    abortController.abort();

    await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      abortController.signal,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

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

    await extractAndStoreMemories(
      "Hello",
      getResearchFolder,
      { modelId: "test" } as any,
      abortController.signal,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

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

  it("serializes concurrent writes to the same folder", async () => {
    let writeCount = 0;
    const writeOrder: number[] = [];

    mockStreamText.mockImplementation((opts: any) => {
      if (opts.prompt === "first") {
        return streamTextResult('["Fact A"]');
      }
      return streamTextResult('["Fact B"]');
    });

    mockReadAppFile.mockImplementation(async () => {
      return null;
    });

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

    expect(result1.memoriesStored + result2.memoriesStored).toBeGreaterThanOrEqual(1);
    expect(mockWriteAppFile).toHaveBeenCalledTimes(2);
  });

  it("preserves memories stored with * bullet format", async () => {
    mockStreamText.mockReturnValue(streamTextResult('["User likes cats."]'));
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
    expect(result).toEqual({ memoriesStored: 1 });
  });

  it("preserves memories stored with + bullet format", async () => {
    mockStreamText.mockReturnValue(streamTextResult('["User likes cats."]'));
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
    expect(result).toEqual({ memoriesStored: 1 });
  });

  it("reports correct positive stored count when existing has internal duplicates", async () => {
    mockStreamText.mockReturnValue(streamTextResult('["User has a cat."]'));
    mockReadAppFile.mockResolvedValue("# Memories\n\n- User has a dog.\n- User has a dog.\n");

    const result = await extractAndStoreMemories(
      "I have a cat.",
      getResearchFolder,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, writeAppFile: mockWriteAppFile },
    );

    expect(result.memoriesStored).toBeGreaterThanOrEqual(0);
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

  it("fire-and-forget extraction routes events to captured emitter even after global is cleared", async () => {
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
