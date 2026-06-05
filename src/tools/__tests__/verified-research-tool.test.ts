import { describe, expect, it } from "vitest";
import {
  createVerifiedResearchIsGoodTool,
  verifiedResearchInputSchema,
} from "@/tools/verified-research-tool";

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
    const mockModel = { modelId: "test", doGenerate: async () => ({}) } as never;
    const t = createVerifiedResearchIsGoodTool(mockModel);

    expect(t.description).toContain("isolated verifier");
    expect(t.description).toContain("high-risk factual claims");
  });
});
