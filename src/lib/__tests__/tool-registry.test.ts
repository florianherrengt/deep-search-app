import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  streamText: vi.fn(),
}));

const emitterMocks = vi.hoisted(() => ({
  emitSubAgentEvent: vi.fn(),
  createSubAgentId: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: aiMocks.streamText,
  };
});

vi.mock("@/lib/sub-agent-emitter", () => ({
  emitSubAgentEvent: emitterMocks.emitSubAgentEvent,
}));

vi.mock("@/lib/sub-agent-types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sub-agent-types")>();
  return {
    ...actual,
    createSubAgentId: emitterMocks.createSubAgentId,
  };
});

vi.mock("@/lib/mcp/chrome-devtools-tools", () => ({
  createChromeDevToolsMcpTools: vi.fn(async () => ({})),
}));

import { createTools } from "@/lib/transport/tool-registry";

function makeModel() {
  return { modelId: "test", doGenerate: async () => ({}) } as never;
}

function mockStreamText(chunks: string[]) {
  const textResult = chunks.join("");
  return {
    textStream: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
    text: Promise.resolve(textResult),
  };
}

describe("createTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emitterMocks.createSubAgentId.mockReturnValue("sa-registry-1");
  });

  it("registers create_research_plan with live sub-agent text streaming", async () => {
    aiMocks.streamText.mockReturnValueOnce(mockStreamText(["plan ", "chunk"]));

    const tools = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
    });

    const result = await tools.create_research_plan.execute?.(
      { query: "test" },
      {
        toolCallId: "plan-call-1",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "ask-questions-1",
                toolName: "ask_questions",
                input: {},
              },
            ],
          },
        ],
      },
    );

    expect(result).toBe("plan chunk");
    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "start",
        id: "sa-registry-1",
        displayTarget: { type: "toolCall", toolCallId: "plan-call-1" },
      }),
    );
    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "text-delta",
        id: "sa-registry-1",
        delta: "plan ",
      }),
    );
    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "text-delta",
        id: "sa-registry-1",
        delta: "chunk",
      }),
    );
  });

  it("registers YouTube search from the configured key without exposing subtitle-only extraction", async () => {
    const toolsWithoutKey = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
    });

    const toolsWithoutKeyByName = toolsWithoutKey as Record<string, unknown>;
    expect(toolsWithoutKeyByName.youtube_search).toBeUndefined();
    expect(toolsWithoutKeyByName.youtube_download_subtitles).toBeUndefined();

    const toolsWithKey = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
      searchKeys: { youtubeApiKey: "youtube-key" },
    });

    const toolsWithKeyByName = toolsWithKey as Record<string, unknown>;
    expect(toolsWithKeyByName.youtube_search).toBeTruthy();
    expect(toolsWithKeyByName.youtube_download_subtitles).toBeUndefined();
    expect(toolsWithKeyByName.extract_page_content).toBeTruthy();
  });
});
