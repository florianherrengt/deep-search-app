import { describe, it, expect } from "vitest";
import { extractors } from "../registry";
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

describe("extractors array", () => {
  it("finds matching extractor via canHandle", () => {
    const list: PageExtractor[] = [];
    const reddit = new FakeExtractor("reddit");
    list.push(reddit);
    expect(list.find((e) => e.canHandle("https://www.reddit.com/r/test"))).toBe(reddit);
  });

  it("returns undefined when no extractor matches", () => {
    expect(extractors.find((e) => e.canHandle("https://example.com"))).toBeUndefined();
  });

  it("checks extractors in order, first match wins", () => {
    const list: PageExtractor[] = [];
    const first = new FakeExtractor("reddit");
    const second = new FakeExtractor("reddit");
    list.push(first, second);
    expect(list.find((e) => e.canHandle("https://reddit.com/r/test"))).toBe(first);
  });
});
