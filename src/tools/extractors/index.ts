import { extractors } from "./registry";
import { RedditExtractor, setWebViewExtractor } from "./reddit-extractor";
import { AmazonExtractor, setAmazonWebViewExtractor } from "./amazon-extractor";
import {
  ShopifyExtractor,
  setShopifyWebViewExtractor,
} from "./shopify-extractor";

extractors.push(new RedditExtractor(), new AmazonExtractor(), new ShopifyExtractor());

export {
  extractors,
  setWebViewExtractor,
  setAmazonWebViewExtractor,
  setShopifyWebViewExtractor,
};
export { PageExtractor } from "./base-extractor";
export type { WebViewExtractorOptions } from "./reddit-extractor";
