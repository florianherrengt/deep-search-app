import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { extractPageContent, fetchHtml } from "../extract-page-content-tool";

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
});
