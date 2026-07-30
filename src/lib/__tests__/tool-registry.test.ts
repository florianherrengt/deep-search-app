import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  generateText: vi.fn(),
}));

const emitterMocks = vi.hoisted(() => ({
  emitSubAgentEvent: vi.fn(),
  createSubAgentId: vi.fn(),
}));

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
}));

const googleRendererMocks = vi.hoisted(() => ({
  webview: vi.fn(),
  chrome: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: aiMocks.streamText,
    generateText: aiMocks.generateText,
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

vi.mock("@/lib/managed-webview", () => ({
  renderWithManagedWebview: googleRendererMocks.webview,
}));

vi.mock("@/tools/chrome-mcp-page-loader", () => ({
  renderWithManagedChromeMcp: googleRendererMocks.chrome,
  createChromeMcpPageLoader: vi.fn(() => ({
    fetchHtml: undefined,
    renderHtml: vi.fn(),
  })),
}));

vi.mock("@/lib/tauri-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri-bridge")>();
  return {
    ...actual,
    isTauri: tauriMocks.isTauri,
  };
});

import { createTools } from "@/lib/transport/tool-registry";

type ToolByName = Record<string, { description?: string } | undefined>;
type ExecutableToolByName = Record<
  string,
  | {
      execute?: (
        input: unknown,
        options: unknown,
      ) => Promise<unknown> | unknown;
    }
  | undefined
>;

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
    tauriMocks.isTauri.mockReturnValue(true);
    emitterMocks.createSubAgentId.mockReturnValue("sa-registry-1");
    const googleHtml = `
      <div id="search"><div id="rso"><div class="g">
        <a href="https://example.com/result"><h3>Example result</h3></a>
        <div class="VwiC3b">Rendered browser result.</div>
      </div></div></div>
    `;
    googleRendererMocks.webview.mockResolvedValue(googleHtml);
    googleRendererMocks.chrome.mockResolvedValue(googleHtml);
    const googleExtraction = {
      status: "results" as const,
      results: [
        {
          title: "Example result",
          url: "https://example.com/result",
          description: "Rendered browser result.",
        },
      ],
    };
    aiMocks.generateText.mockResolvedValue({
      text: JSON.stringify(googleExtraction),
      output: googleExtraction,
      finishReason: "stop",
      reasoningText: undefined,
    });
  });

  it("registers create_research_plan with live sub-agent text streaming from the core planner prompt", async () => {
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

  it("passes an injected chat-scoped emitter to sub-agent-producing tools", async () => {
    aiMocks.streamText.mockReturnValueOnce(mockStreamText(["scoped plan"]));
    const emitEvent = vi.fn();

    const tools = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
      emitEvent,
    });

    await tools.create_research_plan.execute?.(
      { query: "test" },
      {
        toolCallId: "plan-call-scoped",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "ask-questions-scoped",
                toolName: "ask_questions",
                input: {},
              },
            ],
          },
        ],
      },
    );

    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "start", id: "sa-registry-1" }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text-delta", delta: "scoped plan" }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "complete", id: "sa-registry-1" }),
    );
    expect(emitterMocks.emitSubAgentEvent).not.toHaveBeenCalled();
  });

  it("registers YouTube search from the configured key without exposing subtitle-only extraction", async () => {
    const toolsWithoutKey = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
    });

    const toolsWithoutKeyByName = toolsWithoutKey as ToolByName;
    expect(toolsWithoutKeyByName.youtube_search).toBeUndefined();
    expect(toolsWithoutKeyByName.youtube_download_subtitles).toBeUndefined();

    const toolsWithKey = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
      searchKeys: { youtubeApiKey: "youtube-key" },
    });

    const toolsWithKeyByName = toolsWithKey as ToolByName;
    expect(toolsWithKeyByName.youtube_search).toBeTruthy();
    expect(toolsWithKeyByName.youtube_download_subtitles).toBeUndefined();
    expect(toolsWithKeyByName.extract_page_content).toBeTruthy();
    expect(
      (toolsWithKeyByName.youtube_search?.description ?? ""),
    ).toContain("video evidence could matter");
    expect(
      (toolsWithKeyByName.youtube_search?.description ?? ""),
    ).toContain("extract_page_content");
  });

  it("registers standalone keyless Google search in Tauri sessions", async () => {
    const tools = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
    });
    const toolsByName = tools as ToolByName;

    expect(toolsByName.google_search).toBeTruthy();
    expect(toolsByName.google_search?.description).toContain(
      "does not require a Google Search API key",
    );
    expect(toolsByName.google_search?.description).toContain(
      "first general web search",
    );
  });

  it("does not register Google search when the user disables it", async () => {
    const tools = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
      searchKeys: { googleSearchEnabled: false },
    });

    expect((tools as ToolByName).google_search).toBeUndefined();
  });

  it("registers Google before other general web-search tools", async () => {
    const tools = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
      searchKeys: { braveApiKey: "brave-key" },
    });
    const names = Object.keys(tools);

    expect(names.indexOf("google_search")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("google_search")).toBeLessThan(
      names.indexOf("brave_search"),
    );
  });

  it("does not register Google search in browser-only sessions", async () => {
    tauriMocks.isTauri.mockReturnValue(false);

    const tools = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
    });

    expect((tools as ToolByName).google_search).toBeUndefined();
  });

  it("routes chat Google search through the built-in WebView by default", async () => {
    const tools = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
    });

    await (tools as unknown as ExecutableToolByName).google_search?.execute?.(
      { query: "test query" },
      { toolCallId: "google-call", messages: [] },
    );

    expect(googleRendererMocks.webview).toHaveBeenCalledWith(
      "https://www.google.com/search?q=test+query&num=10",
      expect.objectContaining({ throwOnError: true }),
    );
    expect(googleRendererMocks.chrome).not.toHaveBeenCalled();
  });

  it("routes chat Google search through Chrome only when explicitly selected", async () => {
    const tools = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
      searchKeys: {
        chromeDevToolsMcpEnabled: true,
        webExtractionBackend: "chrome-mcp",
        chromeDevToolsMcpConnectionMode: "browser-url",
        chromeDevToolsMcpBrowserUrl: "http://127.0.0.1:9222",
        chromeDevToolsMcpNodePath: "/custom/node",
      },
    });

    await (tools as unknown as ExecutableToolByName).google_search?.execute?.(
      { query: "test" },
      { toolCallId: "google-call", messages: [] },
    );

    expect(googleRendererMocks.chrome).toHaveBeenCalledWith(
      "https://www.google.com/search?q=test&num=10",
      {
        connectionMode: "browser-url",
        browserUrl: "http://127.0.0.1:9222",
        nodePath: "/custom/node",
      },
      expect.objectContaining({ onHumanVerification: expect.any(Function) }),
    );
    expect(googleRendererMocks.webview).not.toHaveBeenCalled();
  });

  it("registers currency conversion only when a target currency is configured", async () => {
    const toolsWithoutTarget = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
    });

    expect((toolsWithoutTarget as ToolByName).currency_conversion).toBeUndefined();

    const toolsWithTarget = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
      searchKeys: { currency: "GBP" },
    });

    expect((toolsWithTarget as ToolByName).currency_conversion?.description).toContain(
      "GBP",
    );
  });

  it("marks aggregate search as separate from Reddit and YouTube source passes", async () => {
    const tools = await createTools({
      model: makeModel(),
      getResearchFolder: async () => "folder",
      switchResearchFolder: vi.fn(),
      searchKeys: {
        braveApiKey: "brave-key",
        youtubeApiKey: "youtube-key",
      },
    });
    const toolsByName = tools as ToolByName;

    expect(toolsByName.aggregate_search?.description ?? "").toContain(
      "does not call google_search or youtube_search",
    );
    expect(toolsByName.aggregate_search?.description ?? "").toContain(
      "site:reddit.com",
    );
    expect(toolsByName.brave_search?.description ?? "").toContain(
      "site:reddit.com",
    );
    expect(toolsByName.brave_search?.description ?? "").toContain(
      "site:youtube.com/watch",
    );
  });
});
