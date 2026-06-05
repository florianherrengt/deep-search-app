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
  const last = comments.length - 1;

  return comments
    .flatMap((comment, index) => {
      const isLast = index === last;
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";
      const body = truncate(comment.body.replace(/\n/g, " "));
      const lines = [
        `${prefix}${connector}**${comment.author}** · ${scoreStr(comment.score)}: ${body}`,
      ];

      if (comment.replies.length > 0) {
        lines.push(renderCommentTree(comment.replies, prefix + childPrefix));
      }

      return lines;
    })
    .join("\n");
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
