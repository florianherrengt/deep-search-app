import { describe, expect, it } from "vitest";
import {
  createFactsCheckTool,
  factsCheckInputSchema,
} from "@/tools/core-research-tools";

function makeModel() {
  return { modelId: "test", doGenerate: async () => ({}) } as never;
}

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
  it("uses the core fact-checking behavior", () => {
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
  });
});
