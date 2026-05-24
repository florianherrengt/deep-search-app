import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { RedditExtractor } from "../reddit-extractor";

const mockInvoke = vi.mocked(invoke);

const OLD_REDDIT_HTML = `
<html>
<body>
<div class="content">
  <div class="thing link">
    <p class="title"><a class="title">Test Post</a></p>
    <div class="tagline"><a class="author">tester</a></div>
    <div class="expando"><div class="usertext-body">Body text</div></div>
  </div>
  <div class="comment">
    <div class="tagline"><a class="author">commenter1</a></div>
    <div class="usertext-body">Hello</div>
    <span class="score unvoted">3 points</span>
  </div>
  <div class="comment">
    <div class="tagline"><a class="author">commenter2</a></div>
    <div class="usertext-body">World</div>
    <span class="score unvoted">1 point</span>
  </div>
</div>
</body>
</html>
`;

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
    it("opens old.reddit.com in webview and returns markdown", async () => {
      mockInvoke
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(OLD_REDDIT_HTML)
        .mockResolvedValueOnce(undefined);

      const result = await extractor.extract(
        "https://www.reddit.com/r/test/comments/abc/test_post/",
      );

      expect(result).toContain("# Test Post");
      expect(result).toContain("## Comments");
      expect(mockInvoke).toHaveBeenCalledWith(
        "open_tab",
        expect.objectContaining({
          url: "https://www.reddit.com/r/test/comments/abc/test_post/",
        }),
      );
    });

    it("returns empty string when webview fails", async () => {
      mockInvoke.mockRejectedValue(new Error("webview error"));

      const result = await extractor.extract(
        "https://www.reddit.com/r/test/comments/abc/test_post/",
      );

      expect(result).toBe("");
    });

    it("returns empty string for .json URLs", async () => {
      const result = await extractor.extract(
        "https://www.reddit.com/r/test/comments/abc/test_post.json",
      );

      expect(result).toBe("");
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });
});
