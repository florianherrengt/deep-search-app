# Search And Content Extraction Package Implementation Plan

**Design:** `docs/superpowers/specs/2026-06-15-search-extract-package-design.md`

**Goal:** Extract external search providers and page content extraction into `packages/search-extract` while preserving the current app's AI tool behavior.

**Architecture:** Runtime-agnostic core package with host-injected `fetchHtml`, `renderHtml`, and `summarizer` capabilities. App-specific Tauri WebView orchestration, storage, sub-agent events, and guardrails stay in `src/`.

**Verification strategy:** Move in thin slices. After each slice, run the narrowest relevant Vitest tests first, then run the package/app integration tests touched by the slice. Run `npm run build` after the final integration step.

---

## Task 1: Package Scaffold

**Files:**

- Create: `packages/search-extract/package.json`
- Create: `packages/search-extract/tsconfig.json`
- Create: `packages/search-extract/src/index.ts`
- Create: `packages/search-extract/src/core/types.ts`
- Update: `package.json`
- Update: `tsconfig.json`
- Update: `vitest.config.ts`

- [ ] Add npm workspaces with `packages/*` in the root `package.json`.
- [ ] Add package metadata for `@deep-search/search-extract`, initially private while it lives in-repo.
- [ ] Export TypeScript source from the package for in-repo use.
- [ ] Add package `tsconfig.json` with strict TypeScript settings and no app path aliases.
- [ ] Update root `tsconfig.json` to include `packages/search-extract/src` or ensure imported package sources are typechecked.
- [ ] Update Vitest unit project includes to cover `packages/search-extract/src/**/__tests__/*.test.ts`.
- [ ] Add an empty `src/index.ts` barrel that exports public types.

**Verification:**

```bash
npm run test:unit:quiet
```

Expected result: existing tests still pass or fail only for known unrelated baseline issues.

---

## Task 2: Core Types, Errors, And Rate Limiter

**Files:**

- Create: `packages/search-extract/src/core/errors.ts`
- Create: `packages/search-extract/src/core/rate-limit.ts`
- Update: `packages/search-extract/src/core/types.ts`
- Create: `packages/search-extract/src/core/__tests__/rate-limit.test.ts`
- Update: `packages/search-extract/src/index.ts`

- [ ] Define `SearchProviderName`, `SearchResult`, `SearchOptions`, `SearchAllOptions`, `PageLoader`, `Summarizer`, `ExtractOptions`, and `ExtractResult`.
- [ ] Define typed errors: `SearchProviderConfigError`, `SearchProviderError`, `SearchProviderResponseError`, and `UrlValidationError`.
- [ ] Move the current `p-queue` behavior into a package-owned rate limiter with global `1 req/sec` defaults.
- [ ] Ensure `AbortSignal` is accepted and propagated through queued work.
- [ ] Export the public types and errors from `src/index.ts`.
- [ ] Add focused tests for queue execution and abort propagation.

**Verification:**

```bash
npx vitest run --project unit packages/search-extract/src/core/__tests__/rate-limit.test.ts --reporter=minimal --silent=passed-only --bail=1
```

---

## Task 3: Search Provider Core

**Files:**

- Create: `packages/search-extract/src/search/create-search-provider.ts`
- Create: `packages/search-extract/src/search/format.ts`
- Create: `packages/search-extract/src/search/brave.ts`
- Create: `packages/search-extract/src/search/exa.ts`
- Create: `packages/search-extract/src/search/serper.ts`
- Create: `packages/search-extract/src/search/tavily.ts`
- Create: `packages/search-extract/src/search/searxng.ts`
- Create: `packages/search-extract/src/search/__tests__/*.test.ts`
- Update: `packages/search-extract/src/index.ts`

- [ ] Move the shared response parsing pattern from `src/tools/create-search-tool.ts` into a provider factory that returns structured `SearchResult[]`.
- [ ] Move `formatSearchResults` into the package as an adapter helper, not as the core provider return value.
- [ ] Port Brave, Exa, Serper, Tavily, and SearXNG provider logic to use injected `fetch`.
- [ ] Preserve provider-specific headers, request bodies, and response mapping.
- [ ] Preserve HTTP error body truncation behavior with typed `SearchProviderError`.
- [ ] Make missing credentials fail when the provider is called, not at package import time.
- [ ] Add provider tests adapted from current `src/tools/__tests__/*-search-tool.test.ts`.

**Verification:**

```bash
npx vitest run --project unit packages/search-extract/src/search --reporter=minimal --silent=passed-only --bail=1
```

---

## Task 4: Engine Search API

**Files:**

- Create: `packages/search-extract/src/core/engine.ts`
- Create: `packages/search-extract/src/core/__tests__/engine-search.test.ts`
- Update: `packages/search-extract/src/index.ts`

