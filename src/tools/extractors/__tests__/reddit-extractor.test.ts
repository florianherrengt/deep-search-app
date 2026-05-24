import { describe, it, expect, vi, beforeEach } from "vitest";
import { setWebViewExtractor } from "../reddit-extractor";

const mockWebview = vi.fn<() => Promise<string | null>>();
setWebViewExtractor(mockWebview);

import { RedditExtractor } from "../reddit-extractor";

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
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      const result = await extractor.extract(
        "https://www.reddit.com/r/test/comments/abc/test_post/",
      );

      expect(result).toContain("# Test Post");
      expect(result).toContain("## Comments");
      expect(mockWebview).toHaveBeenCalledWith(
        "https://old.reddit.com/r/test/comments/abc/test_post/",
      );
    });

    it("returns empty string when webview fails", async () => {
      mockWebview.mockResolvedValueOnce(null);

      const result = await extractor.extract(
        "https://www.reddit.com/r/test/comments/abc/test_post/",
      );

      expect(result).toBe("");
    });

    it("returns empty string when parsing fails", async () => {
      mockWebview.mockResolvedValueOnce("<html><body>challenge page</body></html>");

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
      expect(mockWebview).not.toHaveBeenCalled();
    });
  });
});
