export const SOCIAL_SOURCE_EXECUTION_GUIDANCE = `## Source coverage

Use source-specific searches when Reddit or YouTube evidence could materially change the answer, not only when the user names those sites.

- Reddit/community evidence: for user reports, troubleshooting, product experiences, buying advice, comparisons, sentiment, and failure reports, run a regular web search with site:reddit.com or site:old.reddit.com plus the topic terms. Treat Reddit as experiential evidence. Extract and cite exact threads or comments, and corroborate important claims with primary sources.
- YouTube/video evidence: for demos, reviews, tutorials, conference talks, walkthroughs, creator evidence, and visual proof, call youtube_search when available. If it is unavailable, run regular web searches with site:youtube.com/watch or site:youtu.be. Then call extract_page_content on selected YouTube video URLs to read transcripts before relying on them.
- aggregate_search is a general web-search fanout. It does not call youtube_search, and it will not intentionally target Reddit unless the query includes Reddit/domain terms.
- If the user explicitly asks for Reddit or YouTube, include that source pass unless no suitable search tool is configured; if unavailable, say so.`;

export const SOCIAL_SOURCE_PLANNING_GUIDANCE = `## Source-specific planning

When the evidence type could matter, include source-specific searches in the plan instead of relying on generic search alone.

- Reddit: for firsthand, user, or community evidence, include suggested searches containing site:reddit.com or site:old.reddit.com, classify them as Experiential, and instruct the executor to corroborate important claims.
- YouTube: for video, demos, tutorials, reviews, talks, walkthroughs, or creator evidence, include a YouTube source pass. Prefer youtube_search when available, otherwise suggest site:youtube.com/watch or site:youtu.be searches, and tell the executor to extract transcripts before relying on videos.
- If the user names Reddit or YouTube, make that source pass explicit.`;

export const GENERAL_WEB_SEARCH_SOURCE_GUIDANCE =
  "Source coverage: for Reddit/community evidence, query site:reddit.com or site:old.reddit.com with the topic terms. If youtube_search is unavailable and video evidence matters, query site:youtube.com/watch or site:youtu.be.";

export const AGGREGATE_SEARCH_SOURCE_GUIDANCE =
  "Source coverage: this is general web search across configured providers. It does not call youtube_search. Use explicit site:reddit.com or site:old.reddit.com queries for Reddit/community evidence, and call youtube_search separately for YouTube/video evidence when available.";

export const YOUTUBE_SEARCH_SOURCE_GUIDANCE =
  "Source coverage: use this when video evidence could matter, including reviews, demos, tutorials, talks, walkthroughs, or creator/community evidence. After selecting useful videos, call extract_page_content on their URLs to read transcripts before relying on them.";
