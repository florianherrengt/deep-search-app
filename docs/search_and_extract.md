# How Search and Extraction Work

This document describes, in detail, how Deep Search turns a query into a list of web results, and how it turns a URL into cleaned page text. It covers the five search providers, the four extraction backends, the URL security layer, HTML sanitisation, the custom site extractors, the CAPTCHA retry loops, and all the relevant Tauri commands.

Code-level references:

- `deep-search-core/src/search-extract/` — search engine, providers, sanitisation, extractors
- `src/tools/extract-page-content-tool.ts` — the `extract_page_content` tool and `extractPageContent()` helper
- `src/tools/chrome-mcp-page-loader.ts` — Chrome MCP page loader
- `src/tools/*-search-tool.ts` — per-provider tool wrappers
- `src/lib/mcp/` — Chrome DevTools MCP sidecar
- `src/lib/url-validation.ts` — TS-side URL security
- `src-tauri/src/lib.rs` — Rust HTTP fetch, webview extraction, Node resolution, sidecar PID management

---

## 1. Mental model

Two pipelines feed the research agent:

```
SEARCH                                        EXTRACTION
─────                                         ──────────
query string                                  URL
   │                                            │
   ▼                                            ▼
createSearchExtractEngine.search(             createSearchExtractEngine.extract(
  provider, query, { signal }                   url, { method, summarize, signal }
)                                             )
   │                                            │
   ├─ rate-limit (1 req/s, concurrency 1)      ├─ validateUrl (SSRF guard)
   ├─ provider adapter                         ├─ custom extractor? (Reddit/Amazon/Shopify/Github)
   │    ├─ build HTTP request                  ├─ generic extract:
   │    ├─ execute → raw JSON                     │  method=auto: fetch → render if <200 chars
   │    └─ responseSchema.safeParse               │  method=fetch: HTTP only
   ├─ mapResults → SearchResult[]                │  method=render: webview/chrome/scrape.do only
   └─ formatSearchResults → string               ├─ sanitizeHtml (cheerio DOM walk)
                                                  ├─ optional summarize (LLM)
                                                  └─ persist to research folder
```

Both live in `deep-search-core` and are agnostic of Tauri. The app injects Tauri-specific behaviour (HTTP fetch, webview tabs, Chrome MCP, Scrape.do token) through a single interface: the **`PageLoader`**.

```ts
// deep-search-core/src/search-extract/core/types.ts:75-78
export interface PageLoader {
  fetchHtml?: (url: string, options: PageLoadOptions) => Promise<string | null>;
  renderHtml?: (url: string, options: PageRenderOptions) => Promise<string | null>;
}
```

`fetchHtml` is the raw HTTP path; `renderHtml` is the JS-rendered path. Every backend the app supports is wired as one or both of these.

---

## 2. The search engine

### 2.1 Factory and interface

`createSearchExtractEngine()` (`deep-search-core/src/search-extract/core/engine.ts:173-251`) returns three methods:

```ts
// core/engine.ts:43-57
export interface SearchExtractEngine {
  search(provider, query, options?: { signal }): Promise<SearchResult[]>;
  searchAll(query, options?: SearchAllOptions): Promise<SearchResult[]>;
  extract(url, options?: ExtractOptions): Promise<ExtractResult>;
}
```

The factory takes a `CreateEngineConfig` (`engine.ts:29-41`) with optional `fetch`, `searchProviders`, `pageLoader`, `summarizer`, and `extractors`. The app passes only what it needs.

### 2.2 `search(provider, query, options)`

```ts
// core/engine.ts:178-184
async search(provider, query, options) {
  const searchFn = getSearchFn(config, provider);
  return rateLimit(() => searchFn(query, options?.signal), options?.signal);
}
```

Two steps: dispatch to the provider's `SearchFn`, and rate-limit the call.

`getSearchFn()` (`engine.ts:59-106`) is a `switch` over the provider name. For `brave|exa|serper|tavily|searxng` it looks up the provider config, throws `SearchProviderConfigError` if absent, and otherwise calls the provider factory (e.g. `createBraveSearch({...config, fetch}))`). For `"aggregate"` it returns `createAggregateSearchFn(config)`.

### 2.3 Rate limiting

`core/rate-limit.ts:1-49`:

```ts
function createRateLimiter(requestsPerSecond = 1, concurrency = 1): RateLimiter {
  const queue = new PQueue({ concurrency, intervalCap: requestsPerSecond, interval: 1000 });
  return { schedule: (fn, signal) => queue.add(fn, { signal }) };
}
```

A global `PQueue` singleton caps every search call at **1 request/second, concurrency 1**. This applies to every provider including the aggregate fan-out (each underlying provider call is independently rate-limited).

### 2.4 `searchAll(query, options)` — multi-provider fan-out

`engine.ts:186-218`:

1. If `options.providers` is set, use that list; otherwise default to `AGGREGATABLE_PROVIDER_NAMES` = `[brave, exa, serper, tavily, searxng]` (the synthetic `"aggregate"` name is excluded to avoid double-counting).
2. For each requested provider, try `getSearchFn()`; silently skip unconfigured ones (the `catch` is empty).
3. If zero providers ended up enabled, return `[]`.
4. Fan out with `Promise.allSettled`, each call rate-limited.
5. Merge fulfilled results; collect rejected errors.
6. If everything failed and `options.partial` is not set, throw `AggregateSearchError`. Otherwise return the flat merged array.

Note: `searchAll` does **not** deduplicate across providers — that is the aggregate provider's job (§2.6).

### 2.5 The provider factory

`search/create-search-provider.ts:30-51`:

```ts
export function createSearchProvider<TResponse>(options: CreateSearchProviderOptions<TResponse>) {
  return async (query: string, signal?: AbortSignal): Promise<SearchResult[]> => {
    const raw = await options.execute(query, signal);
    const parsed = tryParseJson(raw);
    const result = options.responseSchema.safeParse(parsed);
    if (!result.success) {
      if (options.throwOnParseError) {
        throw new SearchProviderResponseError(options.providerName, result.error.message);
      }
      return [];
    }
    return options.mapResults(result.data);
  };
}
```

Every provider is built from four pieces:

| Piece | Purpose |
|-------|---------|
| `execute(query, signal) → string` | Build the HTTP request, send it, return raw response body. Throws `SearchProviderError` on `!response.ok`. |
| `responseSchema: z.ZodType<TResponse>` | Zod schema for the response envelope. |
| `mapResults: (response) → SearchResult[]` | Transform validated response to `SearchResult[]`. |
| `throwOnParseError?: boolean` | Default `false`. If `true`, schema mismatch throws `SearchProviderResponseError`. |

All five providers set `throwOnParseError: true`.

### 2.6 The `"aggregate"` provider — cross-engine deduplication

`search/aggregate.ts` (154 lines):

- `normalizeUrl()` strips tracking params (`utm_*`, `fbclid`, `gclid`, `gclsrc`, `dclid`, `msclkid`, `mc_eid`), lowercases hostname, drops fragment, normalises trailing slash.
- `mergeResults()` first deduplicates per-engine (by normalised URL), then across engines. Each result tracks:
  - `frequency` — how many engines returned it
  - `bestPosition` — best rank across engines
