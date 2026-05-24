import { ExtractorRegistry } from "./registry";
import { RedditExtractor, setWebViewExtractor } from "./reddit-extractor";

const registry = new ExtractorRegistry();
registry.register(new RedditExtractor());

export { registry, setWebViewExtractor };
export { PageExtractor } from "./base-extractor";
export { ExtractorRegistry } from "./registry";
