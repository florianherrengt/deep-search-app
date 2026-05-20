import { describe, it, expect } from "vitest";
import {
  stripNoise,
  htmlToMarkdown,
  extractTitle,
} from "@/lib/content-extraction";

describe("extractTitle", () => {
  it("extracts title from HTML", () => {
    const html =
      "<html><head><title>Test Page</title></head><body></body></html>";
    expect(extractTitle(html)).toBe("Test Page");
  });

  it("returns empty string when no title tag exists", () => {
    const html = "<html><body></body></html>";
    expect(extractTitle(html)).toBe("");
  });

  it("handles whitespace in title", () => {
    const html =
      "<html><head><title>  Spaced Title  </title></head><body></body></html>";
    expect(extractTitle(html)).toBe("Spaced Title");
  });
});

describe("stripNoise", () => {
  it("removes script tags", () => {
    const html =
      "<body><script>alert(1)</script><p>Content</p></body>";
    const result = stripNoise(html);
    expect(result).not.toContain("<script>");
    expect(result).toContain("Content");
  });

  it("removes style tags", () => {
    const html =
      "<body><style>body{}</style><p>Content</p></body>";
    const result = stripNoise(html);
    expect(result).not.toContain("<style>");
    expect(result).toContain("Content");
  });

  it("removes nav, footer, header, aside, noscript, iframe, svg", () => {
    const html =
      "<body><nav>nav</nav><header>hdr</header><aside>side</aside><footer>ftr</footer><noscript>ns</noscript><iframe>if</iframe><svg>s</svg><p>Content</p></body>";
    const result = stripNoise(html);
    expect(result).toContain("Content");
    expect(result).not.toContain("<nav>");
    expect(result).not.toContain("<footer>");
    expect(result).not.toContain("<header>");
    expect(result).not.toContain("<aside>");
  });

  it("extracts article content when article exists", () => {
    const html =
      "<body><nav>Nav</nav><article><p>Article content</p></article></body>";
    const result = stripNoise(html);
    expect(result).toContain("Article content");
    expect(result).not.toContain("Nav");
  });

  it("falls back to main when no article", () => {
    const html =
      "<body><nav>Nav</nav><main><p>Main content</p></main></body>";
    const result = stripNoise(html);
    expect(result).toContain("Main content");
    expect(result).not.toContain("Nav");
  });

  it("falls back to body when no article or main", () => {
    const html =
      "<body><nav>Nav</nav><div><p>Body content</p></div></body>";
    const result = stripNoise(html);
    expect(result).toContain("Body content");
  });
});

describe("htmlToMarkdown", () => {
  it("converts h1 to markdown heading", () => {
    const html = "<h1>Title</h1>";
    expect(htmlToMarkdown(html)).toContain("# Title");
  });

  it("converts h2 to markdown heading", () => {
    const html = "<h2>Subtitle</h2>";
    expect(htmlToMarkdown(html)).toContain("## Subtitle");
  });

  it("converts links", () => {
    const html = '<a href="https://example.com">Link</a>';
    expect(htmlToMarkdown(html)).toContain("[Link](https://example.com)");
  });

  it("converts paragraphs", () => {
    const html = "<p>First</p><p>Second</p>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("First");
    expect(md).toContain("Second");
  });

  it("converts code blocks", () => {
    const html = "<pre><code>const x = 1;</code></pre>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("const x = 1;");
  });

  it("collapses excessive newlines", () => {
    const html = "<p>A</p><p>B</p>";
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("\n\n\n");
  });

  it("trims output", () => {
    const html = "<p>Content</p>";
    const md = htmlToMarkdown(html);
    expect(md).toBe(md.trim());
  });
});