- Sort order: higher frequency first, then lower `bestPosition`. For duplicates, the longest title and longest description across engines are kept.
- Final list sliced to `numResults`, default `DEFAULT_AGGREGATE_NUM_RESULTS = 20`.

`createAggregateSearchFn()` (`engine.ts:117-162`) builds the list of `SearchFn`s by iterating `AGGREGATABLE_PROVIDER_NAMES`, silently skipping unconfigured ones, fires them all with `Promise.allSettled` (each rate-limited), and if everything failed and no results came back, throws `AggregateSearchError`.

### 2.7 The five providers

All live in `deep-search-core/src/search-extract/search/`. Each is short (70–80 lines).

| Provider | File | Method | Endpoint | Auth | Request body | Response field | `mapResults` | `numResults` |
|----------|------|--------|----------|------|--------------|----------------|--------------|--------------|
| Brave | `brave.ts` | GET | `https://api.search.brave.com/res/v1/web/search?q=` | `x-subscription-token` header | — | `web.results[]` (already `SearchResult` shape) | identity | server default |
| Exa | `exa.ts` | POST | `https://api.exa.ai/search` | `x-api-key` header | `{ query, type: "auto", numResults: 5, contents: { text: true } }` | `results[]` with `{title, url, text}` | `text` → `description` | **5** |
| Serper | `serper.ts` | POST | `https://google.serper.dev/search` | `X-API-KEY` header (mixed case) | `{ q: query }` | `organic[]` with `{title, link, snippet?}` | `link` → `url`, `snippet` → `description` | server default |
| Tavily | `tavily.ts` | POST | `https://api.tavily.com/search` | `Authorization: Bearer <key>` | `{ query, search_depth: "basic", max_results: 5 }` | `results[]` with `{title, url, content}` | `content` → `description` | **5** |
| SearXNG | `searxng.ts` | GET | `<baseUrl>/search?format=json&q=` | none | — | `results[]` with `{title, url, content}` | `content` → `description` | server default |

**Provider quirks:**

- **Exa** uniquely requests `contents: { text: true }`, so its `description` is the actual page text returned by Exa rather than a snippet — useful but heavier.
- **Serper** uses field name `link` (not `url`) and `q` (not `query`).
- **Tavily** always uses `search_depth: "basic"` (the cheaper tier) and caps `max_results` at 5.
- **SearXNG** has no auth; it relies on a user-configured `baseUrl` (default `http://localhost:8080`) and is validated lazily at call time. Note this is the only provider that can be `http://` because it is self-hosted.
- **Brave** is the only provider whose response already matches the `searchResultSchema` exactly — no mapping needed.

Example — the Tavily adapter (`search/tavily.ts:29-76`):

