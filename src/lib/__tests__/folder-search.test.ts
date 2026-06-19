import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: aiMocks.generateText,
}));

import { searchFoldersWithLLM, searchFoldersWithLLMSafe } from "@/lib/folder-search";

const FOLDERS = [
  "best-espresso-machines-2024",
  "competitor-analysis-saas",
  "hiking-trails-norway",
  "market-map-fintech",
];

function mockResponse(text: string) {
  return { text } as Awaited<ReturnType<typeof aiMocks.generateText>>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchFoldersWithLLM", () => {
  it("returns folders listed by the model that exist in the candidate set", async () => {
    aiMocks.generateText.mockResolvedValueOnce(
      mockResponse(
        '{"relevant": ["market-map-fintech", "competitor-analysis-saas"]}',
      ),
    );

    await expect(searchFoldersWithLLM("fintech", FOLDERS, {} as any)).resolves.toEqual([
      "market-map-fintech",
      "competitor-analysis-saas",
    ]);
  });

  it("filters out names the model invented that are not in the candidate list", async () => {
    aiMocks.generateText.mockResolvedValueOnce(
      mockResponse(
        '{"relevant": ["market-map-fintech", "totally-made-up-folder"]}',
      ),
    );

    await expect(searchFoldersWithLLM("x", FOLDERS, {} as any)).resolves.toEqual([
      "market-map-fintech",
    ]);
  });

  it("returns empty when the model says nothing is relevant", async () => {
    aiMocks.generateText.mockResolvedValueOnce(mockResponse('{"relevant": []}'));

    await expect(searchFoldersWithLLM("underwater basket weaving", FOLDERS, {} as any)).resolves.toEqual(
      [],
    );
  });

  it("returns empty without calling the model when there are no folders", async () => {
    await expect(searchFoldersWithLLM("anything", [], {} as any)).resolves.toEqual([]);
    expect(aiMocks.generateText).not.toHaveBeenCalled();
  });

  it("extracts the JSON object even when surrounded by prose", async () => {
    aiMocks.generateText.mockResolvedValueOnce(
      mockResponse(
        'Here are the matches:\n{"relevant": ["hiking-trails-norway"]}\nHope that helps!',
      ),
    );

    await expect(searchFoldersWithLLM("hiking", FOLDERS, {} as any)).resolves.toEqual([
      "hiking-trails-norway",
    ]);
  });

  it("returns empty when the model output is not valid JSON", async () => {
    aiMocks.generateText.mockResolvedValueOnce(mockResponse("I cannot help with that."));

    await expect(searchFoldersWithLLM("x", FOLDERS, {} as any)).resolves.toEqual([]);
  });

  it("returns empty when the JSON is missing the relevant key", async () => {
    aiMocks.generateText.mockResolvedValueOnce(
      mockResponse('{"matches": ["market-map-fintech"]}'),
    );

    await expect(searchFoldersWithLLM("x", FOLDERS, {} as any)).resolves.toEqual([]);
  });
});

describe("searchFoldersWithLLMSafe", () => {
  it("swallows errors and returns an empty array", async () => {
    aiMocks.generateText.mockRejectedValueOnce(new Error("model unavailable"));

    await expect(
      searchFoldersWithLLMSafe("fintech", FOLDERS, {} as any),
    ).resolves.toEqual([]);
  });

  it("returns empty on abort", async () => {
    const err = new DOMException("aborted", "AbortError");
    aiMocks.generateText.mockRejectedValueOnce(err);

    await expect(
      searchFoldersWithLLMSafe("fintech", FOLDERS, {} as any),
    ).resolves.toEqual([]);
  });

  it("returns results when the model succeeds", async () => {
    aiMocks.generateText.mockResolvedValueOnce(
      mockResponse('{"relevant": ["hiking-trails-norway"]}'),
    );

    await expect(
      searchFoldersWithLLMSafe("hiking", FOLDERS, {} as any),
    ).resolves.toEqual(["hiking-trails-norway"]);
  });
});
