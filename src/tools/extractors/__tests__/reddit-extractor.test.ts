import { describe, it, expect, vi, beforeEach } from "vitest";
import { setWebViewExtractor, type WebViewExtractorOptions } from "../reddit-extractor";

const mockWebview = vi.fn<
  (url: string, options?: WebViewExtractorOptions) => Promise<string | null>
>();
setWebViewExtractor(mockWebview);

import { RedditExtractor } from "../reddit-extractor";

const OLD_REDDIT_HTML = `
<html>
<body>
<div class="content">
  <div class="thing link" data-author="tester" data-score="10">
    <p class="title"><a class="title">Test Post</a></p>
    <div class="tagline"><a class="author">tester</a></div>
    <div class="expando"><div class="usertext-body">Body text</div></div>
  </div>
  <div class="commentarea">
    <div class="sitetable nestedlisting">
      <div class="thing comment" data-author="commenter1" data-score="3">
        <div class="entry">
          <div class="tagline"><a class="author">commenter1</a></div>
          <div class="usertext-body">Hello</div>
          <span class="score unvoted">3 points</span>
        </div>
        <div class="child">
          <div class="sitetable">
            <div class="thing comment" data-author="reply1" data-score="2">
              <div class="entry">
                <div class="tagline"><a class="author">reply1</a></div>
                <div class="usertext-body">Nested reply</div>
                <span class="score unvoted">2 points</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="thing comment" data-author="commenter2" data-score="1">
        <div class="entry">
          <div class="tagline"><a class="author">commenter2</a></div>
          <div class="usertext-body">World</div>
          <span class="score unvoted">1 point</span>
        </div>
      </div>
    </div>
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
      expect(result).toContain("├── **commenter1** · 3 pts: Hello");
      expect(result).toContain("│   └── **reply1** · 2 pts: Nested reply");
      expect(result).toContain("└── **commenter2** · 1 pt: World");
      expect(mockWebview).toHaveBeenCalledWith(
        "https://old.reddit.com/r/test/comments/abc/test_post/",
        expect.objectContaining({
          maxWaitMs: 300000,
          retryIntervalMs: 5000,
        }),
      );
    });

    it("asks the webview extractor to retry while a challenge is visible", async () => {
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      await extractor.extract("https://www.reddit.com/r/test/comments/abc/test_post/");

      const options = mockWebview.mock.calls[0][1];
      expect(options?.shouldRetry?.("<html><body>verify you are human</body></html>")).toBe(true);
      expect(options?.shouldRetry?.(OLD_REDDIT_HTML)).toBe(false);
    });

    it("does not retry parseable old reddit HTML even when captcha markup is present", async () => {
      mockWebview.mockResolvedValueOnce(`${OLD_REDDIT_HTML}<script>var captcha = true;</script>`);

      await extractor.extract("https://www.reddit.com/r/test/comments/abc/test_post/");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(`${OLD_REDDIT_HTML}<script>var captcha = true;</script>`),
      ).toBe(false);
    });

    it("parses old reddit post title from fallback selectors", async () => {
      mockWebview.mockResolvedValueOnce(`
        <html>
          <head><meta property="og:title" content="Fallback Title" /></head>
          <body>
            <div class="commentarea">
              <div class="sitetable nestedlisting">
                <div class="thing comment" data-author="commenter" data-score="4">
                  <div class="entry"><div class="usertext-body"><div class="md">Fallback comment</div></div></div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `);

      const result = await extractor.extract(
        "https://www.reddit.com/r/test/comments/abc/test_post/",
      );

      expect(result).toContain("# Fallback Title");
      expect(result).toContain("└── **commenter** · 4 pts: Fallback comment");
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

    it("detects #challenge-form element as challenge", async () => {
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      await extractor.extract("https://www.reddit.com/r/test/comments/abc/test_post/");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body><div id=\"challenge-form\">...</div></body></html>",
        ),
      ).toBe(true);
    });

    it("detects .g-recaptcha element as challenge", async () => {
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      await extractor.extract("https://www.reddit.com/r/test/comments/abc/test_post/");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body><div class=\"g-recaptcha\"></div></body></html>",
        ),
      ).toBe(true);
    });

    it("detects .cf-challenge-running element as challenge", async () => {
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      await extractor.extract("https://www.reddit.com/r/test/comments/abc/test_post/");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body><div class=\"cf-challenge-running\"></div></body></html>",
        ),
      ).toBe(true);
    });

    it("detects recaptcha iframe as challenge", async () => {
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      await extractor.extract("https://www.reddit.com/r/test/comments/abc/test_post/");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body><iframe src=\"https://www.google.com/recaptcha/api2/anchor\"></iframe></body></html>",
        ),
      ).toBe(true);
    });

    it("detects 'captcha challenge' text marker", async () => {
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      await extractor.extract("https://www.reddit.com/r/test/comments/abc/test_post/");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body>captcha challenge</body></html>",
        ),
      ).toBe(true);
    });

    it("detects 'captcha required' text marker", async () => {
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      await extractor.extract("https://www.reddit.com/r/test/comments/abc/test_post/");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body>captcha required</body></html>",
        ),
      ).toBe(true);
    });

    it("detects 'checking if the site connection is secure' text marker", async () => {
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      await extractor.extract("https://www.reddit.com/r/test/comments/abc/test_post/");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body>checking if the site connection is secure</body></html>",
        ),
      ).toBe(true);
    });

    it("detects 'checking your browser' text marker", async () => {
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      await extractor.extract("https://www.reddit.com/r/test/comments/abc/test_post/");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body>checking your browser</body></html>",
        ),
      ).toBe(true);
    });

    it("detects 'are you a robot' text marker", async () => {
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      await extractor.extract("https://www.reddit.com/r/test/comments/abc/test_post/");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body>are you a robot</body></html>",
        ),
      ).toBe(true);
    });

    it("detects 'security check' text marker", async () => {
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      await extractor.extract("https://www.reddit.com/r/test/comments/abc/test_post/");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body>security check</body></html>",
        ),
      ).toBe(true);
    });

    it("includes post selftext in output", async () => {
      mockWebview.mockResolvedValueOnce(OLD_REDDIT_HTML);

      const result = await extractor.extract(
        "https://www.reddit.com/r/test/comments/abc/test_post/",
      );

      expect(result).toContain("Body text");
    });
  });
});
