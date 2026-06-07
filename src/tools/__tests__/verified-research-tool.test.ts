import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  streamText: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: aiMocks.streamText,
  };
});

const subAgentMocks = vi.hoisted(() => ({
  collectSubAgentTextStream: vi.fn(),
}));

vi.mock("@/lib/sub-agent-stream", () => ({
  collectSubAgentTextStream: subAgentMocks.collectSubAgentTextStream,
}));

const braveSearchMocks = vi.hoisted(() => ({
  createBraveSearchTool: vi.fn(() => ({})),
}));

vi.mock("@/tools/brave-search-tool", () => ({
  createBraveSearchTool: braveSearchMocks.createBraveSearchTool,
}));

const exaSearchMocks = vi.hoisted(() => ({
  createExaSearchTool: vi.fn(() => ({})),
}));

vi.mock("@/tools/exa-search-tool", () => ({
  createExaSearchTool: exaSearchMocks.createExaSearchTool,
}));

const serperSearchMocks = vi.hoisted(() => ({
  createSerperSearchTool: vi.fn(() => ({})),
}));

vi.mock("@/tools/serper-search-tool", () => ({
  createSerperSearchTool: serperSearchMocks.createSerperSearchTool,
}));

const tavilySearchMocks = vi.hoisted(() => ({
  createTavilySearchTool: vi.fn(() => ({})),
}));

vi.mock("@/tools/tavily-search-tool", () => ({
  createTavilySearchTool: tavilySearchMocks.createTavilySearchTool,
}));

const searxngSearchMocks = vi.hoisted(() => ({
  createSearXNGSearchTool: vi.fn(() => ({})),
}));

vi.mock("@/tools/searxng-search-tool", () => ({
  createSearXNGSearchTool: searxngSearchMocks.createSearXNGSearchTool,
}));

const urlValidationMocks = vi.hoisted(() => ({
  isValidServiceUrl: vi.fn(() => true),
}));

vi.mock("@/lib/url-validation", () => ({
  isValidServiceUrl: urlValidationMocks.isValidServiceUrl,
  isValidUrl: () => true,
}));

const extractPageMocks = vi.hoisted(() => ({
  extractPageContent: vi.fn(),
  extractPageContentInputSchema: {},
}));

vi.mock("@/tools/extract-page-content-tool", () => ({
  extractPageContent: extractPageMocks.extractPageContent,
  extractPageContentInputSchema: extractPageMocks.extractPageContentInputSchema,
}));

import {
  createVerifiedResearchIsGoodTool,
  verifiedResearchInputSchema,
} from "@/tools/verified-research-tool";

function makeModel() {
  return { modelId: "test", doGenerate: async () => ({}) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifiedResearchInputSchema", () => {
  it("accepts the original prompt and final research", () => {
    const result = verifiedResearchInputSchema.safeParse({
      originalPrompt: "Find the dimensions and current price of Product X.",
      summary: "The answer compares Product X against Product Y.",
      finalResearch: "Product X is 10 cm wide and costs $25.",
    });

    expect(result.success).toBe(true);
  });

  it("rejects missing original prompt", () => {
    const result = verifiedResearchInputSchema.safeParse({
      finalResearch: "Product X is 10 cm wide and costs $25.",
    });

    expect(result.success).toBe(false);
  });

  it("rejects missing final research", () => {
    const result = verifiedResearchInputSchema.safeParse({
      originalPrompt: "Find the dimensions and current price of Product X.",
    });

    expect(result.success).toBe(false);
  });
});

