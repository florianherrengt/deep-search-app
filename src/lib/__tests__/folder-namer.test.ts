import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";

const resolveUnique = vi.hoisted(() => vi.fn());
const slugifyName = vi.hoisted(() => vi.fn());

vi.mock("@/lib/transport/research-folder", () => ({
  slugifyFolderName: slugifyName,
  resolveUniqueFolderName: resolveUnique,
}));

import { nameFolderFromMessage } from "@/lib/transport/folder-namer";

describe("nameFolderFromMessage", () => {
  it("returns a slugified folder name from the model response", async () => {
    slugifyName.mockReturnValue("acme-earnings-calls");
    resolveUnique.mockResolvedValueOnce("acme-earnings-calls");
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "acme earnings calls" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 3, text: 3, reasoning: 0 } },
        warnings: [],
      }),
    });

    const name = await nameFolderFromMessage(model, "Find earnings calls for ACME?");
    expect(name).toBe("acme-earnings-calls");
  });

  it("retries when the model returns explanatory text", async () => {
    slugifyName.mockImplementation((t) => t.trim().replace(/\s+/g, "-").toLowerCase());
    resolveUnique.mockResolvedValueOnce("acme-earnings");
    let call = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        call++;
        if (call === 1) {
          return {
            content: [{ type: "text", text: "The folder should be named acme-earnings" }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 7, text: 7, reasoning: 0 } },
            warnings: [],
          };
        }
        return {
          content: [{ type: "text", text: "acme-earnings" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } },
          warnings: [],
        };
      },
    });

    const name = await nameFolderFromMessage(model, "Find earnings calls for ACME?");
    expect(name).toBe("acme-earnings");
    expect(call).toBe(2);
  });

  it("throws after max retries with invalid names", async () => {
    slugifyName.mockImplementation((t) => t.trim().replace(/\s+/g, "-").toLowerCase());
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "The folder should be named acme-earnings-research because it is about ACME" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 12, text: 12, reasoning: 0 } },
        warnings: [],
      }),
    });

    await expect(
      nameFolderFromMessage(model, "Find earnings calls for ACME?"),
    ).rejects.toThrow("Failed to generate a valid folder name");
  });

  it("resolves collisions via resolveUniqueFolderName", async () => {
    slugifyName.mockReturnValue("acme-earnings");
    resolveUnique.mockResolvedValueOnce("acme-earnings-2026-06-09");
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "acme-earnings" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 2, text: 2, reasoning: 0 } },
        warnings: [],
      }),
    });

    const name = await nameFolderFromMessage(model, "Find earnings calls for ACME?");
    expect(name).toBe("acme-earnings-2026-06-09");
  });
});
