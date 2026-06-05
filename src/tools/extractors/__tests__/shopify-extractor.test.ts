import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ShopifyExtractor,
  setShopifyWebViewExtractor,
} from "../shopify-extractor";

const MOCK_JS_PRODUCT = {
  id: 8584853750098,
  title: "LT 01 Court Lite Premium Nappa White",
  description:
    '<p><span style="font-weight: 400;">This lean low top features all the basics for a perfect white sneaker.</span></p>',
  vendor: "ETQ Amsterdam",
  type: "Footwear",
  handle: "lt-01-court-lite-premium-nappa-white",
  tags: [
    "bestsellers",
    "category-shoes",
    "color-white",
    "pri-color-white",
    "leather-nappa",
    "low-top",
  ],
  price: 14100,
  price_min: 14100,
  price_max: 14100,
  compare_at_price: 19400,
  compare_at_price_min: 19400,
  compare_at_price_max: 19400,
  variants: [
    {
      id: 1,
      title: "EU 39 | US 6 | UK 5",
      option1: "EU 39 | US 6 | UK 5",
      price: 14100,
      compare_at_price: 19400,
    },
    {
      id: 2,
      title: "EU 44 | US 11 | UK 10",
      option1: "EU 44 | US 11 | UK 10",
      price: 14100,
      compare_at_price: 19400,
    },
  ],
  options: [
    {
      name: "Size",
      values: ["EU 39 | US 6 | UK 5", "EU 44 | US 11 | UK 10"],
    },
  ],
};

const MOCK_JSON_PRODUCT = {
  product: {
    id: 8584853750098,
    title: "LT 01 Court Lite Premium Nappa White",
    body_html:
      '<p><span style="font-weight: 400;">This lean low top features all the basics.</span></p>',
    vendor: "ETQ Amsterdam",
    product_type: "Footwear",
    tags: "bestsellers, category-shoes, leather-nappa",
    variants: [
      {
        id: 1,
        title: "EU 39",
        price: "141.00",
        compare_at_price: "194.00",
        sku: "161539",
        option1: "EU 39",
        price_currency: "GBP",
      },
    ],
    options: [{ name: "Size", values: ["EU 39"] }],
  },
};

function wrapJsonInHtml(json: unknown): string {
  return `<html><body><pre>${JSON.stringify(json)}</pre></body></html>`;
}