```ts
return createSearchProvider({
  providerName: "Tavily",
  responseSchema: TavilyWebResponseSchema,
  throwOnParseError: true,
  mapResults: (r) => r.results.map((r) => ({
    title: r.title, url: r.url, description: r.content,
  })),
  execute: async (query, abortSignal) => {
    if (!apiKey) throw new SearchProviderConfigError("Tavily", "requires a valid apiKey");
    const response = await fetchImpl(`${API_BASE_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, search_depth: "basic", max_results: 5 }),
      signal: abortSignal,
    });
    if (!response.ok) { /* throw SearchProviderError */ }
    return await response.text();
  },
});
```

### 2.8 Error taxonomy

`core/errors.ts:1-52` defines five error classes:

| Class | Thrown when | Fields |
|-------|-------------|--------|
| `SearchProviderConfigError` | Provider config missing (no API key / baseUrl) | `provider` |
| `SearchProviderError` | HTTP request returned non-2xx | `provider`, `status`, body |
| `SearchProviderResponseError` | `responseSchema.safeParse` failed and `throwOnParseError` is true | `provider`, detail |
| `AggregateSearchError` | All providers in a fan-out failed | `errors: Error[]` |
| `UrlValidationError` | URL failed `validateUrl()` | message |

`AggregateSearchError` is thrown in two places:
- `engine.ts:152-157` — the aggregate provider, when every underlying provider rejected and no results came back.
- `engine.ts:233-238` — `searchAll`, when all providers failed, the merged array is empty, and `options.partial` is not set.

### 2.9 Result types

`core/types.ts:13-20`:

```ts
export const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string(),
  snippet: z.string().optional(),
});
```

And the `ExtractResult` returned by extraction (`core/types.ts:65-74`):

```ts
export interface ExtractResult {
  url: string;
  content: string;              // sanitised visible text
  summary?: string;             // LLM-generated summary (if requested)
  html?: string | null;         // raw HTML before sanitisation
  usedCustomExtractor: boolean; // true if a site-specific extractor fired
  extractorName?: string;       // e.g. "RedditExtractor"
  method: "fetch" | "render" | "custom";
  warnings?: string[];
}
```

### 2.10 Output to the model

`search/format.ts:1-8`:

```ts
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results.map((r) => `${r.title}: ${r.url}\n${r.description}`).join("\n-\n");
}
```

Plain text. No JSON. No metadata. The model sees title, URL, and description per result, separated by `-` lines.

### 2.11 The AI SDK adapter

`adapters/ai-sdk.ts:27-43`:

```ts
export function createAiSdkSearchTool(engine, provider, description): Tool<{ query: string }, string> {
  return tool({
    description,
    strict: true,
    inputSchema: zodSchema(searchQueryInputSchema),
    execute: async ({ query }, ctx) => {
      const results = await engine.search(provider, query, { signal: ctx?.abortSignal });
      return formatSearchResults(results);
    },
  });
}
```

The schema exposed to the model is just `{ query: z.string().min(1) }` — no recency, count, or domain filters.

### 2.12 App-side tool wrappers

Each provider has a ~18-line wrapper in `src/tools/` that creates an engine configured with only that provider and the Tauri-aware `fetch`:

```ts
// src/tools/brave-search-tool.ts (representative)
export function createBraveSearchTool(apiKey: string) {
  const engine = createSearchExtractEngine({
    fetch,                                            // @/lib/tauri-bridge
    searchProviders: { brave: { apiKey } },
  });
  return createAiSdkSearchTool(engine, "brave", "Search the web with Brave Search");
}
```

The `fetch` from `@/lib/tauri-bridge` (`tauri-bridge.ts:17-32`) bridges to `@tauri-apps/plugin-http` in Tauri (so the fetch respects the configured CSP and capabilities) and falls back to `globalThis.fetch` outside Tauri.

### 2.13 Conditional registration

Only providers with non-empty keys are registered. The chain:

1. `App.tsx` reads settings and maps empty strings to `null`.
2. `createTools(searchKeys)` in `src/lib/transport/tool-registry.ts:70-80` builds `pkgSearchKeys` filtering out nulls and calls `createSearchTools(pkgSearchKeys, bridgeFetch)`.
3. `createSearchTools` in core iterates the keys and **only creates** a search tool when its key is non-empty. An unconfigured provider is invisible to the model — not merely disabled.

---

## 3. URL validation (SSRF defense)

Two layers, intentionally redundant: a TypeScript layer that runs in the tool, and a Rust layer that runs in `fetch_html` / `open_tab`.

### 3.1 TypeScript layer

`src/lib/url-validation.ts` and `deep-search-core/.../extract/page-loader.ts:43-86`:

```ts
export function validateUrl(raw: string): URL {
  // 1. Block dangerous schemes
  // 2. Parse with `new URL(...)`
  // 3. Require protocol === "https:"
  // 4. Reject exact PRIVATE_HOSTNAMES: localhost, 127.0.0.1, 0.0.0.0, [::1], ::1
  // 5. Reject hostnames ending in .local or .localhost
  // 6. Reject any hostname that ipaddr.js classifies as non-unicast
}
```

Blocked schemes (`page-loader.ts:5-13`): `file:`, `data:`, `javascript:`, `vbscript:`, `tauri:`, `about:`, `blob:`.

Private hostnames (`page-loader.ts:15-21`): `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`, `::1`.

IP-range check (`page-loader.ts:23-41`): uses `ipaddr.js`. IPv4-mapped IPv6 addresses (e.g. `::ffff:127.0.0.1`) are unwrapped to IPv4 first. Anything whose `addr.range()` is not `"unicast"` is blocked — this catches RFC 1918, loopback, link-local, multicast, CGNAT, documentation, reserved, etc. in one call.

### 3.2 Rust layer (defence in depth)

`src-tauri/src/lib.rs`:

- `validate_external_url()` (`:135-145`) — parses, then `validate_url_components()`, then `resolve_public_socket_addrs()`.
- `validate_url_components()` (`:147-174`) — scheme must be `https`; reject `localhost`, `*.localhost`, `*.local`; reject IP literals in the CIDR block lists.
- `resolve_public_socket_addrs()` (`:176-204`) — resolves the hostname via the OS resolver (`std::net::ToSocketAddrs` on `spawn_blocking`), then **every** resolved IP is checked against the block lists. If any resolved IP is private, the whole request is rejected.

#### 3.2.1 Blocked IPv4 CIDRs (`lib.rs:210-226`)

```
0.0.0.0/8          # current network
10.0.0.0/8         # RFC 1918 private
100.64.0.0/10      # CGNAT
127.0.0.0/8        # loopback
169.254.0.0/16     # link-local
172.16.0.0/12      # RFC 1918 private
192.0.0.0/24       # IETF protocol assignments
192.0.2.0/24       # documentation (TEST-NET-1)
192.168.0.0/16     # RFC 1918 private
198.18.0.0/15      # benchmark testing
198.51.100.0/24    # documentation (TEST-NET-2)
203.0.113.0/24     # documentation (TEST-NET-3)
224.0.0.0/4        # multicast
240.0.0.0/4        # reserved
255.255.255.255/32 # broadcast
```

#### 3.2.2 Blocked IPv6 CIDRs (`lib.rs:228-235`)

```
::/128        # unspecified
::1/128       # loopback
::ffff:0:0/96 # IPv4-mapped (unwrapped and re-checked against IPv4 list)
fc00::/7      # unique local addresses
fe80::/10     # link-local
ff00::/8      # multicast
```

`is_blocked_ip()` (`lib.rs:249-256`) unwraps IPv4-mapped IPv6 addresses before checking, so `::ffff:127.0.0.1` is caught. The parsed `IpNet` list is lazily cached via `OnceLock` (`:237-247`).

### 3.3 DNS rebinding / TOCTOU defence

The Rust HTTP client does **not** let `reqwest` resolve the hostname itself. The flow in `send_validated_get()` (`lib.rs:300-326`):

1. Resolve the hostname to socket addresses via `resolve_public_socket_addrs()` (re-checked against CIDRs).
2. Build a fresh `reqwest::Client` with `.resolve_to_addrs(&host, &addrs)` — this **pins** the hostname to the verified IPs.
3. Send the request. The connection goes only to the verified IP.

So even if DNS is rebound between validation and connection, the connection still goes to the original verified address. And each redirect target is re-validated and re-resolved by `validated_redirect_url()` (`lib.rs:328-337`).

---

## 4. The extraction pipeline

### 4.1 Entry point in core

`deep-search-core/.../extract/extract-page.ts:21-74`:

```ts
export async function extractPage(url, options, deps): Promise<ExtractResult> {
  const method = options?.method ?? "auto";
  const signal = options?.signal;
  const warnings: string[] = [];

  const parsedUrl = validateUrl(url);
  if (signal?.aborted) throw createAbortError();

  // (1) Custom extractors first — first canHandle match wins
  const extractors = deps.extractors ?? [];
  for (const extractor of extractors) {
    if (!extractor.canHandle(parsedUrl)) continue;
    try {
      const result = await extractor.extract({ url: parsedUrl, loader: deps.pageLoader ?? {}, signal });
      if (result != null && result.content !== "") {
        return applySummarization({
          url, content: result.content, html: result.html ?? null,
          usedCustomExtractor: true, extractorName: extractor.constructor.name,
          method: "custom", warnings: [...warnings, ...(result.warnings ?? [])],
        }, options, deps.summarizer);
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      warnings.push(`Custom extractor ${extractor.constructor.name} failed for ${url}: ${...}`);
    }
    break;  // first-match-wins: stop after the first canHandle match
  }

  // (2) Generic extraction
  return genericExtract(url, method, signal, deps, warnings, options);
}
```

Two-phase: try a site-specific extractor first; if none handles the URL (or the one that does returns null), fall through to generic extraction.

**Dispatch rule for custom extractors**: the iterable is traversed in order; the first extractor whose `canHandle` returns `true` is the only one tried, even if it returns null/empty (`break` at line 69). Order is determined by whoever pushes them into the `extractors` array. The app registers them in this order (`extract-page-content-tool.ts:112`):

```ts
extractors: [new RedditExtractor(), new AmazonExtractor(), new ShopifyExtractor(), new GithubExtractor()]
```

### 4.2 Generic extraction — the fallback chain

`extract-page.ts:76-157`:

```ts
async function genericExtract(url, method, signal, deps, warnings, options) {
  if (method === "render") {
    // RENDER-ONLY: skip fetch, go straight to pageLoader.renderHtml
    if (!deps.pageLoader?.renderHtml) {
      warnings.push("Renderer not available");
      return { url, content: "", usedCustomExtractor: false, method: "render", warnings };
    }
    const html = await deps.pageLoader.renderHtml(url, { signal });
    return applySummarization({ url, content: html ? sanitizeHtml(html) : "", html, ... }, options, deps.summarizer);
  }

  // FETCH or AUTO: fetch first
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const html = deps.pageLoader?.fetchHtml
    ? await deps.pageLoader.fetchHtml(url, { signal })
    : await loadPageHtml(url, fetchImpl, { signal });
  const content = html ? sanitizeHtml(html) : "";

  // AUTO: fall back to render if content is too short
  if (method === "auto" && content.length < MIN_CONTENT_LENGTH) {  // 200
    if (deps.pageLoader?.renderHtml) {
      const renderHtmlResult = await deps.pageLoader.renderHtml(url, { signal });
      const renderContent = renderHtmlResult ? sanitizeHtml(renderHtmlResult) : "";

      // Use the render result if it's at least as long, or if fetch produced nothing
      if (renderContent.length >= content.length || content.length === 0) {
        return applySummarization({ url, content: renderContent || content, html: renderHtmlResult ?? html, method: "render", ... }, ...);
      }
    } else {
      warnings.push("Content is short and renderer is not available");
    }
  }

  return applySummarization({ url, content, html, method: "fetch", ... }, ...);
}
```

**The fallback rule**: when `method === "auto"`, fetch first; if the sanitised content is **under 200 characters**, try `renderHtml`; use the render result if it is at least as long as the fetched result (or if fetch produced nothing). Otherwise keep the fetched content.

`MIN_CONTENT_LENGTH = 200` is the single threshold that decides whether a page is "probably JS-rendered" and needs a real browser.

### 4.3 Method resolution at the app layer

The app's `extract_page_content` tool exposes five methods to the model:

```ts
// src/tools/extract-page-content-tool.ts:537-557
method?: z.enum(["auto", "fetch", "webview", "chrome", "scrape.do"])
```

These are mapped down to the engine's three values by `mapAppMethod()` (`:455-458`):

```ts
function mapAppMethod(method: ExtractionMethod): "auto" | "fetch" | "render" {
  if (method === "webview" || method === "chrome" || method === "scrape.do") return "render";
  return method;  // "auto" or "fetch"
}
```

So from the engine's perspective there are only three methods. The difference between `webview`, `chrome`, and `scrape.do` is in **which `PageLoader` is wired** — decided once at engine construction time.

### 4.4 Engine construction and caching

`getEngine()` in `extract-page-content-tool.ts:69-118`:

```ts
const forceChrome = method === "chrome";
const shouldUseChromeMcp =
  (chromeMcp?.backend === "chrome-mcp" && chromeMcp.enabled) || forceChrome;
const useScrapeDo = (method === "auto" || method === "scrape.do") && scrapeDoToken.length > 0;

const basePageLoader = shouldUseChromeMcp
  ? createChromeMcpPageLoader({ /* connection settings */ })
  : createAppPageLoader({ fetchHtml, extractViaWebview });

const pageLoader = useScrapeDo
  ? withScrapeDoFallback(core, basePageLoader, scrapeDoToken)
  : basePageLoader;

_engine = core.createSearchExtractEngine({
  pageLoader,
  extractors: [new core.RedditExtractor(), new core.AmmonExtractor(), new core.ShopifyExtractor(), new core.GithubExtractor()],
});
```

The engine is cached by a composite key (`:93-99`):

```
chrome-mcp:<connectionMode>:<nodePath>:scrape-do:<hash(token)>   (chrome MCP)
tauri-webview:scrape-do:<hash(token)>                            (default)
```

When the user switches backend or changes the Scrape.do key, the cache key changes and a new engine replaces the old one. The old engine is not explicitly disposed — it becomes unreferenced and GC-eligible.

### 4.5 The four `PageLoader` implementations

| Backend | `fetchHtml` | `renderHtml` | File |
|---------|------------|--------------|------|
| Tauri webview (default) | Rust `fetch_html` command | Tauri `open_tab` + `extract_content` + `close_tab` | `extraction-page-loader.ts` bridges to `extract-page-content-tool.ts:254-268, 332-388` |
| Chrome DevTools MCP | `undefined` | MCP `navigate_page` + `evaluate_script("document.documentElement.outerHTML")` | `src/tools/chrome-mcp-page-loader.ts` |
| Scrape.do (layered) | layered on base `fetchHtml` | layered on base `renderHtml` (tries Scrape.do first, falls back) | `withScrapeDoFallback()` |

The default `createAppPageLoader()` wires both `fetchHtml` (Rust HTTP) and `renderHtml` (webview). The Chrome MCP loader provides **only `renderHtml`** — it always opens Chrome, even for simple HTTP fetches. Scrape.do is layered on top of either base loader.

### 4.6 App-level summarisation

The app passes `summarize: false` to the engine (`extract-page-content-tool.ts:478-482`), bypassing the engine's own `applySummarization`. It runs its own summarisation so it can stream the output to the sub-agent UI:

```ts
// extract-page-content-tool.ts:270-291
async function summarizeContent(model, markdown, query, abortSignal, subAgentId) {
  const result = streamText({
    model,
    system: "You are a research assistant. Extract and summarize the key information from this page content. Be concise but thorough. Preserve factual details, names, dates, and numbers.",
    prompt: `${markdown}${query ? `\n\nFocus on information related to: ${query}` : ""}`,
    abortSignal,
  });
  if (subAgentId) {
    for await (const textPart of result.textStream) {
      emitSubAgentEvent({ type: "text-delta", id: subAgentId, delta: textPart });
    }
  }
  return result.text;
}
```

Whether to summarise is decided by `shouldSummarizeContent()` (`:390-399`):

```ts
function shouldSummarizeContent(options, usedCustomExtractor): boolean {
  if (options.query) return true;
  return options.summarize === true || (!usedCustomExtractor && options.summarize !== false);
}
```

**Defaults**:
- If a `query` is provided → always summarise (query-focused summary).
- If a custom extractor matched → **do not** summarise by default (custom extractors already return structured, focused content).
- Otherwise → summarise unless explicitly disabled with `summarize: false`.

`trySummarizeContent()` (`:438-453`) catches non-abort errors and returns `null`, so a failed summary never breaks extraction.

### 4.7 File persistence

When a research folder is active, every successful extraction saves three files (`extract-page-content-tool.ts:401-436`):

```
search-results/<researchFolder>/raw/<domain>/<page>.html             (raw HTML)
search-results/<researchFolder>/raw/<domain>/<page>-content.html     (sanitised text)
search-results/<researchFolder>/raw/<domain>/<page>-summary.md       (LLM summary, if summarised)
```

`<domain>` is the URL's hostname; `<page>` is a slug derived from the pathname (max 120 chars).

Save failures are non-fatal: the error is logged and the returned content is suffixed with `"[Warning: Failed to save this content to the research folder. It will not be available for future searches.]"` — but the content is still returned to the model.

---

## 5. HTML sanitisation

`deep-search-core/.../extract/sanitize-html.ts` (296 lines). Custom cheerio-based implementation, not turndown or rehype.

### 5.1 Phase 1 — DOM pruning

Structural tags removed entirely (`:6-31`):

```
audio, base, canvas, embed, footer, head, header, iframe, link, map,
meta, nav, noscript, object, picture, script, source, style, svg,
template, title, track, video, aside
```

Hidden elements removed (`:137-177`): any element where any of these is true:
- `hidden` attribute present
- `aria-hidden="true"`
- `type="hidden"`
- inline `style` contains `display:none`, `visibility:hidden`, `visibility:collapse`, `opacity:0`, `width:0`, or `height:0`
- `role` is one of `alertdialog`, `banner`, `complementary`, `contentinfo`, `dialog`, `navigation`
- the concatenation of `id`, `class`, `role`, `aria-label`, `data-testid`, `data-test`, `name` matches the **noise attribute pattern** (`:84-85`):

```
/\b(cookie|cookies|consent|gdpr|ccpa|privacy[-_\s]?choices|popup|pop[-_\s]?up|popover|modal|overlay|newsletter|captcha|recaptcha|hcaptcha|interstitial|tracking|tracker|beacon|pixel|ad[-_\s]?(slot|container|banner|unit)|advertisement)\b/i
```

### 5.2 Phase 2 — DOM walk

`extractVisibleTextFromHtml()` (`:275-290`) loads the pruned HTML with cheerio, takes `body` contents (or root if no body), and walks each node via `walkTextNode`:

- **Text nodes**: append with whitespace normalised; insert separator only when needed (avoids double spaces, handles punctuation adjacency).
- **`<br>` / `<hr>`**: insert line break.
- **`<tr>`**: collect cell text joined with ` | `, append as a single line. (Tables render as `cell1 | cell2 | cell3`.)
- **Block tags** (defined at `:33-71`: `div`, `p`, `li`, `h1`–`h6`, `blockquote`, `table`, `tr`, `pre`, etc.): insert newline before and after recursing.
- **Inline tags**: recurse without breaks.

### 5.3 Phase 3 — text normalisation and dedup

`normalizeExtractedText()` (`:252-273`):

```ts
function normalizeExtractedText(text: string): string {
  const lines = text
    .replace(/\u00a0/g, " ")        // nbsp → space
    .replace(/[^\S\n]+/g, " ")      // collapse non-newline whitespace
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const occurrences = new Map<string, number>();
  const cappedLines: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase().replace(/\s+/g, " ");
    const count = occurrences.get(key) ?? 0;
    occurrences.set(key, count + 1);
    if (count >= MAX_REPEATED_LINE_OCCURRENCES) continue;  // MAX = 2
    cappedLines.push(line);
  }
  return cappedLines.join("\n").trim();
}
```

- `MAX_REPEATED_LINE_OCCURRENCES = 2` — any line (case-insensitive, whitespace-collapsed) appearing more than twice is dropped. This kills repeated nav/cookie banner residue.
- `MIN_CONTENT_LENGTH = 200` — the threshold checked by `genericExtract` to decide whether to fall back to a renderer in `"auto"` mode.

Output is **plain text with structure preserved via newlines**, not Markdown. Tables become pipe-separated rows, headings become lines, code blocks become indented text.

---

## 6. Custom site extractors

Four `PageExtractor` subclasses in `deep-search-core/.../extract/extractors/`. Abstract base (`base.ts:15-18`):

```ts
export abstract class PageExtractor {
  abstract canHandle(url: URL): boolean;
  abstract extract(input: ExtractorInput): Promise<ExtractorResult | null>;
}
```

All four **require `loader.renderHtml`** (they need a real browser). Each returns `ExtractorResult` with a formatted plain-text `content` string.

### 6.1 RedditExtractor (`reddit.ts`)

- **`canHandle`**: hostname is `reddit.com` or `*.reddit.com`; rejects `.json` URLs.
- **Strategy**: redirects to `old.reddit.com` (old Reddit is more parser-friendly), renders the page.
- **Parses**: post title, author, score, selftext; threaded comments with nested replies.
- **Output**: a tree view using `├──` / `└──` box-drawing characters showing nested comments with author + points + body.
- **Challenge detection**: `isRedditChallengeHtml()` matches `#challenge-form`, recaptcha/hcaptcha iframes, and text markers like `"captcha challenge"`, `"verify you are human"`, `"checking if the site connection is secure"`. Used by the app's retry loop (§7).