- [ ] Implement `createSearchExtractEngine` with configured provider instances.
- [ ] Implement `engine.search(provider, query, options)`.
- [ ] Implement `engine.searchAll(query, options)` as a thin convenience over enabled providers.
- [ ] Apply the package rate limiter around provider calls.
- [ ] Ensure disabled or unconfigured providers produce clear typed config errors.
- [ ] Add tests for provider dispatch, disabled providers, and `searchAll` aggregation.

**Verification:**

```bash
npx vitest run --project unit packages/search-extract/src/core/__tests__/engine-search.test.ts --reporter=minimal --silent=passed-only --bail=1
```

---

## Task 5: Generic HTML Sanitization And Page Loading

**Files:**

- Create: `packages/search-extract/src/extract/sanitize-html.ts`
- Create: `packages/search-extract/src/extract/page-loader.ts`
- Create: `packages/search-extract/src/extract/__tests__/sanitize-html.test.ts`
- Create: `packages/search-extract/src/extract/__tests__/page-loader.test.ts`
- Update: `packages/search-extract/src/index.ts`

- [ ] Move the pure HTML cleanup logic from `src/tools/extract-page-content-tool.ts` into `sanitize-html.ts`.
- [ ] Keep pruning rules, visible text walking, table cell handling, whitespace normalization, and repeated-line capping.
- [ ] Implement default `fetchHtml` behavior using the configured `fetch` implementation.
- [ ] Keep URL validation in the package core without depending on app/Tauri modules.
- [ ] Add tests covering script/style pruning, hidden/noise pruning, line deduplication, table text, empty HTML, and invalid URLs.

**Verification:**

```bash
npx vitest run --project unit packages/search-extract/src/extract --reporter=minimal --silent=passed-only --bail=1
```

---

## Task 6: Custom Extractors

**Files:**

- Create: `packages/search-extract/src/extract/extractors/base.ts`
- Create: `packages/search-extract/src/extract/extractors/registry.ts`
- Create: `packages/search-extract/src/extract/extractors/reddit-json-parser.ts`
- Create: `packages/search-extract/src/extract/extractors/reddit.ts`
- Create: `packages/search-extract/src/extract/extractors/amazon.ts`
- Create: `packages/search-extract/src/extract/extractors/shopify.ts`
- Create: `packages/search-extract/src/extract/extractors/__tests__/*.test.ts`
- Update: `packages/search-extract/src/index.ts`

- [ ] Replace the current setter/global extractor injection pattern with `ExtractorInput.loader`.
- [ ] Port Reddit extractor behavior using `loader.renderHtml` where current code uses the injected webview extractor.
- [ ] Port Amazon extractor behavior using `loader.renderHtml`.
- [ ] Port Shopify extractor behavior using `loader.renderHtml` for `.js` and `.json` product endpoints.
- [ ] Preserve existing parsing, challenge detection, URL matching, and resilience behavior.
- [ ] Ensure extractors return `null` or warnings when required loader capabilities are missing, so generic extraction can continue.
- [ ] Move/adapt existing extractor tests into the package.

**Verification:**

```bash
npx vitest run --project unit packages/search-extract/src/extract/extractors --reporter=minimal --silent=passed-only --bail=1
```

---

## Task 7: Engine Extraction API

**Files:**

- Create: `packages/search-extract/src/extract/extract-page.ts`
- Create: `packages/search-extract/src/extract/__tests__/extract-page.test.ts`
- Update: `packages/search-extract/src/core/engine.ts`
- Update: `packages/search-extract/src/index.ts`

- [ ] Implement `engine.extract(url, options)` using the approved extraction flow.
- [ ] Preserve custom-extractor-first behavior.
- [ ] Preserve `auto` behavior: fetch first, then render if content is shorter than the minimum threshold.
- [ ] Preserve `fetch` behavior: never render.
- [ ] Preserve `render` behavior: use `renderHtml` directly and warn if unavailable.
- [ ] Implement summarization callback behavior for `summarize: true` or `query`.
- [ ] Return structured `ExtractResult` with `content`, optional `summary`, optional `html`, `usedCustomExtractor`, `extractorName`, `method`, and `warnings`.
- [ ] Add tests for generic fetch extraction, render fallback, forced fetch, forced render, custom extractor routing, missing summarizer, summarizer errors, and abort propagation.

**Verification:**

```bash
npx vitest run --project unit packages/search-extract/src/extract/__tests__/extract-page.test.ts --reporter=minimal --silent=passed-only --bail=1
```

---

## Task 8: AI SDK Adapter

**Files:**

- Create: `packages/search-extract/src/adapters/ai-sdk.ts`
- Create: `packages/search-extract/src/adapters/__tests__/ai-sdk.test.ts`
- Update: `packages/search-extract/src/index.ts`

