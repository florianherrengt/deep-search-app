import { ExtractorRegistry } from "./registry";
import { RedditExtractor } from "./reddit-extractor";

const registry = new ExtractorRegistry();
registry.register(new RedditExtractor());

export { registry };
export { PageExtractor } from "./base-extractor";
export { ExtractorRegistry } from "./registry";