### 6.2 AmazonExtractor (`amazon.ts`)

- **`canHandle`**: hostname matches one of 23 Amazon TLDs (`.com`, `.co.uk`, `.de`, `.fr`, `.it`, `.es`, `.ca`, `.com.au`, `.com.br`, `.com.mx`, `.in`, `.nl`, `.sg`, `.ae`, `.sa`, `.pl`, `.se`, `.tr`, `.cn`, `.jp`, `.be`, `.at`, `.fr`) **and** path matches `/dp/<10-char-ASIN>`.
- **Parses**: title, brand, price, rating, review count, breadcrumbs, inline spec table, feature bullets ("About This Item"), up to 10 customer reviews (rating, title, author, date, body, helpful count).
- **Detects unavailability** via `isUnavailable()`.
- **Challenge detection**: `isAmazonChallengePage()` checks for captcha markers and the absence of `#productTitle`.

### 6.3 ShopifyExtractor (`shopify.ts`)

- **`canHandle`**: hostname is `myshopify.com` or `*.myshopify.com` and path matches `/products/<slug>`.
- **Strategy**: fetches **two API endpoints in parallel** — `products/<slug>.js` (Shopify product JS object) and `products/<slug>.json` (Storefront API JSON). Prefers the `.js` response (faster); falls back to `.json` if `.js` is empty.
- **Parses**: title, vendor, type, price (with currency symbols via a built-in map), compare-at price, description (HTML-stripped), options (color/size/etc), tags (excluding `category-*` and `pri-*` prefixed tags).

