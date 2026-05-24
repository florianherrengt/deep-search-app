import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

import { fetch } from "@tauri-apps/plugin-http";
import { RedditExtractor } from "../reddit-extractor";

const mockFetch = vi.mocked(fetch);

const mockRedditJson = [
  {
    kind: "Listing",
    data: {
      children: [
        {
          kind: "t3",
          data: {
            title: "Test Post",
            selftext: "Body text",
            author: "tester",
            score: 10,
            created_utc: 1779386106,
            num_comments: 2,
          },
        },
      ],
    },
  },
  {
    kind: "Listing",
    data: {
      children: [
        {
          kind: "t1",
          data: {
            author: "commenter1",
            body: "Hello",
            score: 3,
            created_utc: 1779387000,
            replies: "",
          },
        },
        {
          kind: "t1",
          data: {
            author: "commenter2",
            body: "World",
            score: 1,
            created_utc: 1779387100,
            replies: "",
          },
        },
      ],
    },
  },
];

function jsonResponse(data: unknown, status = 200) {
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    ok: status < 400,
  } as unknown as Response;
}

describe("RedditExtractor", () => {
  let extractor: RedditExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    extractor = new RedditExtractor();
  });

  describe("canHandle", () => {
    it("matches reddit.com URLs", () => {
      expect(extractor.canHandle("https://www.reddit.com/r/test/comments/abc/")).toBe(true);
    });

    it("matches old.reddit.com URLs", () => {
      expect(extractor.canHandle("https://old.reddit.com/r/test/comments/abc/")).toBe(true);
    });

    it("does not match non-reddit URLs", () => {
      expect(extractor.canHandle("https://example.com")).toBe(false);
    });
  });

  describe("extract", () => {
    it("fetches .json and returns markdown", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(mockRedditJson) as never);

      const result = await extractor.extract(
        "https://www.reddit.com/r/test/comments/abc/test_post/",
      );

      expect(result).toContain("# Test Post");
      expect(result).toContain("## Comments");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://www.reddit.com/r/test/comments/abc/test_post.json",
        expect.any(Object),
      );
    });

    it("returns empty string when both strategies fail", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));

      const result = await extractor.extract(
        "https://www.reddit.com/r/test/comments/abc/test_post/",
      );

      expect(result).toBe("");
    });
  });
});
