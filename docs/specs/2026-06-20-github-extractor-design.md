# GitHub Custom Extractor — Design

Date: 2026-06-20
Status: Approved (design review)
Scope: Repo-overview extraction for GitHub repository pages.

## Goal

Add a `GitHubExtractor` to the extraction pipeline so that `extract_page_content`
returns clean, structured Markdown for GitHub repository overview pages instead
of generic scraped HTML. It targets repository metadata, languages, top
contributors, README, and commit activity.

## Non-goals (this phase)

- Issue, PR, release, gist, source-file, and profile pages. These can be added
  later as additional handlers or a follow-on extractor.
- GitHub authentication / token settings. Unauthenticated only.
- Editing `node_modules/deep-search-core` in place as the source of truth. The
  real source is the upstream clone.

## Location

Two repositories are involved:

1. **Upstream core** (`/Users/florian/projects/deep-search-core`) — the source of
   truth. Add:
   - `src/search-extract/extract/extractors/github.ts` — the extractor.
   - `src/search-extract/extract/extractors/__tests__/github-extractor.test.ts`
     — unit tests (Vitest, no network), mirroring `shopify-extractor.test.ts`.
   - Export `GitHubExtractor` from `src/search-extract/index.ts`.
   - Build (`tsc -p tsconfig.build.json && node scripts/fix-extensions.mjs`) so
     `dist/` is regenerated.

2. **App** (`/Users/florian/projects/deep-search-app`) — registration only:
   - `src/tools/extract-page-content-tool.ts`: import `GithubExtractor` and add
     it to the `extractors` array passed to `createSearchExtractEngine`.
   - **No CSP or capability changes.** The extractor renders `github.com` (an
     ordinary site the webview already loads for any extraction target) and does
     not call `api.github.com` or any new external domain.

### Persistence

`node_modules/deep-search-core` is a flattened, gitignored git dependency that is
re-cloned on `npm install`. The implementation lives in the upstream clone so it
survives reinstalls once committed/pushed there and the app's `package.json` git
ref is bumped. The agent will not push to the remote or bump the ref unless
explicitly asked.

## URL matching — `canHandle(url)`

Accepts when:

- Host is `github.com` or a `*.github.com` subdomain that is actually a repo view
  (treat bare `github.com` only; subdomains like `gist.github.com`,
  `api.github.com`, `docs.github.com` are rejected).
- Path is exactly `/:owner/:repo` or `/:owner/:repo/` (two non-empty segments).
- A trailing hash/anchor is allowed (`/:owner/:repo#readme`).
- No query segments that imply a non-overview view (e.g. `?tab=`, `/tree/`,
  `/blob/`). Reserved first segments are rejected: `settings`, `orgs`, `topics`,
  `search`, `explore`, `notifications`, `features`, `marketplace`, `pulls`,
  `issues`, `new`, `sessions`, `login`, `signup`, `security`, `about`,
  `pricing`, `customer-stories`, `enterprise`, `sponsors`.

If `canHandle` is false, the engine proceeds to generic extraction.

## Data source — HTML scrape of the repo overview (single render)

Originally this design proposed "API-first via `api.github.com`." During
implementation two hard constraints in the app made that impractical, so the
shipped approach is **HTML scraping of `github.com/:owner/:repo` via a single
`renderHtml` call** (the Amazon/Reddit pattern). The deviation and its reasons:

1. **`fetch_html` rejects JSON.** The Rust command forces
   `Accept: text/html,application/xhtml+xml` and `content_type_is_allowed`
   returns true only for `text/html` / `application/xhtml+xml`
   (`src-tauri/src/lib.rs:284-292`, `339-348`). So the GitHub REST API
   (`application/json`) cannot be retrieved through `loader.fetchHtml`.
2. **`renderHtml` exposes only body text, not headers.** Commit count is only
   available via the `/commits` endpoint's `Link` header pagination, which a
   webview render cannot read. The renderer shows the JSON body but not the
   `Link` header.

API-via-render would therefore cost ~5 serialized webview renders per extraction
**and** still could not produce a commit count. A single HTML render of the
overview page yields every requested field — including commit count, last commit
date, language percentages, contributor count, and README — in one render, with
no new domains and no Rust changes.

### How each field is read from the rendered overview HTML

| Field | Source in DOM (with fallbacks) |
|---|---|
| Full name | `meta[property="og:title"]` → repo title `<h1>` link href |
| Description | `meta[property="og:description"]` / `meta[name="description"]` |
| Stars | `#repo-stars-counter-star` → `a[href$='/stargazers']` |
| Forks | `#repo-network-counter` → `a[href$='/forks']` / `a[href$='/network/members']` |
| Watchers | `#repo-notifications-counter` → `a[href$='/watchers']` |
| Topics | `.topic-tag` text |
| Homepage | first non-`github.com` `a[href^='http']` in the about `BorderGrid-row` |
| License | `a[href*='/blob/'][href*='LICENSE' i]` text |
| Languages (%) | the "Languages" heading's container → `span.color-fg-default.text-bold` + percent spans |
| Contributors count + top names | `a[href$='/graphs/contributors']` count; avatar `alt` attributes |
| Commit count + last commit date | `a[href*='/commits/']` whose text contains "commit"; first `relative-time[datetime]` |
| Status flags | archived/fork/disabled banner text |
| README | `article.markdown-body` → bounded HTML→Markdown converter (headings, lists, code blocks with language, tables, blockquotes, links, emphasis) |