### 6.4 GithubExtractor (`github.ts`)

- **`canHandle`**: hostname is `github.com`, path has exactly 2 segments (`owner/repo`), first segment is not a reserved page (`settings`, `orgs`, `topics`, `search`, `explore`, etc.), repo name is valid.
- **Parses**: full name, description (meta), star/fork/watcher counts, topics, homepage (non-github), license, languages with percentages, contributors (count + up to 8 top names), commit count + last commit date, archived/fork/disabled flags.
- **README**: a full HTML-to-Markdown renderer (`blockMarkdown` / `inlineMarkdown`) handles headings, paragraphs, code blocks, blockquotes, lists, tables, links, images, emphasis. READMEs are returned as Markdown, not plain text.
- **Not-found detection**: `isGithubNotFoundHtml()` checks title and body text.

---

## 7. The Tauri extraction backends

The default `PageLoader` (`createAppPageLoader`) wires two Tauri commands.

### 7.1 `fetch_html` — the raw HTTP backend

Tauri command at `src-tauri/src/lib.rs:125-133`:

```rust
#[tauri::command]
async fn fetch_html(url: String) -> Result<Option<String>, String> {
    fetch_validated_text(&url, "text/html,application/xhtml+xml", MAX_HTML_BYTES).await
}
```

`fetch_validated_text()` (`lib.rs:258-298`):

1. `validate_external_url()` — parse, validate scheme/host, DNS-resolve and IP-check.
2. Loop up to `MAX_FETCH_REDIRECTS + 1` iterations (6 total requests: 1 original + 5 redirects).
3. Each iteration: `send_validated_get()` builds a fresh `reqwest::Client` pinned to the verified IPs, sends GET with `Accept: text/html,application/xhtml+xml` and a Chrome 120 macOS user-agent.
4. On 3xx: extract `Location`, validate it through `validated_redirect_url()` (re-validates scheme/host + re-DNS), continue.
5. On non-2xx: return `Ok(None)`.
6. On 2xx: check Content-Type (only `text/html` or `application/xhtml+xml` allowed, `lib.rs:339-348`), then stream body up to `MAX_HTML_BYTES` = 5 MB.

`send_validated_get()` (`lib.rs:300-326`):

```rust
let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))                  // 10s
    .redirect(reqwest::redirect::Policy::none())                       // manual redirect handling
    .resolve_to_addrs(&host, &addrs)                                   // pin verified IPs
    .build()?;
```

