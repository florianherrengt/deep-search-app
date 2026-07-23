import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSearchTools } from "deep-search-core/research-orchestrator";

const fetchMock = vi.fn();

type ExecutableYoutubeTool = {
  execute: (input: { query: string }) => Promise<string>;
};

describe("youtube_search", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("searches YouTube through the configured Data API key", async () => {
    const tools = createSearchTools(
      { youtubeApiKey: " youtube-key " },
      fetchMock as typeof fetch,
    );
    const youtubeSearch = tools.youtube_search as unknown as ExecutableYoutubeTool;

    fetchMock.mockResolvedValueOnce(
      mockResponse(200, {
        items: [
          {
            id: { videoId: "abc123DEF45" },
            snippet: {
              title: "Deep Search walkthrough",
              description: "A demo of the workflow.",
              channelTitle: "Research Channel",
              publishedAt: "2026-01-02T00:00:00Z",
            },
          },
        ],
      }),
    );

    const result = await youtubeSearch.execute({
      query: "deep search app walkthrough",
    });

    const endpoint = new URL(String(fetchMock.mock.calls[0][0]));
    expect(endpoint.href).toContain(
      "https://www.googleapis.com/youtube/v3/search",
    );
    expect(endpoint.searchParams.get("q")).toBe("deep search app walkthrough");
    expect(endpoint.searchParams.get("type")).toBe("video");
    expect(endpoint.searchParams.get("key")).toBe("youtube-key");
    expect(result).toContain("Deep Search walkthrough");
    expect(result).toContain("https://www.youtube.com/watch?v=abc123DEF45");
    expect(result).toContain("Video ID: abc123DEF45");
  });
});

function mockResponse(
  status: number,
  body: unknown,
  statusText = "",
) {
  return new Response(JSON.stringify(body), { status, statusText });
}
