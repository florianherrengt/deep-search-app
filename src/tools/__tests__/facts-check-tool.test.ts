import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

const extractionMocks = vi.hoisted(() => ({
  extractPageContent: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: aiMocks.generateText,
  };
});

vi.mock("@/tools/extract-page-content-tool", () => ({
  extractPageContent: extractionMocks.extractPageContent,
}));

import {
  createFactsCheckTool,
  factsCheckInputSchema,
} from "@/tools/core-research-tools";

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
  it("uses the app fact-checking behavior", () => {
    const t = createFactsCheckTool(makeModel());

    expect(t.description).toContain("source URLs");
    expect(t.description).toContain("high-risk factual claims");
  });

  it("returns the core no-URL response without fetching", async () => {
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
    expect(extractionMocks.extractPageContent).not.toHaveBeenCalled();
    expect(aiMocks.generateText).not.toHaveBeenCalled();
  });

  it("extracts cited URLs through the app extraction helper", async () => {
    const model = makeModel();
    const controller = new AbortController();
    extractionMocks.extractPageContent.mockResolvedValueOnce(
      "Product X current price is $25.",
    );
    aiMocks.generateText.mockResolvedValueOnce({ text: "Claims confirmed." });

    const t = createFactsCheckTool(model, "scrape-token");
    const result = await t.execute!(
      {
        originalPrompt: "Find price of Product X.",
        finalResearch:
          "Product X costs $25. Source: https://example.com/product-x.",
      },
      { abortSignal: controller.signal, toolCallId: "call-1", messages: [] },
    );

    expect(result).toBe("Claims confirmed.");
    expect(extractionMocks.extractPageContent).toHaveBeenCalledWith(
      "https://example.com/product-x",
      {
        summarize: false,
        scrapeDoApiKey: "scrape-token",
        abortSignal: controller.signal,
      },
    );
    expect(aiMocks.generateText).toHaveBeenCalledWith({
      model,
      system: expect.stringContaining("fact-checking assistant"),
      prompt: expect.stringContaining("Product X current price is $25."),
      abortSignal: controller.signal,
    });
  });
});