- No connection pool — a fresh client per request.
- No explicit TLS config — uses `reqwest` defaults.
- `FETCH_TIMEOUT_SECS = 10`, `MAX_FETCH_REDIRECTS = 5`, `MAX_HTML_BYTES = 5 * 1024 * 1024` (`lib.rs:13-17`).
- Body size is checked twice: `Content-Length` header first, then streaming chunk-by-chunk (`read_limited_response`, `:350-374`).
- Final body is decoded as UTF-8.

### 7.2 `extract_content` — the webview backend

`lib.rs:68-123`. The flow:

1. **Caller opens a tab first** via `open_tab` (separate command) — creates a child `Webview` with `on_navigation` guard that blocks non-https/private navigations.
2. **Poll loop** (`:74-106`): every 500 ms, evaluate a JS expression via `eval_with_callback` that returns `"readyState|old-reddit-flag|challenge-flag"`:
   - `readyState` is `loading` / `interactive` / `complete`.
   - `old-reddit-post` flag is set when hostname is `old.reddit.com` and a `.thing.link p.title > a.title` element exists (old Reddit never reaches `complete` due to infinite scroll, so this is a special-case exit).
   - `challenge` flag is set when CAPTCHA/bot-detection markers are present: `#challenge-form`, `.g-recaptcha`, `.h-captcha`, `[class*='cf-challenge']`, captcha iframes, or body text matching `"captcha challenge"`, `"verify you are human"`, `"checking if the site connection is secure"`, `"checking your browser"`, `"are you a robot"`, `"security check"`.
   - Exit when any of: `complete`, `old-reddit-post`, or `challenge`. Total timeout: `PAGE_LOAD_TIMEOUT_SECS = 30`.
3. **Post-load delay** (`:110`): hard 2-second `tokio::time::sleep` to let lazy-loaded content finish rendering.
4. **HTML snapshot** (`:112-122`): evaluate `document.documentElement.outerHTML` via `eval_with_callback`. The result comes back as a JSON-encoded string (Tauri serialises eval return values), so it's unwrapped with `serde_json::from_str::<String>`, falling back to the raw string if that fails.

The `EVAL_RECV_TIMEOUT_SECS = 5` (`lib.rs:14`) caps each individual eval callback wait.

### 7.3 Tab lifecycle

- `open_tab(url, id)` (`lib.rs:23-43`) — validates URL via `validate_external_url()` (full DNS + IP check), creates a child `Webview` at position `(0, TAB_BAR_HEIGHT=40)` sized to fill the window below the tab bar, with an `on_navigation` guard.
- `switch_tab(id)` (`lib.rs:45-58`) — iterates all webviews, hides all non-main ones except `id`, shows `id`.
- `close_tab(id)` (`lib.rs:60-66`) — closes the webview. No-op if not found.

Multiple tabs can coexist, but extraction reads from one webview at a time by `id`. The frontend serialises extraction itself (see §9).

### 7.4 CAPTCHA retry loops

`extract-page-content-tool.ts:308-327`:

```ts
function getRetryOptions(core: CoreModule, url: string) {
  const isReddit = /\.?reddit\.com\//.test(url);
  const isAmazon = /\.?amazon\./.test(url) && /\/dp\//i.test(url);

  if (isReddit)  return { shouldRetry: core.isRedditChallengeHtml, maxWaitMs: 5 * 60_000, retryIntervalMs: 5_000 };
  if (isAmazon)  return { shouldRetry: core.isAmazonChallengePage, maxWaitMs: 3 * 60_000, retryIntervalMs: 3_000 };
  return undefined;
}
```

Used by `extractViaWebview`'s loop (`:360-374`):

```ts
while (true) {
  throwIfAborted(abortSignal);
  const rawHtml = await extractWebviewContent(id, abortSignal);
  const html = normalizeWebviewHtml(rawHtml);
  const shouldRetry = retryOptions?.shouldRetry?.(html) ?? false;
  if (!shouldRetry) return html;
  if (Date.now() - startedAt >= retryOptions?.maxWaitMs ?? DEFAULT_WEBVIEW_MAX_WAIT_MS) return html;
  await abortableDelay(retryOptions?.retryIntervalMs ?? DEFAULT_WEBVIEW_RETRY_INTERVAL_MS, abortSignal);
}
```

- **Reddit**: re-extract every 5 s, give up after 5 min.
- **Amazon**: re-extract every 3 s, give up after 3 min.

These work because both sites eventually serve the real page after repeated visits from a real browser. The retry loop only triggers when the extracted HTML matches a challenge signature; otherwise it returns immediately.

### 7.5 Error → null swallowing

`extractViaWebview` (`:376-383`) catches non-abort errors and returns `null`, so a failed webview extraction degrades gracefully to whatever the caller would do with no content (which, in `"auto"` mode, is nothing — but the caller already has the fetched content from the first phase).

---

## 8. The Chrome DevTools MCP backend

Used when the user enables it in settings or when `method: "chrome"` is requested. Spawns the `chrome-devtools-mcp` Node sidecar in-process.

### 8.1 The page loader

`src/tools/chrome-mcp-page-loader.ts` (63 lines):

```ts
export function createChromeMcpPageLoader({ ... }): PageLoader {
  return {
    fetchHtml: undefined,            // chrome MCP only renders
    renderHtml: async (url, _options) => {
      if (!isTauri()) return null;
      const client = await getChromeDevToolsMcpClient({ ... });

      await client.callTool(
        { name: "navigate_page", arguments: { type: "url", url, timeout: NAVIGATE_TIMEOUT_MS } },
        undefined,
        { timeout: MCP_CALL_TIMEOUT_MS },
      );

      const evalResult = await client.callTool(
        { name: "evaluate_script", arguments: { function: "() => document.documentElement.outerHTML" } },
        undefined,
        { timeout: MCP_CALL_TIMEOUT_MS },
      );

      return extractTextFromToolResult(evalResult);
    },
  };
}
```

Two MCP tool calls in sequence: `navigate_page` (with a 30 s navigation timeout), then `evaluate_script` returning the full outer HTML. Both have a 30 s MCP call timeout. If `result.isError` is true, returns `null`.

### 8.2 The sidecar process

`src/lib/mcp/chrome-devtools-sidecar.ts:118-127`:

```ts
export async function createChromeDevToolsMcpCommand(options = {}) {
  const { envPath } = await getNodeEnvironment(options.nodePath);
  const connectionArgs = resolveChromeDevToolsConnectionArgs(options);
  const entrypoint = await resolveResource(CHROME_DEVTOOLS_MCP_RESOURCE);
  return createSystemCommand(SYSTEM_NODE_ALIAS, [entrypoint, ...connectionArgs], { PATH: envPath });
}
```

- `SYSTEM_NODE_ALIAS = "system-node"` — declared in Tauri's shell scope, scoped to args matching `^.*chrome-devtools-mcp[\\/]build[\\/]src[\\/]bin[\\/]chrome-devtools-mcp\\.js$` and `^(--auto-connect|--browser-url=https?://.+)$`.
- `CHROME_DEVTOOLS_MCP_RESOURCE = "mcp/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js"` — bundled via Tauri's `resources` config.
- `envPath` is the resolved Node's `dir` prepended to the system `PATH` — ensures the sidecar uses the same Node the app resolved.

