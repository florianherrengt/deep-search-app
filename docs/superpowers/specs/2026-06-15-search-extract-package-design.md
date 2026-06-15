# Search And Content Extraction Package Design

## Goal

Extract the app's external web search and web page content extraction engine into an in-repo package that can later become a standalone npm package.

The package must be runtime-agnostic. It should work with basic `fetch` by default, while allowing host apps to provide stronger page loading capabilities such as Tauri WebView, Playwright, browser automation, or MCP/plugin-specific extraction.

## Scope

Included:

- External web search providers: Brave, Exa, Serper, Tavily, and SearXNG.
- Shared search result types, provider response validation, formatting helpers, and rate limiting.
- Generic page content extraction from HTML.
- Custom extractors for Amazon, Shopify, and Reddit.
- Query-focused and optional summarization through an injected summarizer callback.
- Optional adapters for Vercel AI SDK tools and this app's Tauri page loading.

Excluded:

- Local research-history search and indexing.
- SQLite/sqlite-vec, embeddings, reranking, and research folder indexing.
- React UI, Tauri tab UI, sub-agent events, app file storage, and tool-call guardrails.
- Hosted services or a new backend.

## Package Shape

Create an in-repo package:

```text
packages/search-extract/
  src/
    core/
      engine.ts
      types.ts
      rate-limit.ts
      errors.ts
    search/
      create-search-provider.ts
      brave.ts
      exa.ts
      serper.ts
      tavily.ts
      searxng.ts
      format.ts
    extract/
      extract-page.ts
      page-loader.ts
      sanitize-html.ts
      extractors/
        base.ts
        registry.ts
        amazon.ts
        shopify.ts
        reddit.ts
        reddit-json-parser.ts
    adapters/
      ai-sdk.ts
      tauri.ts
```

The core package owns pure search and extraction behavior. Adapters translate package APIs into host-specific integrations.

## Public API

The main entry point creates an engine instance:

```ts
const engine = createSearchExtractEngine({
  fetch: globalThis.fetch,
  searchProviders: {
    brave: { apiKey: braveApiKey },
    exa: { apiKey: exaApiKey },
    serper: { apiKey: serperApiKey },
    tavily: { apiKey: tavilyApiKey },
    searxng: { baseUrl: searxngBaseUrl },
  },
  pageLoader: {
    fetchHtml,
    renderHtml,
  },
  summarizer,
  rateLimit: {
    strategy: "global",
    requestsPerSecond: 1,
  },
});
```

The core engine exposes low-level operations first:

```ts
type SearchExtractEngine = {
  search(
    provider: SearchProviderName,
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]>;

  searchAll(
    query: string,
    options?: SearchAllOptions,
  ): Promise<SearchResult[]>;

  extract(url: string, options?: ExtractOptions): Promise<ExtractResult>;
};
```

`searchAll` is included as a small convenience over enabled providers. It should not become a full research-agent orchestration layer in the first extraction.

## Page Loading Interface

The package accepts host-provided page loading capabilities:

```ts
type PageLoader = {
  fetchHtml?: (
    url: string,
    options: PageLoadOptions,
  ) => Promise<string | null>;

  renderHtml?: (
    url: string,
    options: PageRenderOptions,
  ) => Promise<string | null>;
};
```

`fetchHtml` is for basic HTTP loading. If the host does not provide it, the package can use the configured `fetch` implementation to retrieve HTML.

`renderHtml` is optional. Host apps can provide Tauri WebView, Playwright, browser automation, or another renderer. Custom extractors that require rendered content must use this interface instead of depending on Tauri directly.

## Summarization Interface

The core package does not depend directly on the Vercel AI SDK. It accepts a generic summarizer callback:

```ts
type Summarizer = (input: {
  content: string;
  query?: string;
  signal?: AbortSignal;
}) => Promise<string>;
```

This keeps the engine usable from apps, MCP servers, plugins, or backends that use different model providers.

The package should also provide an AI SDK adapter that converts an AI SDK `LanguageModel` into this callback.

## Search Flow

```text
search(provider, query)
  -> validate provider config
  -> schedule through rate limiter
  -> make provider HTTP request through configured fetch
  -> validate provider response
  -> normalize to SearchResult[]
```

Search returns structured results:

```ts
type SearchResult = {
  title: string;
  url: string;
  description: string;
  snippet?: string;
};
```

Formatting search results into markdown or plain text belongs in adapters, not in the core search method.

## Extraction Flow

```text
extract(url, options)
  -> validate URL
  -> try matching custom extractor
  -> custom extractor uses pageLoader render/fetch as needed
  -> if no custom result, use fetchHtml
  -> sanitize HTML into content
  -> if auto mode and content is too short, try renderHtml
  -> if summarize/query requested, call injected summarizer
  -> return ExtractResult
```

Preserve current behavior where custom extractors run before generic extraction.

Extraction options:

```ts
type ExtractOptions = {
  method?: "auto" | "fetch" | "render";
  summarize?: boolean;
  query?: string;
  signal?: AbortSignal;
};
```

Extraction returns structured output:

