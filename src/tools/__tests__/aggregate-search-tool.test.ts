import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import PQueue from "p-queue";
import {
  resetRateLimiter,
  setRateLimiter,
} from "deep-search-core/search-extract";

const tauriMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("@/lib/tauri-bridge", () => tauriMocks);

import { createAggregateSearchTool } from "@/tools/aggregate-search-tool";

type ExecutableAggregateTool = {
  execute: (
    input: { query: string },
    options?: { abortSignal?: AbortSignal },
  ) => Promise<string>;
};

describe("createAggregateSearchTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const queue = new PQueue({ concurrency: 1 });
    setRateLimiter({
      schedule: (fn, signal) => queue.add(fn, { signal }),
    });
  });

  afterEach(() => {
    resetRateLimiter();
  });

  it("resolves through a serial search rate limiter", async () => {
    const tool = createAggregateSearchTool({
      braveApiKey: "brave-key",
      exaApiKey: "exa-key",
    }) as unknown as ExecutableAggregateTool;

    tauriMocks.fetch.mockImplementation((url: string) => {
      if (url.includes("search.brave.com")) {
        return Promise.resolve(
          mockResponse(200, {
            web: {
              results: [
                {
                  title: "Shared Brave",
                  url: "https://example.com/shared?utm_source=brave",
                  description: "Brave shared result.",
                },
              ],
            },
          }),
        );
      }

      return Promise.resolve(
        mockResponse(200, {
          results: [
            {
              title: "Longer Shared Exa Result",
              url: "https://example.com/shared",
              text: "Exa shared result with more detail.",
            },
            {
              title: "Unique Exa",
              url: "https://exa.example/unique",
              text: "Only Exa returned this.",
            },
          ],
        }),
      );
    });

    const result = await Promise.race([
      tool.execute({ query: "test query" }),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("aggregate_search timed out")), 100),
      ),
    ]);

    expect(result).toContain("Longer Shared Exa Result");
    expect(result).toContain("https://example.com/shared");
    expect(result).toContain("Unique Exa");
    expect(tauriMocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns partial merged results when one provider fails", async () => {
    const tool = createAggregateSearchTool({
      braveApiKey: "brave-key",
      exaApiKey: "exa-key",
    }) as unknown as ExecutableAggregateTool;

    tauriMocks.fetch.mockImplementation((url: string) => {
      if (url.includes("search.brave.com")) {
        return Promise.resolve(
          mockResponse(200, {
            web: {
              results: [
                {
                  title: "Working result",
                  url: "https://example.com/ok",
                  description: "Brave succeeded.",
                },
              ],
            },
          }),
        );
      }

      return Promise.resolve(
        mockResponse(500, { error: "boom" }, false, "Server Error"),
      );
    });

    await expect(tool.execute({ query: "test query" })).resolves.toContain(
      "Working result",
    );
  });

  it("returns partial merged results when one provider never settles", async () => {
    const tool = createAggregateSearchTool(
      {
        braveApiKey: "brave-key",
        exaApiKey: "exa-key",
      },
      { providerTimeoutMs: 10 },
    ) as unknown as ExecutableAggregateTool;

    tauriMocks.fetch.mockImplementation((url: string) => {
      if (url.includes("search.brave.com")) {
        return Promise.resolve(
          mockResponse(200, {
            web: {
              results: [
                {
                  title: "Working result",
                  url: "https://example.com/ok",
                  description: "Brave succeeded.",
                },
              ],
            },
          }),
        );
      }

      return new Promise(() => {});
    });

    const result = await Promise.race([
      tool.execute({ query: "test query" }),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("aggregate_search timed out")), 100),
      ),
    ]);

    expect(result).toContain("Working result");
  });

  it("is unavailable when no search providers are configured", () => {
    expect(createAggregateSearchTool(undefined)).toBeUndefined();
    expect(createAggregateSearchTool({ searxngBaseUrl: "not a url" }))
      .toBeUndefined();
  });
});

function mockResponse(
  status: number,
  body: unknown,
  ok = status >= 200 && status < 300,
  statusText = "",
) {
  return {
    ok,
    status,
    statusText,
    text: async () => JSON.stringify(body),
  };
}
