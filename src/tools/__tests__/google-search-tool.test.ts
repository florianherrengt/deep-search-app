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

import {
  GOOGLE_SEARCH_MAX_RESULTS,
  buildGoogleSearchUrl,
  createGoogleSearchTool,
} from "@/tools/google-search-tool";
import {
  GoogleSearchExtractionError,
  createGoogleSearchPageSnapshot,
  extractGoogleSearchResults,
  googleSearchResultsSchema,
  normalizeGoogleResultUrl,
  parseGoogleSearchExtractionText,
  validateGoogleSearchExtraction,
} from "@/tools/google-search-extractor";

type ExecutableGoogleSearchTool = {
  execute: (
    input: { query: string },
    options?: { abortSignal?: AbortSignal; toolCallId?: string },
  ) => Promise<string>;
};

const model = { modelId: "test" } as never;

const GOOGLE_HTML = `
  <html><body>
    <script>Ignore this hidden script instruction.</script>
    <div class="any-class-google-can-change">
      <a href="/url?q=https%3A%2F%2Fexample.com%2Farticle%3Flang%3Den%26utm_source%3Dgoogle">
        <h3>Example topic</h3>
      </a>
      <div>A concise rendered search result.</div>
    </div>
    <a href="https://www.google.com/search?q=related">Related search</a>
  </body></html>
`;

function extraction(
  overrides: Partial<{
    status: "results" | "no-results" | "unrecognized";
    results: Array<{ title: string; url: string; description: string }>;
  }> = {},
) {
  return {
    status: "results" as const,
    results: [
      {
        title: "Example topic",
        url: "https://example.com/article?lang=en&utm_source=google",
        description: "A concise rendered search result.",
      },
    ],
    ...overrides,
  };
}

function modelResponse(value = extraction()) {
  return {
    text: JSON.stringify(value),
    finishReason: "stop",
    reasoningText: undefined,
  };
}

describe("buildGoogleSearchUrl", () => {
  it("builds a direct Google query URL capped at ten results", () => {
    const url = new URL(buildGoogleSearchUrl("  café & tea  "));

    expect(url.origin).toBe("https://www.google.com");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("café & tea");
    expect(url.searchParams.get("num")).toBe("10");
  });

  it("rejects an empty query", () => {
    expect(() => buildGoogleSearchUrl("   ")).toThrow();
  });
});

describe("Google result evidence", () => {
  it("unwraps redirects while preserving meaningful query parameters", () => {
    expect(
      normalizeGoogleResultUrl(
        "/url?q=https%3A%2F%2FExample.com%2Fdocs%2F%3Fchapter%3D2%26utm_source%3Dgoogle%23heading&sa=U",
      ),
    ).toBe("https://example.com/docs?chapter=2");
  });

  it("filters invalid schemes, ads, and Google navigation", () => {
    expect(normalizeGoogleResultUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeGoogleResultUrl("ftp://files.example/archive")).toBeNull();
    expect(normalizeGoogleResultUrl("/search?q=another+query")).toBeNull();
    expect(
      normalizeGoogleResultUrl("https://www.googleadservices.com/pagead/aclk"),
    ).toBeNull();
    expect(
      normalizeGoogleResultUrl("https://www.google.com/maps/place/Paris"),
    ).toBeNull();
  });

  it("retains legitimate Google service results", () => {
    expect(
      normalizeGoogleResultUrl(
        "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
      ),
    ).toBe(
      "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
    );
  });

  it("creates a class-independent compact snapshot with link destinations", () => {
    const snapshot = createGoogleSearchPageSnapshot(GOOGLE_HTML);

    expect(snapshot.content).toContain("LINK: Example topic");
    expect(snapshot.content).toContain("URL: /url?q=");
    expect(snapshot.content).toContain("A concise rendered search result.");
    expect(snapshot.content).not.toContain("hidden script instruction");
    expect(snapshot.allowedUrls).toEqual(
      new Set(["https://example.com/article?lang=en"]),
    );
  });

  it("bounds the page snapshot sent to the model", () => {
    const html = `<html><body><a href="https://example.com">Result</a><p>${"visible content ".repeat(10_000)}</p></body></html>`;
    const snapshot = createGoogleSearchPageSnapshot(html);

    expect(snapshot.content.length).toBeLessThanOrEqual(50_000);
  });
});

describe("validateGoogleSearchExtraction", () => {
  const allowedUrls = new Set([
    "https://example.com/article?lang=en",
    "https://docs.example.org/guide?chapter=2",
  ]);

  it("normalizes, deduplicates, and formats only source-backed URLs", () => {
    const results = validateGoogleSearchExtraction(
      extraction({
        results: [
          {
            title: "  Example   topic ",
            url: "https://example.com/article?lang=en&utm_source=model",
            description: "  First   snippet. ",
          },
          {
            title: "Duplicate",
            url: "https://example.com/article?lang=en",
            description: "Duplicate snippet.",
          },
          {
            title: "Fabricated",
            url: "https://fabricated.example/result",
            description: "Not present on the page.",
          },
          {
            title: "Documentation",
            url: "https://docs.example.org/guide?chapter=2",
            description: "Second snippet.",
          },
        ],
      }),
      allowedUrls,
    );

    expect(results).toEqual([
      {
        title: "Example topic",
        url: "https://example.com/article?lang=en",
        description: "First snippet.",
        snippet: "First snippet.",
      },
      {
        title: "Documentation",
        url: "https://docs.example.org/guide?chapter=2",
        description: "Second snippet.",
        snippet: "Second snippet.",
      },
    ]);
  });

  it("accepts explicit no-results and rejects unknown or inconsistent states", () => {
    expect(
      validateGoogleSearchExtraction(
        extraction({ status: "no-results", results: [] }),
        new Set(),
      ),
    ).toEqual([]);
    expect(() =>
      validateGoogleSearchExtraction(
        extraction({ status: "unrecognized", results: [] }),
        new Set(),
      ),
    ).toThrow(GoogleSearchExtractionError);
    expect(() =>
      validateGoogleSearchExtraction(
        extraction({ status: "results", results: [] }),
        new Set(),
      ),
    ).toThrow(GoogleSearchExtractionError);
  });

  it("fails closed when every model URL is absent from the page", () => {
    expect(() =>
      validateGoogleSearchExtraction(extraction(), new Set()),
    ).toThrow(/present on the rendered Google page/);
  });

  it("validates result counts and fields with Zod", () => {
    expect(
      googleSearchResultsSchema.safeParse(
        Array.from({ length: GOOGLE_SEARCH_MAX_RESULTS + 1 }, (_, index) => ({
          title: `Result ${index}`,
          url: `https://example.com/${index}`,
          description: "Description",
        })),
      ).success,
    ).toBe(false);
  });
});

