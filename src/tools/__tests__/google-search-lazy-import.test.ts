import { expect, it, vi } from "vitest";

const extractorMocks = vi.hoisted(() => ({
  loaded: vi.fn(),
  extractAndFormat: vi.fn(() => "Formatted results"),
}));

vi.mock("@/tools/google-search-extractor", () => {
  extractorMocks.loaded();
  return { extractAndFormatGoogleSearchHtml: extractorMocks.extractAndFormat };
});

import { createGoogleSearchTool } from "@/tools/google-search-tool";

it("loads the heavy Google extractor only when search results need extraction", async () => {
  const model = { modelId: "test" } as never;
  const searchTool = createGoogleSearchTool(model, async () => "<html></html>");

  expect(extractorMocks.loaded).not.toHaveBeenCalled();

  await expect(searchTool.execute?.({ query: "example" }, {} as never)).resolves
    .toBe("Formatted results");

  expect(extractorMocks.loaded).toHaveBeenCalledOnce();
  expect(extractorMocks.extractAndFormat).toHaveBeenCalledWith(
    model,
    "example",
    "<html></html>",
    undefined,
  );
});
