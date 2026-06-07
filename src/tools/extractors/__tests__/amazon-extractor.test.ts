import { describe, it, expect, vi, beforeEach } from "vitest";
import { setAmazonWebViewExtractor } from "../amazon-extractor";
import type { WebViewExtractorOptions } from "../reddit-extractor";

const mockWebview = vi.fn<
  (url: string, options?: WebViewExtractorOptions) => Promise<string | null>
>();
setAmazonWebViewExtractor(mockWebview);

import { AmazonExtractor } from "../amazon-extractor";

const AMAZON_PRODUCT_HTML = `
<html>
<body>
<div id="wayfinding-breadcrumbs_container">
  <ul>
    <li><a>Sports &amp; Outdoors</a></li>
    <li><a>Fitness</a></li>
    <li><a>Strength Training Equipment</a></li>
  </ul>
</div>

<span id="productTitle">Sportneer Pull Up Bar: Adjustable Width Locking Mechanism</span>

<a id="bylineInfo">Visit the Sportneer Store</a>

<span id="acrPopover"><span class="a-icon-alt">4.3 out of 5 stars</span></span>
<span id="acrCustomerReviewText">527 ratings</span>

<div id="corePrice_feature_div">
  <span class="a-price">
    <span class="a-offscreen">£29.99</span>
  </span>
</div>

<div id="productOverview_feature_div">
  <table>
    <tr><td>Brand</td><td>Sportneer</td></tr>
    <tr><td>Colour</td><td>Black</td></tr>
    <tr><td>Material</td><td>Alloy Steel</td></tr>
  </table>
</div>

<div id="feature-bullets">
  <ul class="a-unordered-list">
    <li><span class="a-list-item">No drilling required</span></li>
    <li><span class="a-list-item">Easy installation in four steps</span></li>
    <li><span class="a-list-item">Adjustable from 76cm to 95cm</span></li>
  </ul>
</div>

<div data-hook="review">
  <span class="a-profile-name">Jane D.</span>
  <i data-hook="review-star-rating"><span class="a-icon-alt">5 out of 5 stars</span></i>
  <h5 data-hook="reviewTitle">Excellent product</h5>
  <span data-hook="review-date">Reviewed in the United Kingdom on 14 October 2025</span>
            <div data-hook="reviewText">Solid build quality, easy to install. Brief content visible, double tap to read full content.Full content visible, double tap to read brief content.Highly recommended!Read moreRead less</div>
  <span data-hook="helpful-vote-statement">3 people found this helpful</span>
</div>

<div data-hook="review">
  <span class="a-profile-name">John S.</span>
  <i data-hook="review-star-rating"><span class="a-icon-alt">4 out of 5 stars</span></i>
  <h5 data-hook="reviewTitle">Good but heavy</h5>
  <span data-hook="review-date">Reviewed in the United Kingdom on 1 May 2025</span>
  <div data-hook="reviewText">Works well for pull ups</div>
</div>
</body>
</html>
`;