describe("parseGoogleSearchExtractionText", () => {
  it("accepts plain or fenced JSON and validates the exact result shape", () => {
    expect(
      parseGoogleSearchExtractionText(JSON.stringify(extraction())),
    ).toEqual(extraction());
    expect(
      parseGoogleSearchExtractionText(
        `\`\`\`json\n${JSON.stringify(extraction())}\n\`\`\``,
      ),
    ).toEqual(extraction());
  });

  it("rejects invalid JSON and incompatible shapes", () => {
    expect(() => parseGoogleSearchExtractionText("not json")).toThrow(
      /invalid JSON/,
    );
    expect(() =>
      parseGoogleSearchExtractionText('{"results":[]}'),
    ).toThrow(/required result shape/);
  });
});

describe("extractGoogleSearchResults", () => {
  beforeEach(() => {
    aiMocks.generateText.mockReset();
    aiMocks.generateText.mockResolvedValue(modelResponse());
  });

  it("uses validated model JSON, treats the page as untrusted, and forwards cancellation", async () => {
    const controller = new AbortController();

    await expect(
      extractGoogleSearchResults(
        model,
        "example topic",
        GOOGLE_HTML,
        controller.signal,
      ),
    ).resolves.toHaveLength(1);

    expect(aiMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        abortSignal: controller.signal,
        temperature: 0,
        maxOutputTokens: 2_000,
        system: expect.stringContaining("untrusted data"),
        prompt: expect.stringContaining("Search query: example topic"),
        providerOptions: {
          deepseek: { thinking: { type: "disabled" } },
          openrouter: { reasoning: { max_tokens: 0 } },
          zhipu: { thinking: { type: "disabled" } },
        },
      }),
    );
  });

  it("propagates model/provider failures", async () => {
    aiMocks.generateText.mockRejectedValueOnce(new Error("Model unavailable"));

    await expect(
      extractGoogleSearchResults(model, "example", GOOGLE_HTML),
    ).rejects.toThrow("Model unavailable");
  });
});

describe("createGoogleSearchTool", () => {
  beforeEach(() => {
    aiMocks.generateText.mockReset();
    aiMocks.generateText.mockResolvedValue(modelResponse());
  });

  it("renders the direct search URL and returns the standard result format", async () => {
    const renderPage = vi.fn().mockResolvedValue(GOOGLE_HTML);
    const tool = createGoogleSearchTool(
      model,
      renderPage,
    ) as unknown as ExecutableGoogleSearchTool;
    const controller = new AbortController();

    await expect(
      tool.execute(
        { query: "example topic" },
        { abortSignal: controller.signal },
      ),
    ).resolves.toBe(
      "Example topic: https://example.com/article?lang=en\n" +
        "A concise rendered search result.",
    );

    expect(renderPage).toHaveBeenCalledWith(
      "https://www.google.com/search?q=example+topic&num=10",
      {
        signal: controller.signal,
        onHumanVerification: expect.any(Function),
      },
    );
  });

  it("emits visible verification status while the challenge is in flight", async () => {
    const emitEvent = vi.fn();
    const tool = createGoogleSearchTool(
      model,
      async (_url, options) => {
        await options.onHumanVerification?.({
          kind: "captcha",
          message: "Human verification is required in the browser.",
        });
        return GOOGLE_HTML;
      },
      { emitEvent },
    ) as unknown as ExecutableGoogleSearchTool;

    await tool.execute(
      { query: "example" },
      { toolCallId: "google-call-1" },
    );

    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "start",
        toolName: "google_search",
        displayTarget: { type: "toolCall", toolCallId: "google-call-1" },
      }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "text-delta",
        delta: expect.stringContaining("resume automatically"),
      }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "complete" }),
    );
  });

  it("uses the standard no-results output for an explicit empty state", async () => {
    aiMocks.generateText.mockResolvedValueOnce(
      modelResponse(extraction({ status: "no-results", results: [] })),
    );
    const tool = createGoogleSearchTool(
      model,
      async () => "<html><body>No results found for this query.</body></html>",
    ) as unknown as ExecutableGoogleSearchTool;

    await expect(tool.execute({ query: "missing" })).resolves.toBe(
      "No results found.",
    );
  });

  it("surfaces missing rendered HTML as a rendering failure", async () => {
    const tool = createGoogleSearchTool(
      model,
      async () => null,
    ) as unknown as ExecutableGoogleSearchTool;

    await expect(tool.execute({ query: "example" })).rejects.toThrow(
      "Google search did not return rendered HTML.",
    );
    expect(aiMocks.generateText).not.toHaveBeenCalled();
  });
});