describe("ShopifyExtractor", () => {
  let extractor: ShopifyExtractor;
  let mockWebview: ReturnType<
    typeof vi.fn<(url: string) => Promise<string | null>>
  >;

  beforeEach(() => {
    extractor = new ShopifyExtractor();
    mockWebview = vi.fn<(url: string) => Promise<string | null>>();
    setShopifyWebViewExtractor(mockWebview);
  });

  describe("canHandle", () => {
    it("matches product page URLs", () => {
      expect(
        extractor.canHandle("https://store.com/products/sneaker-name"),
      ).toBe(true);
      expect(
        extractor.canHandle("https://store.com/en-gb/products/lt-01-court"),
      ).toBe(true);
      expect(
        extractor.canHandle(
          "https://www.etq-amsterdam.com/products/lt-01-court-lite-premium-nappa-white",
        ),
      ).toBe(true);
    });

    it("rejects non-product URLs", () => {
      expect(extractor.canHandle("https://store.com/products.json")).toBe(
        false,
      );
      expect(extractor.canHandle("https://store.com/products/")).toBe(false);
      expect(
        extractor.canHandle("https://store.com/collections/shoes"),
      ).toBe(false);
      expect(extractor.canHandle("https://store.com/")).toBe(false);
    });

    it("rejects singular /product/ paths", () => {
      expect(
        extractor.canHandle("https://store.com/product/sneaker-name"),
      ).toBe(false);
      expect(
        extractor.canHandle("https://store.com/item/sneaker-name"),
      ).toBe(false);
    });

    it("handles URLs with query parameters", () => {
      expect(
        extractor.canHandle(
          "https://store.com/products/sneaker?variant=123",
        ),
      ).toBe(true);
    });
  });

  describe("extract", () => {
    it("extracts and formats a Shopify product from .js endpoint", async () => {
      mockWebview.mockResolvedValue(wrapJsonInHtml(MOCK_JS_PRODUCT));

      const result = await extractor.extract(
        "https://www.etq-amsterdam.com/en-gb/products/lt-01-court-lite-premium-nappa-white",
      );

      expect(mockWebview).toHaveBeenCalledWith(
        "https://www.etq-amsterdam.com/en-gb/products/lt-01-court-lite-premium-nappa-white.js",
      );
      expect(mockWebview).toHaveBeenCalledWith(
        "https://www.etq-amsterdam.com/en-gb/products/lt-01-court-lite-premium-nappa-white.json",
      );

      expect(result).toContain("# LT 01 Court Lite Premium Nappa White");
      expect(result).toContain("**Vendor:** ETQ Amsterdam");
      expect(result).toContain("**Type:** Footwear");
      expect(result).toContain("**Price:** 141.00");
      expect(result).toContain("**Was:** 194.00");
      expect(result).toContain("This lean low top features all the basics");
      expect(result).toContain("## Options");
      expect(result).toContain("**Size:**");
    });

    it("enriches .js output with currency from .json", async () => {
      mockWebview
        .mockResolvedValueOnce(wrapJsonInHtml(MOCK_JS_PRODUCT))
        .mockResolvedValueOnce(wrapJsonInHtml(MOCK_JSON_PRODUCT));

      const result = await extractor.extract(
        "https://store.com/products/test",
      );

      expect(result).toContain("**Price:** £141.00");
      expect(result).toContain("**Was:** £194.00");
    });

    it("falls back to .json-only when .js fails", async () => {
      mockWebview
        .mockResolvedValueOnce("<html><body>Not found</body></html>")
        .mockResolvedValueOnce(wrapJsonInHtml(MOCK_JSON_PRODUCT));

      const result = await extractor.extract(
        "https://store.com/products/test",
      );

      expect(result).toContain("# LT 01 Court Lite Premium Nappa White");
      expect(result).toContain("**Price:** £141.00");
      expect(result).toContain("**Was:** £194.00");
    });

    it("handles price range across variants", async () => {
      const product = {
        ...MOCK_JS_PRODUCT,
        price_min: 9900,
        price_max: 14900,
        compare_at_price_min: 19400,
        compare_at_price_max: 19400,
        variants: [
          { ...MOCK_JS_PRODUCT.variants[0], price: 9900 },
          { ...MOCK_JS_PRODUCT.variants[1], price: 14900 },
        ],
      };
      mockWebview.mockResolvedValue(wrapJsonInHtml(product));

      const result = await extractor.extract(
        "https://store.com/products/test",
      );
      expect(result).toContain("**Price:** 99.00 – 149.00");
    });

    it("handles product with no compare_at_price", async () => {
      const product = {
        ...MOCK_JS_PRODUCT,
        compare_at_price_min: 0,
        compare_at_price_max: 0,
      };
      mockWebview.mockResolvedValue(wrapJsonInHtml(product));

      const result = await extractor.extract(
        "https://store.com/products/test",
      );
      expect(result).toContain("**Price:** 141.00");
      expect(result).not.toContain("**Was:**");
    });

    it("handles product with tags as array", async () => {
      mockWebview.mockResolvedValue(wrapJsonInHtml(MOCK_JS_PRODUCT));

      const result = await extractor.extract(
        "https://store.com/products/test",
      );
      expect(result).toContain("bestsellers");
      expect(result).toContain("leather-nappa");
      expect(result).not.toContain("category-shoes");
      expect(result).not.toContain("pri-color-white");
    });

    it("handles product with no vendor or type", async () => {
      const product = {
        ...MOCK_JS_PRODUCT,
        vendor: "",
        type: "",
      };
      mockWebview.mockResolvedValue(wrapJsonInHtml(product));

      const result = await extractor.extract(
        "https://store.com/products/test",
      );
      expect(result).not.toContain("**Vendor:**");
      expect(result).not.toContain("**Type:**");
      expect(result).toContain("# LT 01");
    });

    it("handles product with no options", async () => {
      const product = { ...MOCK_JS_PRODUCT, options: [] };
      mockWebview.mockResolvedValue(wrapJsonInHtml(product));

      const result = await extractor.extract(
        "https://store.com/products/test",
      );
      expect(result).not.toContain("## Options");
    });

    it("strips HTML tags from description", async () => {
      const product = {
        ...MOCK_JS_PRODUCT,
        description: "<p><strong>Bold</strong> and <em>italic</em> text</p>",
      };
      mockWebview.mockResolvedValue(wrapJsonInHtml(product));

      const result = await extractor.extract(
        "https://store.com/products/test",
      );
      expect(result).toContain("Bold and italic text");
      expect(result).not.toContain("<strong>");
    });

    it("returns empty when both endpoints fail", async () => {
      mockWebview.mockResolvedValue(null);

      const result = await extractor.extract(
        "https://store.com/products/test",
      );
      expect(result).toBe("");
    });

    it("returns empty when webview is not set", async () => {
      setShopifyWebViewExtractor(null as never);

      const result = await extractor.extract(
        "https://store.com/products/test",
      );
      expect(result).toBe("");
    });

    it("returns empty when JSON is not valid Shopify data", async () => {
      mockWebview.mockResolvedValue(
        wrapJsonInHtml({ error: "Not found" }),
      );

      const result = await extractor.extract(
        "https://store.com/products/test",
      );
      expect(result).toBe("");
    });

    it("strips query params and hash from API URLs", async () => {
      mockWebview.mockResolvedValue(wrapJsonInHtml(MOCK_JS_PRODUCT));

      await extractor.extract(
        "https://store.com/products/test?variant=123#reviews",
      );

      expect(mockWebview).toHaveBeenCalledWith(
        "https://store.com/products/test.js",
      );
      expect(mockWebview).toHaveBeenCalledWith(
        "https://store.com/products/test.json",
      );
    });

    it("handles JSON with body text instead of pre tag", async () => {
      mockWebview.mockResolvedValue(
        `<html><body>${JSON.stringify(MOCK_JS_PRODUCT)}</body></html>`,
      );

      const result = await extractor.extract(
        "https://store.com/products/test",
      );
      expect(result).toContain("# LT 01 Court Lite Premium Nappa White");
    });
  });
});