Connection modes (`resolveChromeDevToolsConnectionArgs`, `:100-116`):
- `"auto"` (default) → `["--auto-connect"]` — discovers Chrome via DevToolsActivePort file (Chrome 144+).
- `"browser-url"` → `["--browser-url=<validated-url>"]` — connects via CDP to a Chrome already started with `--remote-debugging-port=9222`.

### 8.3 Node resolution

`src-tauri/src/lib.rs:527-584`:

1. **User override** (from settings) — validate strictly, error if unusable.
2. **Login shell probe** (`detect_node_via_login_shell`, `:468-503`):
   - macOS: `/bin/zsh -lic "command -v node"`
   - Linux/other: `/bin/bash -lc "command -v node"`
   - If `$SHELL` is set, also try `$SHELL -lic`/`-lc`
3. **Well-known fallbacks** (`common_node_candidates()`): `/opt/homebrew/bin/node`, `/usr/local/bin/node`, `/usr/bin/node`.

Version requirement (`REQUIRED_NODE_RANGE`, `lib.rs:393`): `^20.19.0 || ^22.12.0 || >=23`. The `-lic` flag for zsh sources `.zshrc`, making nvm/fnm/asdf/volta shims available.

The whole resolution runs on `spawn_blocking` with an 8-second timeout (`NODE_RESOLVE_TIMEOUT_SECS`, `lib.rs:394`).

### 8.4 The stdio transport

`src/lib/mcp/tauri-stdio-transport.ts` (148 lines). Implements the MCP SDK `Transport` interface:

- **`start()`** (`:34-65`): spawns the command via `command.spawn()`, registers the PID via `register_sidecar_pid`, hooks `stdout.on("data")`, `stderr.on("data")`, `command.on("error")`, `command.on("close")`.
- **`handleStdout()`** (`:101-123`): buffers stdout, splits on `\n`, parses each non-blank line as `JSONRPCMessage`, dispatches to `onmessage`. Non-JSON lines are logged as warnings and discarded.
- **`send(message)`** (`:67-72`): writes `JSON.stringify(message) + "\n"` to the child's stdin.
- **`close()`** (`:74-85`): guarded by a `closed` flag; calls `unregisterSidecarPid`, `child.kill()`, and emits `onclose` exactly once.
- **Stderr capture** (`:125-128`): tail of last 8,000 chars retained (`MAX_STDERR_CHARS`). On unexpected exit (`:45-58`), dumps the tail to `<appDataDir>/sidecar-logs/sidecar-stderr-<timestamp>.log`.

### 8.5 Tool discovery and wrapping

`src/lib/mcp/chrome-devtools-tools.ts:70-116`:

- `getChromeDevToolsMcpClient()` (`:118-142`) — lazy singleton; resets on failure so a subsequent call retries.
- `client.listTools(undefined, { timeout: 30_000 })` — discovers MCP tools.
- Each MCP tool is wrapped as an AI SDK `tool()`:
  - **Name**: `chrome_devtools_<mcp_name>` (`:9, 144-146`), with non-alphanumeric chars replaced by `_`, deduplicated with `_2`/`_3` suffixes.
  - **Description**: original MCP description + a hard warning that this is a last-resort tool (`:161-164`).
  - **Schema**: the MCP tool's `inputSchema` normalised via `jsonSchema(normalizeInputSchema(...))`.
  - **Execute**: `client.callTool({ name, arguments }, undefined, { timeout: 30_000 })`.
  - **Connection tracking** (`:37-44`): if the connection key (`mode|nodePath`) changes, the old client is shut down.
- `window.addEventListener("beforeunload", shutdownChromeDevToolsMcp)` (`:64-68`).

### 8.6 Sidecar cleanup

`SidecarState` (`lib.rs:19-21`) holds the PID in a `Mutex<Option<u32>>`. On `RunEvent::Exit` (`lib.rs:623-648`), the handler sends `kill -TERM <pid>` (Unix) or `taskkill /PID <pid> /F` (Windows).

---

## 9. Concurrency and serialization

### 9.1 Search

The `PQueue`-based rate limiter enforces **1 request/second, concurrency 1** across all search calls (global singleton). So multiple `brave_search` calls in the same turn are serialised automatically; concurrent provider calls in `searchAll`/aggregate are each rate-limited independently but still go through the same queue.

### 9.2 Webview extraction

The Tauri webview backend has a frontend-side mutex because `extract_content` reads whatever the webview currently displays:

`extract-page-content-tool.ts:66-67, 157-173`:

```ts
let webviewExtractionQueue: Promise<void> = Promise.resolve();

async function runExclusiveWebviewExtraction<T>(task: () => Promise<T>): Promise<T> {
  const previous = webviewExtractionQueue;
  let release!: () => void;
  webviewExtractionQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous.catch(() => undefined);
  try { return await task(); } finally { release(); }
}
```

A simple promise-chain mutex. Each call awaits the previous call's `release()`. Without this, concurrent extractions would race — tab A opens, tab B replaces the webview, both try to read from the same tab.

The Chrome MCP and `fetch_html` backends are **not** serialised — they can run concurrently. Only the webview needs it.

### 9.3 `facts_check` parallelism

`facts-check-tool.ts:67-76`:

```ts
const fetchResults = await Promise.allSettled(
  urls.map(async (url) => {
    const content = await extractPageContent(url, {
      summarize: false,
      abortSignal: options?.abortSignal,
      scrapeDoApiKey,
    });
    return { url, content };
  }),
);
```

All cited URLs are fetched in parallel via `Promise.allSettled`. Failures are isolated — a URL that fails to extract becomes `[Could not fetch: <reason>]` in the source dossier, not a tool error.

`facts_check` calls `extractPageContent` with **`summarize: false`** because the fact-checker needs the full page text to verify specific numbers/dates/prices — a summary could omit the very details being checked.

---

## 10. Configuration and key gating

### 10.1 API keys

Stored in the Tauri plugin-store (JSON file), validated by Zod on write. Schema in `src/lib/settings-store.ts:55-83`. Defaults are empty strings; empty means unconfigured.

Each provider's tool is created **only if** its key is non-empty (`tool-registry.ts:70-80`). An unconfigured provider is invisible to the model.

The chat model itself is user-configurable: `openrouter` (default), `anthropic`, `deepseek`, `zhipu`, `opencode-zen`, `local`. A provider appears in the model selector only if its key is set.

### 10.2 Network permissions

CSP `connect-src` allowlist (`src-tauri/tauri.conf.json:21`):

```
'self'
http://localhost:*  https://localhost:*
http://127.0.0.1:*  https://127.0.0.1:*
http://[::1]:*      https://[::1]:*
https://api.anthropic.com
https://api.deepseek.com
https://api.duckduckgo.com
https://api.exa.ai
https://api.frankfurter.dev
https://api.scrape.do
https://api.search.brave.com
https://api.tavily.com
https://api.z.ai
https://google.serper.dev
https://open.bigmodel.cn
https://openrouter.ai
```

