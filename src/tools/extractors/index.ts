import { ExtractorRegistry } from "./registry";
import { RedditExtractor, setWebViewExtractor } from "./reddit-extractor";
import { AmazonExtractor, setAmazonWebViewExtractor } from "./amazon-extractor";
import {
  ShopifyExtractor,
  setShopifyWebViewExtractor,
} from "./shopify-extractor";

const registry = new ExtractorRegistry();
registry.register(new RedditExtractor());
registry.register(new AmazonExtractor());
registry.register(new ShopifyExtractor());

export {
  registry,
  setWebViewExtractor,
  setAmazonWebViewExtractor,
  setShopifyWebViewExtractor,
};
export { PageExtractor } from "./base-extractor";
export { ExtractorRegistry } from "./registry";
export type { WebViewExtractorOptions } from "./reddit-extractor";
