# Custom Page Extractors

## Problem

The generic HTML-to-markdown pipeline produces poor results for sites with structured data behind JS-heavy UIs or JSON APIs. Reddit threads lose their comment tree structure, making research extraction unreliable.

## Solution

A registry of site-specific extractors. Each extractor knows how to get the best possible content from its target site. When a URL matches a registered extractor, it takes over completely. No match falls through to the default pipeline.

## Architecture

```
src/tools/extractors/
  base-extractor.ts        ← abstract class
  registry.ts              ← extractor registry, used by extract-page-content-tool
  reddit-extractor.ts      ← Reddit threads
```

### Abstract class

```ts
export abstract class PageExtractor {
  abstract canHandle(url: string): boolean;
  abstract extract(url: string): Promise<string>; // always returns markdown
}
```

- `canHandle` — lightweight URL check (domain match), no network calls
- `extract` — full extraction, owns its own HTTP and parsing logic
- Always returns a markdown string. Empty string on failure.

### Registry

```ts
export class ExtractorRegistry {
  private extractors: PageExtractor[] = [];

  register(extractor: PageExtractor): void;
  find(url: string): PageExtractor | undefined;
}
```

Single instance created once, all extractors registered at import time.

### Integration with extract-page-content-tool

In the `execute` function, before the default fetch/process pipeline:

```ts
const extractor = registry.find(url);
if (extractor) {
  markdown = await extractor.extract(url);
} else {
  // existing default pipeline
}
```

The extractor runs regardless of `method` param — if a URL matches a custom extractor, the extractor knows best.

## Reddit Extractor

### Strategy (ordered)

1. **JSON API** — append `.json` to the Reddit URL. Parse the listing structure for post + comments. Build tree markdown.
2. **Old Reddit HTML** — replace domain with `old.reddit.com`, fetch HTML, parse with cheerio into tree structure.

Both strategies produce the same tree-shaped markdown output.

### JSON API parsing

Reddit `.json` returns an array of two listings:
- `[0]` = post listing (title, body, score, author)
- `[1]` = comment listing (recursive tree via `replies` field)

Each comment has: `author`, `body`, `score`, `replies` (which contains more comments).

### Output format

```markdown
# Post Title

> **author** · 42 points · 2h ago

Post body text here.

## Comments

├── **user1** · 5 pts: First comment text
│   ├── **user2** · 2 pts: Reply to first
│   └── **user3** · 1 pt: Another reply
└── **user4** · 10 pts: Second top-level comment
    └── **user5** · 3 pts: Deep reply
```

- Post header uses heading + blockquote metadata
- Comments use tree-drawing characters (├──, └──, │)
- Each comment: `**author** · score pts: text`
- Truncate long comment bodies at ~500 chars with `[...]`

### Error handling

- JSON fetch fails (403, rate limit, non-JSON response) → fall back to old Reddit
- Old Reddit fetch fails → return empty string, let the tool's webview fallback handle it
- Network timeout: 10s per request (matching existing `FETCH_TIMEOUT_MS`)

## Adding new extractors

1. Create `src/tools/extractors/<site>-extractor.ts`
2. Extend `PageExtractor`, implement `canHandle` and `extract`
3. Register in `registry.ts`

No changes to `extract-page-content-tool.ts` needed beyond the initial registry integration.
