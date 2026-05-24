import { describe, it, expect } from "vitest";
import { ExtractorRegistry } from "../registry";
import { PageExtractor } from "../base-extractor";

class FakeExtractor extends PageExtractor {
  constructor(private domain: string) {
    super();
  }
  canHandle(url: string): boolean {
    return new URL(url).hostname.includes(this.domain);
  }
  async extract(): Promise<string> {
    return "fake";
  }
}

describe("ExtractorRegistry", () => {
  it("returns undefined when no extractor matches", () => {
    const r = new ExtractorRegistry();
    expect(r.find("https://example.com")).toBeUndefined();
  });

  it("returns matching extractor", () => {
    const r = new ExtractorRegistry();
    const reddit = new FakeExtractor("reddit");
    r.register(reddit);
    expect(r.find("https://www.reddit.com/r/test")).toBe(reddit);
  });

  it("checks extractors in registration order, first match wins", () => {
    const r = new ExtractorRegistry();
    const first = new FakeExtractor("reddit");
    const second = new FakeExtractor("reddit");
    r.register(first);
    r.register(second);
    expect(r.find("https://reddit.com/r/test")).toBe(first);
  });
});