All extraction is defensive: each field uses multiple fallback selectors and is
**omitted** from the output when not found, rather than printing placeholders.

### Failure handling

- **404 / private / renamed repo** — `isGithubNotFoundHtml` detects the GitHub
  404 page (title "Page not found" / the "not the web page you are looking for"
  marker) and `parseGithubRepoHtml` returns `null`.
- **No repo shell** — if the page has no recognizable repo chrome (no
  `article.markdown-body`, no stargazers link, no repo pjax container), the
  parser returns `null`.
- In both `null` cases the engine falls through to **generic extraction**, so
  the user still gets some content rather than an error.
- Abort errors are rethrown; all other errors return `null`.

There is no API rate-limit concern in this approach (it loads the public
website like any other extraction target).

## Output format

Clean Markdown, built by `formatParsedRepo`:

```
# facebook/react
The library for web and native user interfaces.

Stars: 228k · Forks: 47.3k · Watchers: 6.1k
License: MIT license · Languages: JavaScript 92.3% · HTML 4.2% · TypeScript 3.5%
Topics: javascript, react, ui
Homepage: https://react.dev
Contributors: 1692 · Top: @gaearon, @sebmarkbage
Commits: 1234 · Last commit: 2026-05-14T10:00:00Z

## README

# React
...
```

Rules:

- Omit any line whose data is missing rather than printing empty placeholders.
- The last-commit date is the `datetime` attribute of the first `relative-time`
  on the page (ISO 8601), preserved verbatim for traceability.
- The status line (`Status: archived, fork, ...`) is omitted entirely if no
  flags are true.
- The README section is omitted if no `article.markdown-body` is present.
- If parsing yields nothing (404 / private / no repo shell), `parseGithubRepoHtml`
  returns `null` and the engine falls through to **generic extraction**, which
  surfaces its own content/error.

`ExtractorResult.html` is set to the rendered GitHub page so the caller in
`extract-page-content-tool.ts` can save the raw HTML to the research folder,
matching the generic fetch path's behaviour.

`usedCustomExtractor` will be `true` (set by the engine) whenever this extractor
returns content, which disables default summarization unless a `query` is
provided — matching the behaviour for Reddit/Amazon/Shopify.

## Tests (upstream, Vitest, no network)

`__tests__/github-extractor.test.ts` — 19 tests, all passing:

1. **URL matching** — `isGithubRepoOverviewUrl` / `canHandle` accept
   `github.com/owner/repo`, trailing slash, `#readme` anchor; reject subpaths
   (`/issues`, `/blob/`, `/tree/`), reserved first segments (`/settings`,
   `/topics`), `gist.github.com`, `api.github.com`, and non-github hosts.
2. **404 detection** — `isGithubNotFoundHtml` flags the GitHub 404 page and does
   not flag a real repo page.
3. **Parser happy path** — on a representative repo DOM fixture, asserts full
   name, description, stars/forks/watchers counters, topics, homepage, license,
   language percentages, contributor count + top names, commit count + last
   commit date, and README→Markdown conversion (headings, fenced code with
   language, list, blockquote, bold/italic, link, table row).
4. **Null cases** — 404 page → `null`; page with no repo shell → `null`.
5. **Extractor integration** — `extract` returns formatted Markdown + the raw
   HTML; returns `null` on 404, on empty render, and when the loader has no
   `renderHtml`.

All DOM is mocked via an inline HTML fixture and a mock `loader.renderHtml`; no
real network calls.

## Resolved questions (from implementation)

1. **Custom headers via the loader — moot.** The shipped approach uses
   `renderHtml` (the webview), which sends a normal browser `User-Agent`, so the
   GitHub `User-Agent` requirement does not apply. No loader/Rust header changes
   were needed. (Recorded for context: `fetch_html` does set a Chrome UA via
   `send_validated_get`, `src-tauri/src/lib.rs:319-322`, but it still rejects
   non-HTML content types.)

2. **CSP vs Tauri command path — moot.** Because the extractor renders
   `github.com` like any other site and never calls `api.github.com`, no CSP or
   capability update is required.

## Verification plan

- Upstream: `cd /Users/florian/projects/deep-search-core && npm test && npm run build && npm run typecheck`. ✅ 475 tests pass, build clean, typecheck clean.
- App: `npx tsc --noEmit` + unit suite. ✅ Typecheck clean, 860/860 unit tests pass (focused `extract-page-content-tool.test.ts` 28/28). The extractor is registered in the `extractors` array; behaviour is covered by the upstream unit suite.
- Manual (not yet run): `npm run tauri dev`, run `extract_page_content` on a real repo (e.g. `https://github.com/microsoft/typescript`) and confirm structured Markdown; confirm a 404/private repo degrades gracefully to generic extraction.
- E2E: not required for this phase (no prompt-to-results flow change); per AGENTS.md, E2E would be delegated to a subagent if added later.

## Done criteria

- `GitHubExtractor` implemented + exported upstream, with passing tests.
- Registered in the app; CSP + capabilities updated for `api.github.com`.
- Repo-overview URLs return structured Markdown via the API path.
- Rate-limit / API failure falls back to HTML extraction without throwing.
- Upstream build regenerated; persistence steps communicated (commit/push +
  bump git ref).
