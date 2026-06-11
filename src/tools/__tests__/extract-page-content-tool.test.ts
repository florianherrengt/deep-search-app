import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri-bridge", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@/lib/tauri-bridge";
import {
  extractPageContent,
  fetchHtml,
  sanitizeHtml,
} from "../extract-page-content-tool";
import { validateUrl, UrlValidationError } from "@/lib/url-validation";

const mockInvoke = vi.mocked(invoke);

const OLD_REDDIT_HTML = `
<html>
<body>
  <div class="thing link" data-author="tester" data-score="10">
    <p class="title"><a class="title">Test Post</a></p>
    <div class="expando"><div class="usertext-body">Body text</div></div>
  </div>
  <div class="commentarea">
    <div class="sitetable nestedlisting">
      <div class="thing comment" data-author="commenter" data-score="3">
        <div class="entry">
          <div class="usertext-body">Hello from old Reddit</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("extractPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(async (command) => {
      if (command === "extract_content") return OLD_REDDIT_HTML;
      return undefined;
    });
  });

  it("extracts reddit URLs through old.reddit.com webview without HTTP fetching reddit.com", async () => {
    const result = await extractPageContent(
      "https://www.reddit.com/r/test/comments/abc/test_post/",
      { summarize: false },
    );

    expect(result).toContain("# Test Post");
    expect(result).toContain("└── **commenter** · 3 pts: Hello from old Reddit");
    expect(mockInvoke).not.toHaveBeenCalledWith("fetch_html", expect.anything());
    expect(mockInvoke).toHaveBeenCalledWith("open_tab", {
      id: expect.any(String),
      url: "https://old.reddit.com/r/test/comments/abc/test_post/",
    });
  });

  it("decodes serialized Tauri callback HTML before parsing reddit content", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "extract_content") return JSON.stringify(OLD_REDDIT_HTML);
      return undefined;
    });

    const result = await extractPageContent(
      "https://www.reddit.com/r/test/comments/abc/test_post/",
      { summarize: false },
    );

    expect(result).toContain("# Test Post");
    expect(result).toContain("└── **commenter** · 3 pts: Hello from old Reddit");
  });

  it("uses the Rust validated fetch command for direct HTML fetching", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "fetch_html") return "<html><body>Hello</body></html>";
      return undefined;
    });

    await expect(fetchHtml("https://example.com/page")).resolves.toContain(
      "Hello",
    );
    expect(mockInvoke).toHaveBeenCalledWith("fetch_html", {
      url: "https://example.com/page",
    });
  });

  it("serializes webview extractions so concurrent calls do not share the active page", async () => {
    const firstExtractStarted = deferred();
    const releaseFirstExtract = deferred();
    const idToUrl = new Map<string, string>();
    const events: string[] = [];
    const firstUrl =
      "https://old.reddit.com/r/test/comments/first/first_post/";
    const secondUrl =
      "https://old.reddit.com/r/test/comments/second/second_post/";

    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "open_tab") {
        const { id, url } = args as { id: string; url: string };
        idToUrl.set(id, url);
        events.push(`open:${url}`);
        return undefined;
      }

      if (command === "extract_content") {
        const { id } = args as { id: string };
        const url = idToUrl.get(id) ?? id;
        events.push(`extract:${url}`);
        if (url === firstUrl) {
          firstExtractStarted.resolve();
          await releaseFirstExtract.promise;
          return OLD_REDDIT_HTML;
        }
        return OLD_REDDIT_HTML;
      }

      if (command === "close_tab") {
        const { id } = args as { id: string };
        events.push(`close:${idToUrl.get(id) ?? id}`);
        return undefined;
      }

      return undefined;
    });

    const first = extractPageContent(
      "https://www.reddit.com/r/test/comments/first/first_post/",
      {
        summarize: false,
      },
    );
    await firstExtractStarted.promise;

    const second = extractPageContent(
      "https://www.reddit.com/r/test/comments/second/second_post/",
      {
        summarize: false,
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    let concurrentOpenError: unknown;
    try {
      expect(events).toEqual([
        `open:${firstUrl}`,
        `extract:${firstUrl}`,
      ]);
    } catch (error) {
      concurrentOpenError = error;
    }

    releaseFirstExtract.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    if (concurrentOpenError) throw concurrentOpenError;
    expect(firstResult).toContain("# Test Post");
    expect(secondResult).toContain("# Test Post");
    expect(events).toEqual([
      `open:${firstUrl}`,
      `extract:${firstUrl}`,
      `close:${firstUrl}`,
      `open:${secondUrl}`,
      `extract:${secondUrl}`,
      `close:${secondUrl}`,
    ]);
  });

  it("extracts compact visible text while preserving product page details", () => {
    const result = sanitizeHtml(`
      <html>
        <head>
          <title>Ignored title chrome</title>
          <meta name="description" content="metadata should not leak" />
          <style>.price { color: red; }</style>
          <script>{"price":"wrong"}</script>
        </head>
        <body>
          <header>Store navigation</header>
          <nav>Deals Departments Account</nav>
          <main>
            <section class="product-detail">
              <h1>ErgoEdge Low Profile Keyboard Tray</h1>
              <div class="rating">4.6 out of 5 stars</div>
              <div class="price">$39.95</div>
              <p>Soft beveled front edge reduces wrist pressure.</p>
              <table>
                <tr><th>Feature</th><th>Value</th></tr>
                <tr><td>Height</td><td>0.75 in</td></tr>
                <tr><td>Material</td><td>Dense foam</td></tr>
              </table>
            </section>
            <section class="recommendations">
              <h2>Similar items</h2>
              <article>
                <h3>Wrist Rest Pro</h3>
                <span>$24.99</span>
                <span>4.4 stars</span>
              </article>
            </section>
          </main>
          <div aria-hidden="true">Hidden modal price $0.01</div>
          <div class="cookie-banner">Accept cookies to continue</div>
          <div id="newsletter-popup">Join our list</div>
          <footer>Footer links</footer>
        </body>
      </html>
    `);

    expect(result).toContain("ErgoEdge Low Profile Keyboard Tray");
    expect(result).toContain("4.6 out of 5 stars");
    expect(result).toContain("$39.95");
    expect(result).toContain("Feature | Value");
    expect(result).toContain("Height | 0.75 in");
    expect(result).toContain("Similar items");
    expect(result).toContain("Wrist Rest Pro");
    expect(result).toContain("$24.99");
    expect(result).not.toContain("<");
    expect(result).not.toContain("metadata should not leak");
    expect(result).not.toContain("wrong");
    expect(result).not.toContain("Store navigation");
    expect(result).not.toContain("Accept cookies");
    expect(result).not.toContain("Hidden modal price");
    expect(result).not.toContain("Join our list");
  });

  it("normalizes whitespace and caps globally repeated boilerplate lines", () => {
    const result = sanitizeHtml(`
      <html>
        <body>
          <main>
            <p>Free returns</p>
            <p>Free returns</p>
            <p>Free returns</p>
            <p>Product A $10</p>
            <p>Product B $12</p>
            <p>Product A $10</p>
          </main>
        </body>
      </html>
    `);

    expect(result.match(/Free returns/g)).toHaveLength(2);
    expect(result.match(/Product A \$10/g)).toHaveLength(2);
    expect(result).toContain("Product B $12");
  });
});

describe("URL validation", () => {
  it("throws for an invalid URL", () => {
    expect(() => validateUrl("not-a-valid-url")).toThrow(UrlValidationError);
  });

  it("throws for non-https protocol", () => {
    expect(() => validateUrl("http://example.com")).toThrow(UrlValidationError);
  });

  it("throws for blocked schemes", () => {
    expect(() => validateUrl("file:///etc/passwd")).toThrow(UrlValidationError);
  });
});

describe("extractPageContent edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(async (command) => {
      if (command === "extract_content") return "<html><body>Fallback content from webview</body></html>";
      return undefined;
    });
  });

  it("falls back to webview when fetched content is shorter than 200 characters", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "fetch_html") return "<html><body>Short</body></html>";
      if (command === "extract_content") return "<html><body>Fallback content from webview with much more text</body></html>";
      return undefined;
    });

    const result = await extractPageContent(
      "https://example.com/page",
      { summarize: false },
    );

    expect(result).toContain("Fallback content");
    expect(mockInvoke).toHaveBeenCalledWith("fetch_html", {
      url: "https://example.com/page",
    });
    expect(mockInvoke).toHaveBeenCalledWith("open_tab", {
      id: expect.any(String),
      url: "https://example.com/page",
    });
  });

  it("returns empty string when fetch and webview both produce no content", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "fetch_html") return null;
      if (command === "extract_content") return "";
      return undefined;
    });

    const result = await extractPageContent(
      "https://example.com/page",
      { summarize: false },
    );

    expect(result).toBe("");
  });

  it("does not fallback to webview when method is fetch even with short content", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "fetch_html") return "<html><body>Hi</body></html>";
      return undefined;
    });

    const result = await extractPageContent(
      "https://example.com/page",
      { method: "fetch", summarize: false },
    );

    expect(result).toContain("Hi");
    expect(mockInvoke).not.toHaveBeenCalledWith("open_tab", expect.anything());
  });
});