The same list is mirrored in `src-tauri/capabilities/default.json` for the HTTP plugin (`http:default`, `http:allow-fetch-send`, `http:allow-fetch-read-body`). Adding a new external API domain requires updating **both** files.

### 10.3 Shell scope

The Chrome MCP sidecar runs as a **system command**, not a Tauri sidecar binary. Shell permissions in `capabilities/default.json`:

- `shell:allow-execute` for `node --version`
- `shell:allow-spawn` / `shell:allow-stdin-write` / `shell:allow-kill`, each scoped to:
  - arg 0: `^.*chrome-devtools-mcp[\\/]build[\\/]src[\\/]bin[\\/]chrome-devtools-mcp\\.js$`
  - arg 1: `^(--auto-connect|--browser-url=https?://.+)$`

The `chrome-devtools-mcp` package itself is bundled via `tauri.conf.json` resources (`../node_modules/chrome-devtools-mcp` → `mcp/chrome-devtools-mcp`).

---

## 11. Reference tables

### 11.1 Constants and limits

| Constant | Value | Where |
|----------|-------|-------|
| Search rate limit | 1 req/s, concurrency 1 | `core/rate-limit.ts` |
| Default aggregate `numResults` | 20 | `search/aggregate.ts` |
| Exa `numResults` | 5 | `search/exa.ts` |
| Tavily `max_results` | 5 | `search/tavily.ts` |
| `MAX_REPEATED_LINE_OCCURRENCES` | 2 | `sanitize-html.ts` |
| `MIN_CONTENT_LENGTH` (auto fallback threshold) | 200 chars | `sanitize-html.ts:4`, used in `extract-page.ts:126` |
| `MAX_HTML_BYTES` | 5 MB | `lib.rs:17` |
| `MAX_FETCH_REDIRECTS` | 5 | `lib.rs:16` |
| `FETCH_TIMEOUT_SECS` | 10 | `lib.rs:15` |
| `PAGE_LOAD_TIMEOUT_SECS` | 30 | `lib.rs:13` |
| `EVAL_RECV_TIMEOUT_SECS` | 5 | `lib.rs:14` |
| Poll interval | 500 ms | `lib.rs:107` |
| Post-load delay | 2 s | `lib.rs:110` |
| Reddit challenge retry window | 5 min, 5 s interval | `extract-page-content-tool.ts:316` |
| Amazon challenge retry window | 3 min, 3 s interval | `extract-page-content-tool.ts:322` |
| MCP call timeout | 30 s | `chrome-mcp-page-loader.ts`, `chrome-devtools-tools.ts` |
| `REQUIRED_NODE_RANGE` | `^20.19.0 \|\| ^22.12.0 \|\| >=23` | `lib.rs:393` |
| Node resolution timeout | 8 s | `lib.rs:394` |
| Stderr tail retention | 8,000 chars | `tauri-stdio-transport.ts` |

### 11.2 Method matrix

| Model-facing `method` | Engine method | `fetchHtml` | `renderHtml` | Notes |
|-----------------------|---------------|-------------|--------------|-------|
| `auto` (default) | `auto` | Rust `fetch_html` | webview / chrome-mcp / scrape.do | Falls back to render if sanitised content < 200 chars |
| `fetch` | `fetch` | Rust `fetch_html` | n/a | HTTP only; no JS rendering |
| `webview` | `render` | n/a | Tauri webview | Forces the built-in browser |
| `chrome` | `render` | n/a | Chrome MCP | Forces local Chrome via sidecar |
| `scrape.do` | `render` (Scrape.do-layered) | n/a | Scrape.do remote renderer | Falls back to base loader if no token |

### 11.3 Error strings returned to the model

| Condition | Returned string |
|-----------|----------------|
| `UrlValidationError` (any rule) | `"Error: <message>"` |
| No content extracted | `"No content could be extracted from <url>. The page may be empty, require JavaScript rendering, or be blocked by a paywall or captcha."` |
| Save to research folder failed | `<content>\n\n[Warning: Failed to save this content to the research folder. It will not be available for future searches.]` |
| Aborted | (re-thrown, propagates as `AbortError`) |
| Any other error | (re-thrown, surfaces as tool error) |

### 11.4 Where decisions live

| Decision | Made by | File |
|----------|---------|------|
| Which search providers are visible | `createSearchTools` key filter | `src/lib/transport/tool-registry.ts:70-80` |
| How many results each provider returns | hardcoded per provider | `search/{brave,exa,serper,tavily,searxng}.ts` |
| Provider request shape | per-provider `execute` | same |
| Provider response parsing | `createSearchProvider` + `responseSchema` | `search/create-search-provider.ts:30-51` |
| Cross-provider dedup | `mergeResults` | `search/aggregate.ts` |
| URL safety (TS) | `validateUrl` | `deep-search-core/.../extract/page-loader.ts:43-86`, `src/lib/url-validation.ts` |
| URL safety (Rust) | `validate_external_url` + `resolve_public_socket_addrs` | `src-tauri/src/lib.rs:135-204` |
| Custom extractor dispatch | first `canHandle` match wins | `extract-page.ts:45-70` |
| Fetch vs render fallback | `MIN_CONTENT_LENGTH = 200` | `extract-page.ts:126` |
| Which backend renders | `getEngine()` cache key | `extract-page-content-tool.ts:69-118` |
| Whether to summarise | `shouldSummarizeContent` | `extract-page-content-tool.ts:390-399` |
| CAPTCHA retry | `getRetryOptions` + loop | `extract-page-content-tool.ts:308-374` |
| Webview serialisation | `runExclusiveWebviewExtraction` | `extract-page-content-tool.ts:157-173` |

---

## 12. Summary

Search and extraction are deliberately split: a thin provider-agnostic engine in `deep-search-core` orchestrates five pluggable search providers and a multi-phase extraction pipeline; the app injects Tauri-specific behaviour through a single `PageLoader` interface with two optional methods (`fetchHtml`, `renderHtml`).

**Search** is uniform across providers — a factory wraps `(execute, responseSchema, mapResults)` into a rate-limited `SearchFn`, with three error classes covering missing config, HTTP failure, and unexpected response shape. The aggregate provider normalises URLs, deduplicates across engines by frequency and best rank, and returns up to 20 results. Output to the model is plain text.

**Extraction** is layered: a site-specific extractor (Reddit/Amazon/Shopify/Github) fires first if the URL matches; otherwise generic extraction tries HTTP fetch, falls back to a real browser if the sanitised content is under 200 characters, and optionally summarises with an LLM. The default browser backend is a hidden Tauri webview; Chrome DevTools MCP and Scrape.do are optional drop-ins through the same `PageLoader` interface.

**Security** is enforced twice — once in TypeScript (`ipaddr.js` range check), once in Rust (CIDR block lists with DNS rebinding defence via `resolve_to_addrs`). Both layers share the same intent: block non-https, block local hostnames, block private IPs, block dangerous schemes.

**Reliability** comes from bounded retry loops (Reddit/Amazon CAPTCHAs), graceful degradation (save failures are warnings, not errors; failed webview extractions return null; failed summaries fall through to raw content), and a frontend mutex that prevents webview-tab races.