```ts
type ExtractResult = {
  url: string;
  content: string;
  summary?: string;
  html?: string | null;
  usedCustomExtractor: boolean;
  extractorName?: string;
  method: "fetch" | "render" | "custom";
  warnings?: string[];
};
```

The current app can preserve its existing tool behavior by returning `summary ?? content` from the AI SDK adapter.

## Summarization Defaults

Core engine behavior:

- Summarize only when `summarize: true` or `query` is provided.
- If summarization is requested but no summarizer is configured, return extracted content and include a warning.
- Do not summarize custom extractor output unless requested or a query is provided.

AI SDK adapter behavior for this app:

- Match the current `extract_page_content` tool defaults.
- Generic extraction summarizes by default.
- Custom extractors do not summarize by default.
- Providing `query` always requests focused summarization.
- `summarize: false` returns full content.

## Custom Extractors

Custom extractors should use a package-owned interface instead of direct globals or setter functions:

```ts
type PageExtractor = {
  name: string;
  canHandle(url: URL): boolean;
  extract(input: ExtractorInput): Promise<ExtractorResult | null>;
};

type ExtractorInput = {
  url: URL;
  loader: PageLoader;
  signal?: AbortSignal;
};

type ExtractorResult = {
  content: string;
  html?: string | null;
  warnings?: string[];
};
```

Amazon, Shopify, and Reddit move into the package using this interface. Their parsing logic should stay close to the current implementation, but Tauri-specific webview injection should be replaced by `loader.renderHtml`.

## Rate Limiting

The first package version keeps the current conservative default:

- Global queue.
- Concurrency 1.
- 1 request per second.
- Abort support.

The configuration shape should leave room for later provider-specific rate limits without breaking callers.

## Adapters

### AI SDK Adapter

The AI SDK adapter should expose helpers that create tool definitions compatible with the current app:

```ts
createAiSdkSearchTools(engine): ToolSet
createAiSdkExtractPageContentTool(engine, options): Tool
createAiSdkSummarizer(model): Summarizer
```

These adapters format structured package results into strings for chat/tool use.

### Tauri Adapter

The Tauri adapter should live in the package but remain optional:

```ts
createTauriPageLoader({ invoke, renderHtml }): PageLoader
```

The current app should continue to own actual Tauri commands, child WebView management, browser tab events, research-folder saving, and sub-agent events. The adapter should only bridge those capabilities into the package interfaces.

## App Migration

Migration should happen in thin slices:

1. Create `packages/search-extract` and move pure shared types/utilities first.
2. Move search providers into the package and rewire current app tools through the AI SDK adapter.
3. Move custom extractors and HTML sanitization into the package.
4. Move generic extraction orchestration into the package with injected `fetchHtml` and `renderHtml`.
5. Move AI SDK wrappers into the package adapter.
6. Leave app-specific Tauri WebView orchestration, research-folder saving, sub-agent events, and guardrails in the app.

Each migration step should keep the current app behavior working and should be independently testable.

## Error Handling

Use typed errors for search and validation failures:

- `SearchProviderConfigError` for missing provider credentials or invalid provider configuration.
- `SearchProviderError` for provider HTTP errors, including provider name, status, and a short body excerpt.
- `SearchProviderResponseError` for invalid provider response shapes.
- `UrlValidationError` for invalid or blocked URLs.

Extraction should return warnings when fallback is possible. Abort and cancellation should propagate as abort errors and should not be converted into normal warnings.

## Testing

Package tests:

- Search-provider response parsing and HTTP error behavior for Brave, Exa, Serper, Tavily, and SearXNG.
- Shared search-provider factory behavior.
- Rate limiter behavior, including abort propagation.
- HTML sanitization and generic extraction fallback behavior.
- Amazon, Shopify, Reddit extractor matching and parsing.
- Summarization behavior with and without a configured summarizer.

App integration tests:

- `createTools()` still conditionally registers enabled search providers.
- `extract_page_content` still returns the same user-facing strings.
- Tauri WebView extraction still opens, switches, extracts, and closes tabs through the app-owned path.

## Risks And Constraints

- The current extraction module mixes app-specific UI events, Tauri commands, storage, summarization, and parsing. The migration must avoid moving app-only behavior into the package.
- SearXNG currently uses a Rust command instead of normal fetch. The package should support SearXNG through the configured fetch path, while the app can keep a Tauri-specific adapter if needed during migration.
- Custom extractors that depend on rendered pages must degrade gracefully when no `renderHtml` implementation is provided.
- Search formatting should not be baked into core methods, or non-chat consumers will have to parse strings back into structured data.
- Local research search is intentionally excluded. Adding it would pull in Rust/Tauri, embeddings, app folders, and sqlite-vec, which is outside this package boundary.

## Success Criteria

- The current app continues to expose the same search and extraction tools to the LLM.
- External search and content extraction logic can be imported from `packages/search-extract` without importing React, Tauri UI code, app storage, or local research indexing.
- A future MCP server or plugin can instantiate the engine with basic fetch, optional browser rendering, and a summarizer callback.
- Search results and extraction results are available as structured data in the core API.
- AI SDK and Tauri integrations are adapters, not core dependencies.
