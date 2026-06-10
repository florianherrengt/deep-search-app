import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: aiMocks.generateText,
  };
});

const extractPageMocks = vi.hoisted(() => ({
  extractPageContent: vi.fn(),
}));

vi.mock("@/tools/extract-page-content-tool", () => ({
  extractPageContent: extractPageMocks.extractPageContent,
}));

import {
  createFactsCheckTool,
  factsCheckInputSchema,
} from "@/tools/facts-check-tool";

function makeModel() {
  return { modelId: "test", doGenerate: async () => ({}) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("factsCheckInputSchema", () => {
  it("accepts original prompt and final research", () => {
    const result = factsCheckInputSchema.safeParse({
      originalPrompt: "Find the dimensions and current price of Product X.",
      finalResearch:
        "Product X is 10 cm wide and costs $25. Source: https://example.com/product-x",
    });

    expect(result.success).toBe(true);
  });

  it("rejects missing original prompt", () => {
    const result = factsCheckInputSchema.safeParse({
      finalResearch: "Product X is 10 cm wide and costs $25.",
    });

    expect(result.success).toBe(false);
  });

  it("rejects missing final research", () => {
    const result = factsCheckInputSchema.safeParse({
      originalPrompt: "Find the dimensions and current price of Product X.",
    });

    expect(result.success).toBe(false);
  });
});

describe("createFactsCheckTool", () => {
  it("describes the fact-checking behavior", () => {
    const t = createFactsCheckTool(makeModel());

    expect(t.description).toContain("source URLs");
    expect(t.description).toContain("high-risk factual claims");
  });

  it("returns message when no URLs found in research", async () => {
    const t = createFactsCheckTool(makeModel());
    const result = await t.execute!(
      {
        originalPrompt: "Find price of Product X.",
        finalResearch: "Product X costs $25.",
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(result).toBe(
      "No source URLs found in the research text. Fact-check could not be performed.",
    );
  });

  it("fetches source URLs and generates fact-check text", async () => {
    const model = makeModel();
    extractPageMocks.extractPageContent.mockResolvedValueOnce(
      "Product X specs: 10 cm wide, $25.",
    );
    aiMocks.generateText.mockResolvedValueOnce({
      text: "All claims verified.",
    });

    const t = createFactsCheckTool(model);
    const result = await t.execute!(
      {
        originalPrompt: "Find price of Product X.",
        finalResearch:
          "Product X is 10 cm wide and costs $25. https://example.com/product-x",
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(result).toBe("All claims verified.");
    expect(extractPageMocks.extractPageContent).toHaveBeenCalledWith(
      "https://example.com/product-x",
      expect.objectContaining({ summarize: false }),
    );
    const generateCall = aiMocks.generateText.mock.calls[0][0] as Record<string, unknown>;
    expect(generateCall.model).toBe(model);
    expect(generateCall.prompt).toContain("https://example.com/product-x");
  });

  it("handles failed source fetches gracefully", async () => {
    extractPageMocks.extractPageContent.mockRejectedValueOnce(
      new Error("Network error"),
    );
    aiMocks.generateText.mockResolvedValueOnce({
      text: "Could not verify: source unavailable.",
    });

    const t = createFactsCheckTool(makeModel());
    const result = await t.execute!(
      {
        originalPrompt: "Find price of Product X.",
        finalResearch:
          "Product X costs $25. https://example.com/product-x",
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(result).toBe("Could not verify: source unavailable.");
    expect(aiMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("[Could not fetch: Network error]"),
      }),
    );
  });

  it("fetches multiple URLs in parallel", async () => {
    extractPageMocks.extractPageContent
      .mockResolvedValueOnce("Page 1 content about $25.")
      .mockResolvedValueOnce("Page 2 content about dimensions.");
    aiMocks.generateText.mockResolvedValueOnce({
      text: "Claims confirmed.",
    });

    const t = createFactsCheckTool(makeModel());
    await t.execute!(
      {
        originalPrompt: "Find price and dimensions.",
        finalResearch:
          "Product X costs $25 (https://example.com/pricing) and is 10 cm wide (https://example.com/specs).",
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(extractPageMocks.extractPageContent).toHaveBeenCalledTimes(2);
  });

  it("deduplicates URLs", async () => {
    extractPageMocks.extractPageContent.mockResolvedValueOnce("Content.");
    aiMocks.generateText.mockResolvedValueOnce({ text: "OK." });

    const t = createFactsCheckTool(makeModel());
    await t.execute!(
      {
        originalPrompt: "Find price.",
        finalResearch:
          "Product X costs $25 (https://example.com/page). Also see https://example.com/page for details.",
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(extractPageMocks.extractPageContent).toHaveBeenCalledTimes(1);
  });

  it("returns fallback message when fact-check produces empty result", async () => {
    extractPageMocks.extractPageContent.mockResolvedValueOnce("Content.");
    aiMocks.generateText.mockResolvedValueOnce({ text: "   " });

    const t = createFactsCheckTool(makeModel());
    const result = await t.execute!(
      {
        originalPrompt: "Find price.",
        finalResearch:
          "Product X costs $25. https://example.com/page",
      },
      { toolCallId: "call-1", messages: [] },
    );

    expect(result).toBe(
      "Fact-check completed, but no notes were returned.",
    );
  });

  it("propagates abort signal to generateText and extractPageContent", async () => {
    extractPageMocks.extractPageContent.mockResolvedValueOnce("Content.");
    aiMocks.generateText.mockResolvedValueOnce({ text: "OK." });

    const abortController = new AbortController();
    const t = createFactsCheckTool(makeModel());
    await t.execute!(
      {
        originalPrompt: "Find price.",
        finalResearch:
          "Product X costs $25. https://example.com/page",
      },
      {
        abortSignal: abortController.signal,
        toolCallId: "call-1",
        messages: [],
      },
    );

    expect(extractPageMocks.extractPageContent).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ abortSignal: abortController.signal }),
    );
    expect(aiMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: abortController.signal,
      }),
    );
  });

  it("strips trailing punctuation from URLs", async () => {
    extractPageMocks.extractPageContent.mockResolvedValueOnce("Content.");
    aiMocks.generateText.mockResolvedValueOnce({ text: "OK." });

    const t = createFactsCheckTool(makeModel());
    await t.execute!(
      {
        originalPrompt: "Find price.",
        finalResearch:
          "See https://example.com/page, and also https://example.com/other.",
      },
      { toolCallId: "call-1", messages: [] },
    );

    const calledUrls = extractPageMocks.extractPageContent.mock.calls.map(
      (c: string[]) => c[0],
    );
    expect(calledUrls).toContain("https://example.com/page");
    expect(calledUrls).toContain("https://example.com/other");
    expect(calledUrls).not.toContain("https://example.com/page,");
    expect(calledUrls).not.toContain("https://example.com/other.");
  });
});
