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

  it("renders '1 comment' (singular) for num_comments: 1", () => {
    const post: RedditPost = { ...samplePost, num_comments: 1 };
    const md = parseRedditJson(post, []);
    expect(md).not.toContain("1 comments");
  });

  it("collapses newlines in comment bodies to spaces", () => {
    const comments: RedditComment[] = [
      {
        author: "multiline",
        body: "Line one\nLine two\nLine three",
        score: 1,
        created_utc: 0,
        replies: [],
      },
    ];
    const md = parseRedditJson(samplePost, comments);
    expect(md).toContain("Line one Line two Line three");
    expect(md).not.toContain("\nLine two");
  });

  it("renders 3+ levels of nested comments with correct tree connectors", () => {
    const comments: RedditComment[] = [
      {
        author: "l1",
        body: "Level 1",
        score: 5,
        created_utc: 0,
        replies: [
          {
            author: "l2",
            body: "Level 2",
            score: 3,
            created_utc: 0,
            replies: [
              {
                author: "l3",
                body: "Level 3",
                score: 1,
                created_utc: 0,
                replies: [],
              },
            ],
          },
        ],
      },
      {
        author: "sibling",
        body: "Sibling comment",
        score: 2,
        created_utc: 0,
        replies: [],
      },
    ];
    const md = parseRedditJson(samplePost, comments);
    expect(md).toContain("├── **l1** · 5 pts: Level 1");
    expect(md).toContain("│   └── **l2** · 3 pts: Level 2");
    expect(md).toContain("│       └── **l3** · 1 pt: Level 3");
    expect(md).toContain("└── **sibling** · 2 pts: Sibling comment");
  });

  it("renders zero score as '0 pts'", () => {
    const comments: RedditComment[] = [
      { author: "zero", body: "zero score", score: 0, created_utc: 0, replies: [] },
    ];
    const md = parseRedditJson(samplePost, comments);
    expect(md).toContain("0 pts");
  });

  it("renders negative score correctly", () => {
    const comments: RedditComment[] = [
      { author: "neg", body: "negative", score: -5, created_utc: 0, replies: [] },
    ];
    const md = parseRedditJson(samplePost, comments);
    expect(md).toContain("-5 pts");
  });

  it("omits body section when selftext is whitespace only", () => {
    const post: RedditPost = { ...samplePost, selftext: "   " };
    const md = parseRedditJson(post, []);
    expect(md).not.toContain("   ");
  });

  it("renders num_comments count in post metadata", () => {
    const md = parseRedditJson(samplePost, []);
    expect(md).toContain("5 comments");
  });
});