describe("AmazonExtractor", () => {
  let extractor: AmazonExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    extractor = new AmazonExtractor();
  });

  describe("canHandle", () => {
    it("matches amazon.com product URLs", () => {
      expect(extractor.canHandle("https://www.amazon.com/dp/B0CR19B55Y")).toBe(true);
    });

    it("matches amazon.co.uk product URLs", () => {
      expect(
        extractor.canHandle(
          "https://www.amazon.co.uk/Sportneer-Pull-Bar/dp/B0CR19B55Y",
        ),
      ).toBe(true);
    });

    it("matches amazon.de product URLs", () => {
      expect(extractor.canHandle("https://www.amazon.de/dp/B0CR19B55Y")).toBe(true);
    });

    it("matches amazon.co.jp product URLs", () => {
      expect(extractor.canHandle("https://www.amazon.co.jp/dp/B0CR19B55Y")).toBe(true);
    });

    it("does not match non-Amazon URLs", () => {
      expect(extractor.canHandle("https://example.com/dp/B0CR19B55Y")).toBe(false);
    });

    it("does not match Amazon non-product pages", () => {
      expect(extractor.canHandle("https://www.amazon.com/gp/cart/view.html")).toBe(
        false,
      );
    });

    it("does not match Amazon search pages", () => {
      expect(extractor.canHandle("https://www.amazon.com/s?k=pull+up+bar")).toBe(
        false,
      );
    });
  });

  describe("extract", () => {
    it("extracts product info as markdown", async () => {
      mockWebview.mockResolvedValueOnce(AMAZON_PRODUCT_HTML);

      const result = await extractor.extract(
        "https://www.amazon.co.uk/dp/B0CR19B55Y",
      );

      expect(result).toContain("# Sportneer Pull Up Bar: Adjustable Width Locking Mechanism");
      expect(result).toContain("**Brand:** Sportneer");
      expect(result).toContain("**Price:** £29.99");
      expect(result).toContain("**Rating:** 4.3 out of 5 stars");
      expect(result).toContain("**Reviews:** 527 ratings");
      expect(result).toContain("**Category:** Sports & Outdoors > Fitness > Strength Training Equipment");
      expect(result).toContain("## Specifications");
      expect(result).toContain("- **Brand** Sportneer");
      expect(result).toContain("- **Colour** Black");
      expect(result).toContain("- **Material** Alloy Steel");
      expect(result).toContain("## About This Item");
      expect(result).toContain("- No drilling required");
      expect(result).toContain("- Easy installation in four steps");
      expect(result).toContain("- Adjustable from 76cm to 95cm");
      expect(result).toContain("## Customer Reviews");
      expect(result).toContain("Highly recommended!");
      expect(result).toContain("*3 people found this helpful*");
      expect(result).toContain("Works well for pull ups");
      expect(result).not.toContain("### Jane D.");
      expect(result).not.toContain("**Excellent product**");
    });

    it("passes challenge detection to webview extractor", async () => {
      mockWebview.mockResolvedValueOnce(AMAZON_PRODUCT_HTML);

      await extractor.extract("https://www.amazon.co.uk/dp/B0CR19B55Y");

      expect(mockWebview).toHaveBeenCalledWith(
        "https://www.amazon.co.uk/dp/B0CR19B55Y",
        expect.objectContaining({
          maxWaitMs: 180_000,
          retryIntervalMs: 3_000,
        }),
      );

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body>sorry, we just need to make sure you're not a robot</body></html>",
        ),
      ).toBe(true);
      expect(options?.shouldRetry?.(AMAZON_PRODUCT_HTML)).toBe(false);
    });

    it("does not flag captcha when product title is present", async () => {
      mockWebview.mockResolvedValueOnce(AMAZON_PRODUCT_HTML);

      await extractor.extract("https://www.amazon.co.uk/dp/B0CR19B55Y");

      const options = mockWebview.mock.calls[0][1];
      const htmlWithCaptchaAndProduct = `
        <html><body>
          <span id="productTitle">Real Product</span>
          <div class="captcha">captcha challenge</div>
        </body></html>
      `;
      expect(options?.shouldRetry?.(htmlWithCaptchaAndProduct)).toBe(false);
    });

    it("returns empty string when webview fails", async () => {
      mockWebview.mockResolvedValueOnce(null);

      const result = await extractor.extract("https://www.amazon.co.uk/dp/B0CR19B55Y");

      expect(result).toBe("");
    });

    it("returns empty string when HTML has no product title", async () => {
      mockWebview.mockResolvedValueOnce(
        "<html><body>Some random page without product info</body></html>",
      );

      const result = await extractor.extract("https://www.amazon.co.uk/dp/B0CR19B55Y");

      expect(result).toBe("");
    });

    it("handles missing optional fields gracefully", async () => {
      mockWebview.mockResolvedValueOnce(`
        <html><body>
          <span id="productTitle">Minimal Product</span>
        </body></html>
      `);

      const result = await extractor.extract("https://www.amazon.com/dp/B000000001");

      expect(result).toBe("# Minimal Product\n\n");
    });

    it("extracts price from split whole/fraction spans", async () => {
      mockWebview.mockResolvedValueOnce(`
        <html><body>
          <span id="productTitle">Test Product</span>
          <span class="a-price-whole">29.</span>
          <span class="a-price-fraction">99</span>
          <span class="a-price-symbol">£</span>
        </body></html>
      `);

      const result = await extractor.extract("https://www.amazon.co.uk/dp/B000000002");

      expect(result).toContain("**Price:** £29.99");
    });

    it("strips 'Visit the' and 'Store' from brand name", async () => {
      mockWebview.mockResolvedValueOnce(`
        <html><body>
          <span id="productTitle">Product</span>
          <a id="bylineInfo">Visit the ACME Store</a>
        </body></html>
      `);

      const result = await extractor.extract("https://www.amazon.com/dp/B000000003");

      expect(result).toContain("**Brand:** ACME");
    });

    it("strips Amazon expander noise from review bodies", async () => {
      mockWebview.mockResolvedValueOnce(`
        <html><body>
          <span id="productTitle">Product</span>
          <div data-hook="review">
            <span class="a-profile-name">A.</span>
            <i data-hook="review-star-rating"><span class="a-icon-alt">5 out of 5 stars</span></i>
            <h5 data-hook="reviewTitle">Great</h5>
            <div data-hook="reviewText">Brief content visible, double tap to read full content.Full content visible, double tap to read brief content.Actual review text here.</div>
          </div>
        </body></html>
      `);

      const result = await extractor.extract("https://www.amazon.com/dp/B000000004");

      expect(result).toContain("Actual review text here.");
      expect(result).not.toContain("Brief content visible");
      expect(result).not.toContain("double tap to read");
    });

    it("returns 'Currently unavailable.' for out-of-stock products with #outOfStock", async () => {
      mockWebview.mockResolvedValueOnce(`
        <html><body>
          <span id="productTitle">Some Product</span>
          <div id="outOfStock"><div class="a-box-inner">
            <span class="a-color-base a-text-bold">Currently unavailable.</span>
          </div></div>
        </body></html>
      `);

      const result = await extractor.extract("https://www.amazon.co.uk/dp/B000000005");

      expect(result).toBe("Currently unavailable.");
    });

    it("returns 'Currently unavailable.' for out-of-stock products with availability message", async () => {
      mockWebview.mockResolvedValueOnce(`
        <html><body>
          <span id="productTitle">Some Product</span>
          <div id="availability">
            <span class="a-size-medium a-color-base primary-availability-message"> Currently unavailable. </span>
          </div>
        </body></html>
      `);

      const result = await extractor.extract("https://www.amazon.co.uk/dp/B000000006");

      expect(result).toBe("Currently unavailable.");
    });

    it("detects 'enter the characters you see below' challenge", async () => {
      mockWebview.mockResolvedValueOnce(AMAZON_PRODUCT_HTML);

      await extractor.extract("https://www.amazon.co.uk/dp/B0CR19B55Y");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body>enter the characters you see below</body></html>",
        ),
      ).toBe(true);
    });

    it("detects 'type the characters you see in this image' challenge", async () => {
      mockWebview.mockResolvedValueOnce(AMAZON_PRODUCT_HTML);

      await extractor.extract("https://www.amazon.co.uk/dp/B0CR19B55Y");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body>type the characters you see in this image</body></html>",
        ),
      ).toBe(true);
    });

    it("detects 'captcha' challenge", async () => {
      mockWebview.mockResolvedValueOnce(AMAZON_PRODUCT_HTML);

      await extractor.extract("https://www.amazon.co.uk/dp/B0CR19B55Y");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body>captcha</body></html>",
        ),
      ).toBe(true);
    });

    it("detects 'are you a robot' challenge", async () => {
      mockWebview.mockResolvedValueOnce(AMAZON_PRODUCT_HTML);

      await extractor.extract("https://www.amazon.co.uk/dp/B0CR19B55Y");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body>are you a robot</body></html>",
        ),
      ).toBe(true);
    });

    it("detects 'sorry, something went wrong' challenge", async () => {
      mockWebview.mockResolvedValueOnce(AMAZON_PRODUCT_HTML);

      await extractor.extract("https://www.amazon.co.uk/dp/B0CR19B55Y");

      const options = mockWebview.mock.calls[0][1];
      expect(
        options?.shouldRetry?.(
          "<html><body>sorry, something went wrong</body></html>",
        ),
      ).toBe(true);
    });

    it("extracts price from #priceblock_dealprice", async () => {
      mockWebview.mockResolvedValueOnce(`
        <html><body>
          <span id="productTitle">Deal Product</span>
          <span id="priceblock_dealprice" class="a-price"><span class="a-offscreen">$29.99</span></span>
        </body></html>
      `);

      const result = await extractor.extract("https://www.amazon.com/dp/B000000007");

      expect(result).toContain("**Price:** $29.99");
    });

    it("extracts price from #priceblock_ourprice", async () => {
      mockWebview.mockResolvedValueOnce(`
        <html><body>
          <span id="productTitle">Our Price Product</span>
          <span id="priceblock_ourprice">$19.99</span>
        </body></html>
      `);

      const result = await extractor.extract("https://www.amazon.com/dp/B000000008");

      expect(result).toContain("**Price:** $19.99");
    });

    it("strips 'Brand: ' prefix from brand name", async () => {
      mockWebview.mockResolvedValueOnce(`
        <html><body>
          <span id="productTitle">Product</span>
          <a id="bylineInfo">Brand: Nike</a>
        </body></html>
      `);

      const result = await extractor.extract("https://www.amazon.com/dp/B000000009");

      expect(result).toContain("**Brand:** Nike");
    });
  });
});