- [ ] Implement `createAiSdkSummarizer(model)` using `streamText` and the current summary prompt.
- [ ] Implement AI SDK search tool wrappers that return formatted strings matching current app tools.
- [ ] Implement `createAiSdkExtractPageContentTool(engine, options)` that preserves current `extract_page_content` defaults.
- [ ] Keep the adapter responsible for chat-tool string formatting, not the core engine.
- [ ] Add tests proving adapter output matches current formatting and summarization defaults.

**Verification:**

```bash
npx vitest run --project unit packages/search-extract/src/adapters/__tests__/ai-sdk.test.ts --reporter=minimal --silent=passed-only --bail=1
```

---

## Task 9: App Tauri Page Loader Integration

**Files:**

- Update: `src/tools/extract-page-content-tool.ts`
- Update: `src/tools/__tests__/extract-page-content-tool.test.ts`
- Optional Create: `src/tools/extraction-page-loader.ts`

- [ ] Keep app-owned WebView tab orchestration, `open_tab`, `switch_tab`, `extract_content`, `close_tab`, browser tab events, and serialization in `src/`.
- [ ] Convert the app's `fetchHtml` and `extractViaWebview` functions into a `PageLoader` passed to the package engine.
- [ ] Keep research-folder saving in the app after receiving package `ExtractResult`.
- [ ] Keep sub-agent start/text/complete/error events in the app wrapper.
- [ ] Keep the public `extractPageContent` and `createExtractPageContentTool` exports stable for current callers.
- [ ] Update tests to assert behavior through the package-backed implementation.

**Verification:**

```bash
npm run test:unit:focused -- src/tools/__tests__/extract-page-content-tool.test.ts
```

---

## Task 10: App Search Tool Integration

**Files:**

- Update: `src/tools/create-search-tool.ts`
- Update: `src/tools/brave-search-tool.ts`
- Update: `src/tools/exa-search-tool.ts`
- Update: `src/tools/serper-search-tool.ts`
- Update: `src/tools/tavily-search-tool.ts`
- Update: `src/tools/searxng-search-tool.ts`
- Update: `src/tools/__tests__/*-search-tool.test.ts`
- Update: `src/lib/transport/tool-registry.ts`

- [ ] Preserve current app tool module exports while delegating provider behavior to package search providers or AI SDK adapter helpers.
- [ ] Continue to use the app's `tauri-bridge.fetch` for provider HTTP requests.
- [ ] Decide during implementation whether SearXNG can use Tauri HTTP fetch directly or should temporarily keep the existing Rust `fetch_searxng_json` adapter path.
- [ ] Keep conditional provider registration in `createTools()` unchanged from the user's perspective.
- [ ] Keep current tool names: `brave_search`, `exa_search`, `serper_search`, `tavily_search`, `searxng_search`.
- [ ] Update search tool tests to verify behavior through package-backed wrappers.

**Verification:**

```bash
npm run test:unit:focused -- src/tools/__tests__/brave-search-tool.test.ts src/tools/__tests__/exa-search-tool.test.ts src/tools/__tests__/serper-search-tool.test.ts src/tools/__tests__/tavily-search-tool.test.ts src/tools/__tests__/searxng-search-tool.test.ts
```

---

## Task 11: Remove Duplicated App Pure Logic

**Files:**

- Update: `src/tools/extractors/*`
- Update: `src/tools/search-result.ts`
- Update: `src/lib/rate-limit.ts`
- Update: affected imports under `src/tools/`

- [ ] Replace app-local extractor implementations with compatibility re-exports or delete them once all app imports use the package.
- [ ] Replace app-local search result formatting/types with package exports where practical.
- [ ] Keep `src/lib/rate-limit.ts` only if non-search app tools still use it; otherwise remove it.
- [ ] Search for duplicate moved logic and remove only code that is no longer referenced.
- [ ] Avoid touching local research search/indexing code.

**Verification:**

```bash
npm run test:unit:quiet
```

---

## Task 12: Final Verification

**Files:**

- Potentially update any files revealed by test/build failures.

- [ ] Run focused package tests.
- [ ] Run focused app search/extraction tests.
- [ ] Run all quiet unit tests.
- [ ] Run `npm run build`.
- [ ] Summarize any remaining risks, especially SearXNG adapter behavior and package publish-readiness gaps.

**Verification:**

```bash
npx vitest run --project unit packages/search-extract/src --reporter=minimal --silent=passed-only --bail=1
npm run test:unit:quiet
npm run build
```

---

## Non-Goals During Implementation

- Do not extract local research-history search, indexing, embeddings, reranking, or SQLite/sqlite-vec code.
- Do not move Tauri child WebView creation or tab UI into the package core.
- Do not add a hosted backend.
- Do not introduce a full research-agent orchestration API beyond `searchAll`.
- Do not change external tool names or user-facing behavior unless a test exposes an unavoidable mismatch.
