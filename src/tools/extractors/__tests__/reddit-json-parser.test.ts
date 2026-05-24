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
    expect(md).toContain("**op_user** · 42 pts");
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
