# Custom Page Extractors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a registry-based custom extractor system to extract-page-content-tool, starting with a Reddit extractor that returns comment trees as markdown.

**Architecture:** Abstract `PageExtractor` base class with `canHandle(url)` and `extract(url)` → markdown. A `ExtractorRegistry` holds all extractors. The extract-page-content-tool checks the registry before the default pipeline. Reddit extractor tries `.json` API first, falls back to `old.reddit.com` HTML scraping.

**Tech Stack:** TypeScript, cheerio (already in project), turndown (already in project), @tauri-apps/plugin-http `fetch` (existing pattern)

---

### Task 1: Abstract base class

**Files:**
- Create: `src/tools/extractors/base-extractor.ts`

- [ ] **Step 1: Create the base extractor abstract class**

```ts
export abstract class PageExtractor {
  abstract canHandle(url: string): boolean;
  abstract extract(url: string): Promise<string>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/extractors/base-extractor.ts
git commit -m "feat: add PageExtractor abstract base class"
```

---

### Task 2: Extractor registry

**Files:**
- Create: `src/tools/extractors/registry.ts`

- [ ] **Step 1: Write test for registry**

Create `src/tools/extractors/__tests__/registry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/extractors/__tests__/registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the registry**

Create `src/tools/extractors/registry.ts`:

```ts
import { PageExtractor } from "./base-extractor";

export class ExtractorRegistry {
  private extractors: PageExtractor[] = [];

  register(extractor: PageExtractor): void {
    this.extractors.push(extractor);
  }

