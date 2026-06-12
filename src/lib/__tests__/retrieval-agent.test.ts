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

vi.mock("@/lib/sub-agent-emitter", () => ({
  emitSubAgentEvent: mockEmitSubAgentEvent,
}));

import { runRetrievalAgent } from "@/lib/retrieval-agent";
import type { SearchResult } from "@/lib/research-search";

function streamTextResult(text: string) {
  return {
    textStream: (async function* () { yield text; })(),
    text: Promise.resolve(text),
  };
}

type ReadAppFileFn = (input: { subfolder: string; filename: string }) => Promise<string | null>;
type ListAppFilesFn = (input: { subfolder: string }) => Promise<string[]>;

const sampleResults: SearchResult[] = [
  {
    chunk_id: 1,
    content: "Hiking trail notes with elevation data",
    filename: "notes.md",
    folder_name: "hiking-trails",
    header_path: null,
    score: 0.9,
    adjacent_chunks: null,
  },
  {
    chunk_id: 2,
    content: "User has a dog.",
    filename: "memories.md",
    folder_name: "hiking-trails",
    header_path: null,
    score: 0.7,
    adjacent_chunks: null,
  },
];

describe("runRetrievalAgent", () => {
  let mockReadAppFile: ReturnType<typeof vi.fn<ReadAppFileFn>>;
  let mockListAppFiles: ReturnType<typeof vi.fn<ListAppFilesFn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadAppFile = vi.fn<ReadAppFileFn>().mockResolvedValue(null);
    mockListAppFiles = vi.fn<ListAppFilesFn>().mockResolvedValue([]);
  });

  it("returns relevant folders from agent output", async () => {
    mockStreamText.mockReturnValue(streamTextResult('{"relevant_folders": ["hiking-trails"], "relevant_memories": []}'));

    const result = await runRetrievalAgent(
      "Find my hiking research",
      sampleResults,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, listAppFiles: mockListAppFiles },
    );

    expect(result).toEqual({ relevant_folders: ["hiking-trails"], relevant_memories: [] });
  });

  it("emits nested tool calls from agent tool callbacks", async () => {
    mockStreamText.mockImplementation(
      ({ onChunk }: any) => {
        onChunk?.({ chunk: { type: "tool-call", toolCallId: "tc-list-files", toolName: "list_files", input: { folder: "hiking-trails" } } } as any);
        onChunk?.({ chunk: { type: "tool-result", toolCallId: "tc-list-files", output: ["notes.md"] } } as any);

        return streamTextResult('{"relevant_folders": ["hiking-trails"], "relevant_memories": []}');
      },
    );

    await runRetrievalAgent(
      "Find my hiking research",
      sampleResults,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, listAppFiles: mockListAppFiles },
    );

    expect(mockEmitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "start", name: "Research Recall" }),
    );
    expect(mockEmitSubAgentEvent).toHaveBeenCalledWith({
      type: "tool-call",
      id: expect.any(String),
      toolCall: {
        toolCallId: "tc-list-files",
        toolName: "list_files",
        args: { folder: "hiking-trails" },
        status: "running",
      },
    });
    expect(mockEmitSubAgentEvent).toHaveBeenCalledWith({
      type: "tool-result",
      id: expect.any(String),
      toolCallId: "tc-list-files",
      toolCallIndex: 0,
      result: ["notes.md"],
      status: "complete",
    });
  });

  it("returns relevant memories from agent output", async () => {
    mockStreamText.mockReturnValue(streamTextResult('{"relevant_folders": [], "relevant_memories": ["User has a dog."]}'));

    const result = await runRetrievalAgent(
      "Find dog-friendly hikes",
      sampleResults,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, listAppFiles: mockListAppFiles },
    );

    expect(result).toEqual({ relevant_folders: [], relevant_memories: ["User has a dog."] });
  });

  it("returns both folders and memories", async () => {
    mockStreamText.mockReturnValue(streamTextResult('{"relevant_folders": ["hiking-trails"], "relevant_memories": ["User has a dog."]}'));

    const result = await runRetrievalAgent(
      "Find dog-friendly hikes",
      sampleResults,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, listAppFiles: mockListAppFiles },
    );

    expect(result).toEqual({ relevant_folders: ["hiking-trails"], relevant_memories: ["User has a dog."] });
  });

  it("returns empty defaults when agent returns no matches", async () => {
    mockStreamText.mockReturnValue(streamTextResult('{"relevant_folders": [], "relevant_memories": []}'));

    const result = await runRetrievalAgent(
      "Query",
      sampleResults,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, listAppFiles: mockListAppFiles },
    );

    expect(result).toEqual({ relevant_folders: [], relevant_memories: [] });
  });

  it("returns empty defaults on failure", async () => {
    mockStreamText.mockImplementation(() => {
      throw new Error("API error");
    });

    const result = await runRetrievalAgent(
      "Query",
      sampleResults,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, listAppFiles: mockListAppFiles },
    );

    expect(result).toEqual({ relevant_folders: [], relevant_memories: [] });
  });

  it("returns empty defaults when given empty results", async () => {
    const result = await runRetrievalAgent(
      "Query",
      [],
      { modelId: "test" } as any,
    );

    expect(result).toEqual({ relevant_folders: [], relevant_memories: [] });
  });

  it("filters out folder names not in candidates", async () => {
    mockStreamText.mockReturnValue(streamTextResult('{"relevant_folders": ["hiking-trails", "nonexistent-folder"], "relevant_memories": []}'));

    const result = await runRetrievalAgent(
      "Query",
      sampleResults,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, listAppFiles: mockListAppFiles },
    );

    expect(result.relevant_folders).toEqual(["hiking-trails"]);
  });

  it("parses JSON embedded in text", async () => {
    mockStreamText.mockReturnValue(
      streamTextResult('Here are the results:\n{"relevant_folders": ["hiking-trails"], "relevant_memories": ["User has a dog."]}\nDone.'),
    );

    const result = await runRetrievalAgent(
      "Query",
      sampleResults,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, listAppFiles: mockListAppFiles },
    );

    expect(result).toEqual({ relevant_folders: ["hiking-trails"], relevant_memories: ["User has a dog."] });
  });

  it("handles malformed JSON gracefully", async () => {
    mockStreamText.mockReturnValue(streamTextResult("not json at all"));

    const result = await runRetrievalAgent(
      "Query",
      sampleResults,
      { modelId: "test" } as any,
      undefined,
      { readAppFile: mockReadAppFile, listAppFiles: mockListAppFiles },
    );

    expect(result).toEqual({ relevant_folders: [], relevant_memories: [] });
  });

  describe("with memories.md in search results", () => {
    const memoriesResults: SearchResult[] = [
      {
        chunk_id: 10,
        content: "User has a golden retriever named Max. User lives in Zurich.",
        filename: "memories.md",
        folder_name: "pet-research",
        header_path: null,
        score: 0.85,
        adjacent_chunks: null,
      },
      {
        chunk_id: 11,
        content: "Best dog parks in the city",
        filename: "notes.md",
        folder_name: "pet-research",
        header_path: null,
        score: 0.8,
        adjacent_chunks: null,
      },
    ];

    it("agent can read full memories.md via scoped read_file tool", async () => {
      mockListAppFiles.mockResolvedValue(["memories.md", "notes.md", "summary.md"]);
      mockReadAppFile.mockImplementation(async ({ subfolder: _subfolder, filename }) => {
        if (filename === "memories.md") {
          return "- User has a golden retriever named Max\n- User lives in Zurich\n- User prefers off-leash dog parks";
        }
        return null;
      });

      let capturedTools: Record<string, any> = {};
      mockStreamText.mockImplementation(({ tools }: any) => {
        capturedTools = tools;
        return streamTextResult('{"relevant_folders": ["pet-research"], "relevant_memories": ["User has a golden retriever named Max", "User lives in Zurich"]}');
      });

      const result = await runRetrievalAgent(
        "Find good dog parks near me",
        memoriesResults,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, listAppFiles: mockListAppFiles },
      );

      expect(capturedTools.list_files).toBeDefined();
      expect(capturedTools.read_file).toBeDefined();
      expect(result.relevant_memories).toEqual([
        "User has a golden retriever named Max",
        "User lives in Zurich",
      ]);
    });

    it("scoped tools reject folders not in candidate set", async () => {
      mockStreamText.mockImplementation(async ({ tools }: any) => {
        const listResult = await tools.list_files.execute({ folder: "unrelated-folder" }, { toolCallId: "t1", messages: [] });
        const readResult = await tools.read_file.execute({ folder: "unrelated-folder", filename: "memories.md" }, { toolCallId: "t2", messages: [] });

        expect(listResult).toMatch(/not in the candidate list/);
        expect(readResult).toMatch(/not in the candidate list/);

        return streamTextResult('{"relevant_folders": [], "relevant_memories": []}');
      });

      await runRetrievalAgent(
        "Query",
        memoriesResults,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, listAppFiles: mockListAppFiles },
      );
    });

    it("scoped read_file returns memories.md content from valid folder", async () => {
      const memoriesContent = "- User has a golden retriever named Max\n- User lives in Zurich";
      mockReadAppFile.mockImplementation(async ({ subfolder, filename }) => {
        if (filename === "memories.md" && subfolder.includes("pet-research")) {
          return memoriesContent;
        }
        return null;
      });

      let readFileResult: any = null;
      mockStreamText.mockImplementation(({ tools }: any) => {
        const textPromise = (async () => {
          readFileResult = await tools.read_file.execute({ folder: "pet-research", filename: "memories.md" }, { toolCallId: "t1", messages: [] });
          return '{"relevant_folders": ["pet-research"], "relevant_memories": ["User has a golden retriever named Max"]}';
        })();
        return {
          textStream: (async function* () { yield await textPromise; })(),
          text: textPromise,
        };
      });

      const result = await runRetrievalAgent(
        "Find dog parks",
        memoriesResults,
        { modelId: "test" } as any,
        undefined,
        { readAppFile: mockReadAppFile, listAppFiles: mockListAppFiles },
      );

      expect(readFileResult).toBe(memoriesContent);
      expect(result.relevant_folders).toContain("pet-research");
    });
  });
});