describe("createVerifiedResearchIsGoodTool", () => {
  it("describes the isolated verification pass", () => {
    const t = createVerifiedResearchIsGoodTool(makeModel());

    expect(t.description).toContain("isolated verifier");
    expect(t.description).toContain("high-risk factual claims");
  });

  it("creates verification tools based on available search keys", async () => {
    const model = makeModel();
    const searchKeys = {
      braveApiKey: "brave-key",
      exaApiKey: "exa-key",
    };

    subAgentMocks.collectSubAgentTextStream.mockResolvedValueOnce(
      "Verification passed.",
    );
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Verification passed." };
      })(),
    });

    const t = createVerifiedResearchIsGoodTool(model, searchKeys);
    await t.execute!(
      {
        originalPrompt: "Find price of Product X.",
        finalResearch: "Product X costs $25.",
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(braveSearchMocks.createBraveSearchTool).toHaveBeenCalledWith(
      "brave-key",
    );
    expect(exaSearchMocks.createExaSearchTool).toHaveBeenCalledWith("exa-key");
    expect(serperSearchMocks.createSerperSearchTool).not.toHaveBeenCalled();
    expect(tavilySearchMocks.createTavilySearchTool).not.toHaveBeenCalled();
    expect(searxngSearchMocks.createSearXNGSearchTool).not.toHaveBeenCalled();
  });

  it("creates SearXNG search tool when searxngBaseUrl is valid", async () => {
    const model = makeModel();
    const searchKeys = {
      searxngBaseUrl: "http://localhost:8080",
    };

    subAgentMocks.collectSubAgentTextStream.mockResolvedValueOnce(
      "Verification passed.",
    );
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Verification passed." };
      })(),
    });

    const t = createVerifiedResearchIsGoodTool(model, searchKeys);
    await t.execute!(
      {
        originalPrompt: "Find price of Product X.",
        finalResearch: "Product X costs $25.",
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(searxngSearchMocks.createSearXNGSearchTool).toHaveBeenCalledWith(
      "http://localhost:8080",
    );
  });

  it("skips SearXNG search tool when searxngBaseUrl is invalid", async () => {
    const model = makeModel();
    urlValidationMocks.isValidServiceUrl.mockReturnValueOnce(false);

    subAgentMocks.collectSubAgentTextStream.mockResolvedValueOnce(
      "Verification passed.",
    );
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Verification passed." };
      })(),
    });

    const t = createVerifiedResearchIsGoodTool(model, {
      searxngBaseUrl: "invalid",
    });
    await t.execute!(
      {
        originalPrompt: "Find price of Product X.",
        finalResearch: "Product X costs $25.",
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(searxngSearchMocks.createSearXNGSearchTool).not.toHaveBeenCalled();
  });

  it("returns verification text from model stream", async () => {
    const model = makeModel();
    const searchKeys = { braveApiKey: "brave-key" };

    subAgentMocks.collectSubAgentTextStream.mockResolvedValueOnce(
      "Verification found no high-risk factual errors.",
    );
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {
        yield {
          type: "text-delta",
          text: "Verification found no high-risk factual errors.",
        };
      })(),
    });

    const t = createVerifiedResearchIsGoodTool(model, searchKeys);
    const result = await t.execute!(
      {
        originalPrompt: "Find price of Product X.",
        finalResearch: "Product X costs $25.",
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(result).toBe("Verification found no high-risk factual errors.");
  });

  it("returns fallback message when verification produces empty result", async () => {
    const model = makeModel();
    const searchKeys = { braveApiKey: "brave-key" };

    subAgentMocks.collectSubAgentTextStream.mockResolvedValueOnce("   ");
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {
        yield {
          type: "text-delta",
          text: "   ",
        };
      })(),
    });

    const t = createVerifiedResearchIsGoodTool(model, searchKeys);
    const result = await t.execute!(
      {
        originalPrompt: "Find price of Product X.",
        finalResearch: "Product X costs $25.",
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(result).toBe(
      "Verification completed, but no notes were returned.",
    );
  });

  it("propagates abort signal to streamText", async () => {
    const model = makeModel();
    const searchKeys = { braveApiKey: "brave-key" };

    subAgentMocks.collectSubAgentTextStream.mockResolvedValueOnce("OK.");
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "OK." };
      })(),
    });

    const abortController = new AbortController();
    const t = createVerifiedResearchIsGoodTool(model, searchKeys);
    await t.execute!(
      {
        originalPrompt: "Find price of Product X.",
        finalResearch: "Product X costs $25.",
      },
      { abortSignal: abortController.signal, toolCallId: "call-1", messages: [] },
    );

    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: abortController.signal,
        model,
      }),
    );
  });

  it("does not crash when no search keys are provided (no fresh search tools)", async () => {
    const model = makeModel();

    subAgentMocks.collectSubAgentTextStream.mockResolvedValueOnce(
      "No fresh search tools were configured.",
    );
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: (async function* () {
        yield {
          type: "text-delta",
          text: "No fresh search tools were configured.",
        };
      })(),
    });

    const t = createVerifiedResearchIsGoodTool(model);
    const result = await t.execute!(
      {
        originalPrompt: "Find price of Product X.",
        finalResearch: "Product X costs $25.",
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(result).toBe("No fresh search tools were configured.");
    expect(braveSearchMocks.createBraveSearchTool).not.toHaveBeenCalled();
  });
});
