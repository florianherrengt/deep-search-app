import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import { extractPageContent } from "../extract-page-content-tool";

const mockInvoke = vi.mocked(invoke);
const mockFetch = vi.mocked(fetch);

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
    expect(mockFetch).not.toHaveBeenCalled();
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
});