  find(url: string): PageExtractor | undefined {
    return this.extractors.find((e) => e.canHandle(url));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/extractors/__tests__/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/extractors/registry.ts src/tools/extractors/__tests__/registry.test.ts
git commit -m "feat: add ExtractorRegistry with tests"
```

---

### Task 3: Reddit JSON parser — tree builder

This task builds the pure-function logic for converting Reddit's JSON response into a tree of comment nodes and rendering them as markdown. No network calls yet.

**Files:**
- Create: `src/tools/extractors/reddit-json-parser.ts`
- Create: `src/tools/extractors/__tests__/reddit-json-parser.test.ts`

- [ ] **Step 1: Write tests for the JSON parser**

```ts
import { describe, it, expect } from "vitest";
import { parseRedditJson, type RedditComment, type RedditPost } from "../reddit-json-parser";

const samplePost: RedditPost = {
  title: "Test Post Title",
  selftext: "This is the post body.",
  author: "op_user",
  score: 42,
  created_utc: 1779386106,
  num_comments: 5,
};

const sampleComments: RedditComment[] = [
  {
    author: "user1",
    body: "First comment",
    score: 5,
    created_utc: 1779387000,
    replies: [
      {
        author: "user2",
        body: "Reply to first",
        score: 2,
        created_utc: 1779387100,
        replies: [],
      },
    ],
  },
  {
    author: "user3",
    body: "Second comment",
    score: 10,
    created_utc: 1779387200,
    replies: [],
  },
];

describe("parseRedditJson", () => {
  it("renders post title as heading", () => {
    const md = parseRedditJson(samplePost, []);
    expect(md).toContain("# Test Post Title");
  });

  it("renders post metadata in blockquote", () => {
    const md = parseRedditJson(samplePost, []);
    expect(md).toContain("**op_user** · 42 points");
  });

  it("renders post body", () => {
    const md = parseRedditJson(samplePost, []);
    expect(md).toContain("This is the post body.");
  });

  it("renders comments in tree format", () => {
    const md = parseRedditJson(samplePost, sampleComments);
    expect(md).toContain("├── **user1** · 5 pts: First comment");
    expect(md).toContain("│   └── **user2** · 2 pts: Reply to first");
    expect(md).toContain("└── **user3** · 10 pts: Second comment");
  });

  it("handles single comment without tree branches", () => {
    const single: RedditComment[] = [
      { author: "lonely", body: "Only comment", score: 1, created_utc: 0, replies: [] },
    ];
    const md = parseRedditJson(samplePost, single);
    expect(md).toContain("└── **lonely** · 1 pt: Only comment");
  });

  it("truncates long comment bodies", () => {
    const long: RedditComment[] = [
      {
        author: "talkative",
        body: "x".repeat(600),
        score: 1,
        created_utc: 0,
        replies: [],
      },
    ];
    const md = parseRedditJson(samplePost, long);
    expect(md).toContain("[...]");
  });

  it("handles empty comments array", () => {
    const md = parseRedditJson(samplePost, []);
    expect(md).toContain("# Test Post Title");
    expect(md).not.toContain("## Comments");
  });

  it("renders score as 'pt' for singular", () => {
    const comments: RedditComment[] = [
      { author: "u", body: "hi", score: 1, created_utc: 0, replies: [] },
    ];
    const md = parseRedditJson(samplePost, comments);
    expect(md).toContain("1 pt:");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/extractors/__tests__/reddit-json-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the JSON parser**

Create `src/tools/extractors/reddit-json-parser.ts`:

```ts
export interface RedditPost {
  title: string;
  selftext: string;
  author: string;
  score: number;
  created_utc: number;
  num_comments: number;
}

export interface RedditComment {
  author: string;
  body: string;
  score: number;
  created_utc: number;
  replies: RedditComment[];
}

const MAX_BODY_LENGTH = 500;

function truncate(text: string): string {
  if (text.length <= MAX_BODY_LENGTH) return text;
  return text.slice(0, MAX_BODY_LENGTH) + " [...]";
}

function scoreStr(n: number): string {
  return n === 1 ? "1 pt" : `${n} pts`;
}

function renderCommentTree(
  comments: RedditComment[],
  prefix: string,
): string {
  const lines: string[] = [];
  const last = comments.length - 1;

  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    const isLast = i === last;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    const body = truncate(c.body.replace(/\n/g, " "));
    lines.push(`${prefix}${connector}**${c.author}** · ${scoreStr(c.score)}: ${body}`);

    if (c.replies.length > 0) {
      lines.push(renderCommentTree(c.replies, prefix + childPrefix));
    }
  }

  return lines.join("\n");
}

export function parseRedditJson(
  post: RedditPost,
  comments: RedditComment[],
): string {
  const parts: string[] = [];

  parts.push(`# ${post.title}`);
  parts.push("");
  parts.push(`> **${post.author}** · ${scoreStr(post.score)} · ${post.num_comments} comments`);
  parts.push("");

  if (post.selftext.trim()) {
    parts.push(post.selftext.trim());
    parts.push("");
  }

  if (comments.length > 0) {
    parts.push("## Comments");
    parts.push("");
    parts.push(renderCommentTree(comments, ""));
  }

  return parts.join("\n").trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/extractors/__tests__/reddit-json-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/extractors/reddit-json-parser.ts src/tools/extractors/__tests__/reddit-json-parser.test.ts
git commit -m "feat: add Reddit JSON parser with tree rendering and tests"
```

---

### Task 4: Reddit extractor — JSON API + old.reddit fallback

This task implements the full `RedditExtractor` that fetches data from Reddit and uses the parser from Task 3.

**Files:**
- Create: `src/tools/extractors/reddit-extractor.ts`
- Create: `src/tools/extractors/__tests__/reddit-extractor.test.ts`

The test mocks `fetch` to verify strategy selection and parsing without real network calls.

- [ ] **Step 1: Write tests for the Reddit extractor**

The tests mock the global `fetch` used via `@tauri-apps/plugin-http`. Since the extractor uses the same `fetch` imported in the tool file, we need to understand how the project's fetch works. The extractor will import `fetch` from `@tauri-apps/plugin-http` directly.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

import { fetch } from "@tauri-apps/plugin-http";
import { RedditExtractor } from "../reddit-extractor";

const mockFetch = vi.mocked(fetch);

const mockRedditJson = {
  postListing: [
    {
      kind: "Listing",
      data: {
        children: [
          {
            kind: "t3",
            data: {
              title: "Test Post",
              selftext: "Body text",
              author: "tester",
              score: 10,
              created_utc: 1779386106,
              num_comments: 2,
            },
          },
        ],
      },
    },
  ],
  commentListing: [
    {
      kind: "Listing",
      data: {
        children: [
          {
            kind: "t1",
            data: {
              author: " commenter1",
              body: "Hello",
              score: 3,
              created_utc: 1779387000,
              replies: "",
            },
          },
          {
            kind: "t1",
            data: {
              author: "commenter2",
              body: "World",
              score: 1,
              created_utc: 1779387100,
              replies: "",
            },
          },
        ],
      },
    },
  ],
};

function jsonResponse(data: unknown, status = 200) {
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    ok: status < 400,
  } as Response;
}

describe("RedditExtractor", () => {
  let extractor: RedditExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    extractor = new RedditExtractor();
  });

  describe("canHandle", () => {
    it("matches reddit.com URLs", () => {
      expect(extractor.canHandle("https://www.reddit.com/r/test/comments/abc/")).toBe(true);
    });

    it("matches old.reddit.com URLs", () => {
      expect(extractor.canHandle("https://old.reddit.com/r/test/comments/abc/")).toBe(true);
    });

    it("does not match non-reddit URLs", () => {
      expect(extractor.canHandle("https://example.com")).toBe(false);
    });
  });

  describe("extract", () => {
    it("fetches .json and returns markdown", async () => {
      const combined = [...mockRedditJson.postListing, ...mockRedditJson.commentListing];
      mockFetch.mockResolvedValueOnce(jsonResponse(combined) as any);

      const result = await extractor.extract(
        "https://www.reddit.com/r/test/comments/abc/test_post/",
      );

      expect(result).toContain("# Test Post");
      expect(result).toContain("## Comments");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://www.reddit.com/r/test/comments/abc/test_post.json",
        expect.any(Object),
      );
    });

    it("returns empty string when both strategies fail", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));

      const result = await extractor.extract(
        "https://www.reddit.com/r/test/comments/abc/test_post/",
      );

      expect(result).toBe("");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/extractors/__tests__/reddit-extractor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the Reddit extractor**

Create `src/tools/extractors/reddit-extractor.ts`:

```ts
import { fetch } from "@tauri-apps/plugin-http";
import { PageExtractor } from "./base-extractor";
import { parseRedditJson, type RedditComment, type RedditPost } from "./reddit-json-parser";

const FETCH_TIMEOUT_MS = 10_000;

function isRedditUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "reddit.com" || host.endsWith(".reddit.com");
  } catch {
    return false;
  }
}

function toJsonUrl(url: string): string {
  const u = new URL(url);
  u.hostname = "www.reddit.com";
  const path = u.pathname.replace(/\/$/, "");
  return `https://www.reddit.com${path}.json`;
}

function toOldRedditUrl(url: string): string {
  const u = new URL(url);
  u.hostname = "old.reddit.com";
  return u.toString();
}

interface RawComment {
  kind: string;
  data: {
    author: string;
    body: string;
    score: number;
    created_utc: number;
    replies: unknown;
  };
}

function parseReplies(replies: unknown): RedditComment[] {
  if (!replies || typeof replies === "string") return [];
  const listing = replies as { data: { children: RawComment[] } };
  if (!listing.data?.children) return [];
  return listing.data.children
    .filter((c) => c.kind === "t1")
    .map((c) => ({
      author: c.data.author,
      body: c.data.body,
      score: c.data.score,
      created_utc: c.data.created_utc,
      replies: parseReplies(c.data.replies),
    }));
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch {
    return null;
  }
}

async function extractViaJson(url: string): Promise<string | null> {
  const jsonUrl = toJsonUrl(url);
  const response = await fetchWithTimeout(jsonUrl);
  if (!response || response.status !== 200) return null;

  try {
    const data = (await response.json()) as Array<{
      data: { children: Array<{ kind: string; data: Record<string, unknown> }> };
    }>;

    const postData = data[0]?.data?.children?.[0]?.data;
    if (!postData || !postData.title) return null;

    const post: RedditPost = {
      title: postData.title as string,
      selftext: (postData.selftext as string) ?? "",
      author: (postData.author as string) ?? "[deleted]",
      score: (postData.score as number) ?? 0,
      created_utc: (postData.created_utc as number) ?? 0,
      num_comments: (postData.num_comments as number) ?? 0,
    };

    const rawComments = (data[1]?.data?.children ?? []) as RawComment[];
    const comments: RedditComment[] = rawComments
      .filter((c) => c.kind === "t1")
      .map((c) => ({
        author: c.data.author || "[deleted]",
        body: c.data.body || "[deleted]",
        score: c.data.score,
        created_utc: c.data.created_utc,
        replies: parseReplies(c.data.replies),
      }));

    return parseRedditJson(post, comments);
  } catch {
    return null;
  }
}

async function extractViaOldReddit(url: string): Promise<string | null> {
  const oldUrl = toOldRedditUrl(url);
  const response = await fetchWithTimeout(oldUrl);
  if (!response) return null;

  try {
    const html = await response.text();
    if (!html) return null;

    const { load } = await import("cheerio");
    const $ = load(html);

    const title = $("p.title > a.title").first().text().trim();
    const author = $(".tagline .author").first().text().trim();
    const selftext = $(".expando .usertext-body").first().text().trim();

    if (!title) return null;

    interface OldComment {
      author: string;
      body: string;
      score: number;
    }

    const comments: OldComment[] = [];
    $(".comment").each((_, el) => {
      const cAuthor = $(el).find(".tagline .author").first().text().trim();
      const cBody = $(el).find(".usertext-body").first().text().trim();
      const cScore = parseInt($(el).find(".score.unvoted").first().text(), 10) || 0;
      comments.push({ author: cAuthor, body: cBody, score: cScore });
    });

    const post: RedditPost = {
      title,
      selftext,
      author: author || "[unknown]",
      score: 0,
      created_utc: 0,
      num_comments: comments.length,
    };

    const redditComments: RedditComment[] = comments.map((c) => ({
      author: c.author || "[deleted]",
      body: c.body,
      score: c.score,
      created_utc: 0,
      replies: [],
    }));

    return parseRedditJson(post, redditComments);
  } catch {
    return null;
  }
}

export class RedditExtractor extends PageExtractor {
  canHandle(url: string): boolean {
    return isRedditUrl(url);
  }

  async extract(url: string): Promise<string> {
    if (url.includes(".json")) return "";

    const jsonResult = await extractViaJson(url);
    if (jsonResult) return jsonResult;

    const oldResult = await extractViaOldReddit(url);
    if (oldResult) return oldResult;

    return "";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/extractors/__tests__/reddit-extractor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/extractors/reddit-extractor.ts src/tools/extractors/__tests__/reddit-extractor.test.ts
git commit -m "feat: add RedditExtractor with JSON API and old.reddit fallback"
```

---

### Task 5: Wire registry into extract-page-content-tool

**Files:**
- Create: `src/tools/extractors/index.ts` (barrel export + registry setup)
- Modify: `src/tools/extract-page-content-tool.ts` (add registry check)

- [ ] **Step 1: Create barrel export with registry setup**

Create `src/tools/extractors/index.ts`:

```ts
import { ExtractorRegistry } from "./registry";
import { RedditExtractor } from "./reddit-extractor";

const registry = new ExtractorRegistry();
registry.register(new RedditExtractor());

export { registry };
export { PageExtractor } from "./base-extractor";
export { ExtractorRegistry } from "./registry";
```

- [ ] **Step 2: Modify extract-page-content-tool to use registry**

In `src/tools/extract-page-content-tool.ts`, add the import and modify the `execute` function:

Add import at top:
```ts
import { registry } from "./extractors";
```

Replace the beginning of the `execute` function body (the part that handles `forced === "webview"` and the else block) with:

```ts
    execute: async ({ url, query, summarize: doSummarize, method }) => {
      const forced = method ?? "auto";
      let html: string | null = null;
      let markdown = "";

      const extractor = registry.find(url);
      if (extractor) {
        markdown = await extractor.extract(url);
      } else if (forced === "webview") {
        html = await extractViaWebview(url);
        markdown = html ? processHtml(html) : "";
      } else {
        html = await fetchHtml(url);
        markdown = html ? processHtml(html) : "";
        if (forced === "auto" && markdown.length < MIN_CONTENT_LENGTH) {
          html = await extractViaWebview(url);
          markdown = html ? processHtml(html) : "";
        }
      }
```

The rest of the execute function (file saving, summarization, return) stays the same.

- [ ] **Step 3: Run all existing tests to verify nothing broke**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/tools/extractors/index.ts src/tools/extract-page-content-tool.ts
git commit -m "feat: wire extractor registry into extract-page-content-tool"
```

---

### Task 6: Verify build and typecheck

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass
