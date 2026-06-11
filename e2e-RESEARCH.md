# E2E SSE Mocking Research

## TL;DR Summary

**Your existing `__deepSearchProviderFetchMock` approach in `chat.js:installOpenRouterMock()` is already correct and is the right approach.** The mock creates a `Response` with a `ReadableStream` body that emits SSE-formatted chunks over time. This matches exactly how the Vercel AI SDK's providers consume responses.

The `"Invalid JSON response"` error is most likely caused by one of:
1. **Missing or malformed SSE format** (wrong JSON shape, wrong `\n\n` separators)
2. **Missing `Content-Type: text/event-stream` response header**
3. **The mock not intercepting the actual fetch call** (ensure `window.__deepSearchProviderFetchMock` is set BEFORE the chat UI initializes)

---

## 1. How Playwright's `route.fulfill()` Handles SSE

### The Fundamental Problem

Playwright's `route.fulfill()` **cannot simulate true streaming**. Here's why:

- `route.fulfill({ body })` only accepts `string | Buffer` as the body type (see [Playwright #33564](https://github.com/microsoft/playwright/issues/33564))
- It sends the entire body as a single chunk and **immediately closes the HTTP connection**
- For SSE, the browser expects a persistent connection where data arrives in chunks over time
- **Azure's LogicAppsAgentChat team** explicitly documented this: *"Playwright's `route.fulfill()` cannot properly simulate long-lived SSE connections. The mock sends data and immediately closes the connection before the client can process streaming events."* ([source](https://github.com/Azure/LogicAppsAgentChat/blob/main/e2e/E2E_TESTING_FINDINGS.md))

### Workarounds That People Use

1. **TypeScript cast to `any` with ReadableStream** — The `assrt.ai` guide shows this pattern:
   ```ts
   const body = new ReadableStream({ start(controller) { /* ... */ } });
   await route.fulfill({
     status: 200,
     headers: { 'Content-Type': 'text/event-stream' },
     body: body as any,  // TypeScript workaround, may not actually stream
   });
   ```
   In practice, this works for some cases but is unreliable. The entire stream may be buffered and sent at once, or the connection may close prematurely.

2. **All events at once (simplest, works for non-streaming validation)** — Concatenate all SSE events into a single string:
   ```ts
   await route.fulfill({
     status: 200,
     headers: { 'Content-Type': 'text/event-stream' },
     body: `data: ${JSON.stringify(chunk1)}\n\ndata: ${JSON.stringify(chunk2)}\n\ndata: [DONE]\n\n`,
   });
   ```
   This works if you only need to verify that the full text appears in the UI eventually, but won't test incremental rendering.

3. **`route.fetch()` + real mock server** — Intercept the request, forward it to a local Express mock server that properly handles SSE, then fulfill the response:
   ```ts
   await page.route('**/api/chat', async (route) => {
     const response = await route.fetch({ url: 'http://localhost:3456/mock-chat' });
     await route.fulfill({ response });
   });
   ```

4. **`page.evaluate` to mock `fetch`** — Inject a mock fetch that returns a `Response` with a `ReadableStream`. This completely avoids Playwright's route interception and is the approach your codebase already uses.

**Bottom line: Your `__deepSearchProviderFetchMock` approach (option 4) is the correct one. Don't use `page.route()` for SSE streaming.**

---

## 2. Exact SSE Format for OpenAI-Compatible Chat Completions

### Wire Format

OpenAI-compatible streaming responses use Server-Sent Events with this exact byte format:

```
data: <JSON>\n\n
```

Key rules:
- Each event starts with `data: ` (note the space after colon)
- The JSON must be on the **same line** as the `data: ` prefix
- Each event is terminated by **two newlines** (`\n\n`)
- The stream is terminated by `data: [DONE]\n\n`
- `[DONE]` is literal text, NOT inside JSON string delimiters

### Full Response Example (raw bytes)

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1702657020,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1702657020,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1702657020,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{"content":" world!"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1702657020,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]

```

### Chunk JSON Structure

Each chunk must match what the AI SDK's Zod schema expects. The schema is defined in `parseJsonEventStream` which uses `createEventSourceResponseHandler(OpenRouterStreamChatCompletionChunkSchema)`.

**Minimum valid chunk:**
```json
{
  "id": "any-string",
  "object": "chat.completion.chunk",
  "choices": [
    {
      "index": 0,
      "delta": {
        "content": "some text"
      },
      "finish_reason": null
    }
  ]
}
```

The schema is a `z.union` that matches either a valid chunk OR an error response. The schema uses `.passthrough()` so extra fields are silently allowed. The critical fields are:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `choices` | array | ✅ | Must be an array |
| `choices[0].index` | number | ⚠️ | Should be `0` |
| `choices[0].delta` | object | ⚠️ | Contains `content`, `role`, `tool_calls` |
| `choices[0].delta.content` | string|null | — | The actual text delta |
| `choices[0].finish_reason` | string|null | — | `null` during streaming, `"stop"` at end |
| `usage` | object|null | — | Optional, only in final chunk before `[DONE]` |
| `id` | string | — | Any string for mock purposes |
| `object` | string | — | Set to `"chat.completion.chunk"` |

**First chunk pattern** (sends `role`):
```json
{
  "id": "mock-id",
  "object": "chat.completion.chunk",
  "choices": [{
    "index": 0,
    "delta": {"role": "assistant", "content": ""},
    "finish_reason": null
  }]
}
```

**Content chunk pattern:**
```json
{
  "id": "mock-id",
  "object": "chat.completion.chunk",
  "choices": [{
    "index": 0,
    "delta": {"content": "Hello world"},
    "finish_reason": null
  }]
}
```

**Final chunk pattern** (before `[DONE]`):
```json
{
  "id": "mock-id",
  "object": "chat.completion.chunk",
  "choices": [{
    "index": 0,
    "delta": {},
    "finish_reason": "stop"
  }]
}
```

**Usage chunk** (optional, before `[DONE]`, with `choices: []`):
```json
{
  "id": "mock-id",
  "object": "chat.completion.chunk",
  "choices": [],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 5,
    "total_tokens": 15
  }
}
```

### Common Mistakes That Cause "Invalid JSON Response"

1. **Using `\n` (single newline) instead of `\n\n` (double newline) to separate events** — The SSE parser won't dispatch the event until it sees `\n\n`.

2. **Missing `data: ` prefix** — Must be exactly `data: ` with the space.

3. **Putting `[DONE]` inside a JSON string** — It must be bare text: `data: [DONE]` NOT `data: "[DONE]"`.

4. **Missing the first role-info chunk** — Some implementations need to see the `{"role": "assistant"}` delta before content chunks.

5. **Wrong Content-Type header** — Must be `text/event-stream`, not `application/json`.

6. **Omitting `choices` being an array** — `choices: { ... }` will fail; must be `choices: [{ ... }]`.

7. **OpenRouter comments in the stream** — OpenRouter sometimes sends `: OPENROUTER PROCESSING\n\n` as SSE comments. The AI SDK's parser via `eventsource-parser` should handle these correctly (SSE comments start with `:` and are ignored).

---

## 3. How the Vercel AI SDK Parses SSE (Source-Level Detail)

### The Parsing Pipeline

The AI SDK uses `eventsource-parser` v3 (the `@rexxars/eventsource-parser` package) via `EventSourceParserStream`. The pipeline is:

```
Response.body (ReadableStream<Uint8Array>)
  → TextDecoderStream (bytes → text)
  → EventSourceParserStream (text → SSE events { data, event, id })
  → JSON.parse(data) via safeParseJSON
  → Zod schema validation (OpenRouterStreamChatCompletionChunkSchema)
  → Provider-specific TransformStream (chunks → LanguageModelV4StreamPart)
```

Source file: `vercel/ai/packages/provider-utils/src/parse-json-event-stream.ts`:
```ts
export function parseJsonEventStream<T>({
  stream, schema,
}: {
  stream: ReadableStream<Uint8Array>;
  schema: FlexibleSchema<T>;
}): ReadableStream<ParseResult<T>> {
  return stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .pipeThrough(
      new TransformStream<EventSourceMessage, ParseResult<T>>({
        async transform({ data }, controller) {
          if (data === '[DONE]') return;  // ignore [DONE]
          controller.enqueue(await safeParseJSON({ text: data, schema }));
        },
      }),
    );
}
```

### Key Parsing Behaviors

1. **The `[DONE]` sentinel is checked as a bare string** — After the SSE parser extracts the `data` field, it compares it literally against `'[DONE]'`. If it matches, the chunk is silently skipped (not passed to Zod).

2. **`safeParseJSON` is used** — This means malformed JSON produces a `{ success: false, error: ... }` result, which flows as an error stream part.

3. **`EventSourceParserStream` handles line buffering** — It correctly handles chunks that arrive across multiple `ReadableStream` reads, partial lines, and CRLF line endings (both `\r\n` and `\n` are supported as of the 2025-05-07 fix).

4. **SSE comment lines (`: ...`) are ignored** — Per the SSE spec, lines starting with `:` are comments and are not dispatched as events.

---

## 4. Your Existing Mock Implementation (Assessment)

Your `installOpenRouterMock()` in `e2e-tests/test/helpers/chat.js` (line 347) is correctly implemented:

```js
const stream = new ReadableStream({
  start(controller) {
    const enqueueEvent = (event) => {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
      );
    };
    // ... event scheduling with delays ...
    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    controller.close();
  },
});

return new Response(stream, {
  status: 200,
  headers: { 'Content-Type': 'text/event-stream' },
});
```

This produces a proper `Response` object with a `ReadableStream` body — which is exactly what the AI SDK's `postJsonToApi` (which calls `fetch()`) receives and processes.

### Why It Might Be Failing

If you're seeing "Invalid JSON response", check:

1. **Timing** — `installOpenRouterMock` sets `window.fetch` AND `window.__deepSearchProviderFetchMock`. But `chat-providers.ts` only reads `__deepSearchProviderFetchMock` during `providerFetch()`. Make sure the mock is installed **before** the chat UI calls `createOpenRouter()`.

2. **`providerFetch` resolution order** — In `chat-providers.ts:209-220`:
   ```ts
   const providerFetch: typeof fetch = (input, init) => {
     const mock = getDevProviderFetchMock();  // checks window.__deepSearchProviderFetchMock
     if (mock) return mock(input, init);
     if (isTauriRuntime()) return tauriFetch(input, init);
     return globalThis.fetch(input, init);
   };
   ```
   The mock takes priority, which is correct. But `createOpenRouter({ fetch: providerFetch })` is called once during model creation — if the mock isn't installed yet, the real `fetch` is captured in the closure.

3. **WebDriverIO vs Playwright** — Your existing e2e tests use **WebDriverIO** (`browser.execute()`, `$$`, `$`), not Playwright's test runner. The `page.evaluate()` / `browser.execute()` approach works the same way. Just ensure `installOpenRouterMock` is called AFTER the page loads (so `window` exists) but BEFORE the chat sends a message.

4. **SSE event format** — Your `textResponse()` helper (line 503) produces correct chunks. Verify the JSON isn't malformed (e.g., unescaped special characters in the content).

---

## 5. Proven Approaches from Other Projects

### Approach A: `page.evaluate` to Mock `window.fetch` (Your Approach — Recommended)

This is what your codebase does and what works best for the AI SDK. The mock runs entirely inside the browser's JavaScript environment, so there are no Playwright network-layer limitations.

**Pros:**
- Works with any transport (SSE, WebSocket, custom streams)
- Full control over timing, chunk size, delays
- Can implement "hold and release" patterns for testing intermediate states
- No Playwright API limitations on streaming

**Cons:**
- Must be injected before the app code initializes providers
- Can't use Playwright's route inspection API (`on('response')`, etc.)
- Mock lives in the page context, harder to debug from test side

**Real-world examples:**

1. **Your own project** (`e2e-tests/test/helpers/chat.js`) — Already implements this correctly with `ReadableStream` and timed event emission.

2. **Azure LogicAppsAgentChat** — Their team concluded that `page.route()` can't handle SSE and recommends using a real mock server or MSW instead.

### Approach B: `page.route()` with String Body (Simple, Limited)

```ts
await page.route('**/openrouter.ai/api/**', async (route) => {
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    body: [
      `data: ${JSON.stringify(chunk1)}\n\n`,
      `data: ${JSON.stringify(chunk2)}\n\n`,
      `data: [DONE]\n\n`,
    ].join(''),
  });
});
```

**Pros:** Simple, uses Playwright APIs.
**Cons:** All chunks arrive at once. No streaming behavior. Connection closes immediately. AI SDK may fail if the client expects a slowly-arriving stream.

**Who uses this:** The `testdino-hq/playwright-skill` repo and `sanity-io/sanity` use this for simple SSE events (not LLM streaming).

### Approach C: Real Mock Server (Most Production-Grade)

```ts
// Start a local Express server before tests
const sseServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  // Stream events over time...
});

// In Playwright test:
await page.route('**/openrouter.ai/**', async (route) => {
  const response = await route.fetch({ url: 'http://localhost:9999/mock' });
  await route.fulfill({ response });
});
```

**Pros:** Real HTTP server, real SSE streaming, full control.
**Cons:** Requires process management, more complex setup.

**Who uses this:** Azure LogicAppsAgentChat recommends this for integration tests. Many enterprise projects use this pattern.

### Approach D: MSW (Mock Service Worker)

MSW v2 supports `ReadableStream` in `HttpResponse`:

```ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.post('https://openrouter.ai/api/v1/chat/completions', () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new HttpResponse(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }),
];
```

**Pros:** Runs in the browser's service worker, can intercept all fetch calls.
**Cons:** MSW's service worker conflicts with Playwright's `page.route()`. Must choose one or the other.

---

## 6. The `page.evaluate` Fetch Mock Pattern (Detailed)

### How to Inject a Fetch Mock

```ts
await page.evaluate(() => {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.includes('openrouter')) {
      return originalFetch(input, init);
    }

    const encoder = new TextEncoder();
    const chunks = [
      { id: '1', object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
      { id: '2', object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] },
      { id: '3', object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ];

    const stream = new ReadableStream({
      start(controller) {
        // Emit chunks with delays for realistic streaming
        let i = 0;
        function next() {
          if (i >= chunks.length) {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunks[i])}\n\n`)
          );
          i++;
          setTimeout(next, 25); // Simulate token-by-token streaming
        }
        next();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
});
```

### Must Be Injected Before the Provider Initializes

The AI SDK provider captures the `fetch` function at creation time:
```ts
// chat-providers.ts
createOpenRouter({ fetch: providerFetch })  // captures providerFetch reference
```

So you MUST inject the mock **before** `sendMessage()` triggers model creation. In your codebase, this means:
1. Navigate to the page
2. Call `installOpenRouterMock(responses)` to inject the mock
3. THEN call `sendMessage()` to trigger the chat

### Testing with `addInitScript` (Injects Before Any Page Code Runs)

```ts
await page.addInitScript(() => {
  window.__deepSearchProviderFetchMock = async (input, init) => {
    // ... mock implementation ...
  };
});
await page.goto('/');
```

This ensures the mock is available before any React components mount. However, `addInitScript` runs in a clean context — it can't access variables from your test file. You need to serialize any mock data.

---

## 7. Debugging Checklist for "Invalid JSON Response"

If the AI SDK shows "Invalid JSON response":

1. **Verify Content-Type**: Must be exactly `text/event-stream`. Check with:
   ```js
   // In mock, log the response
   console.log('Response headers:', response.headers.get('Content-Type'));
   ```

2. **Verify SSE format**: Each event MUST end with `\n\n` (two newlines). Check:
   ```js
   const rawBody = await response.text();
   console.log('Raw body:', JSON.stringify(rawBody));
   // Should look like: "data: {...}\n\ndata: {...}\n\ndata: [DONE]\n\n"
   ```

3. **Verify the JSON inside data lines**: Parse each `data:` line separately:
   ```js
   const lines = rawBody.split('\n\n').filter(l => l.length > 0);
   for (const line of lines) {
     if (line.startsWith('data: ')) {
       const json = line.slice(6);
       console.log('Parsing:', json);
       JSON.parse(json);  // Will throw if invalid
     }
   }
   ```

4. **Verify the fetch path**: Ensure `__deepSearchProviderFetchMock` is actually being called. Add a log:
   ```js
   window.__deepSearchProviderFetchMock = async (input, init) => {
     console.log('MOCK FETCH CALLED:', input);
     // ...
   };
   ```

5. **Check for OpenRouter-specific anomalies**: Some OpenRouter providers send `logprobs: { tokens: null, ... }` instead of `logprobs: null`. If you're capturing real responses, the AI SDK schema might reject these. Simplify your mock chunks to only include `id`, `object`, `choices`, and optionally `model`.

6. **Check Zod version**: The AI SDK uses Zod v4. Make sure your mock data matches the schema. The simplest safe chunk is:
   ```json
   {"id":"a","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"text"},"finish_reason":null}]}
   ```

---

## 8. Recommended Architecture for Your E2E Tests

Your current approach (`__deepSearchProviderFetchMock`) is solid. Here's how to make it robust:

### Keep the `page.evaluate` Fetch Mock
It's the only reliable way to test SSE streaming in the browser without a real backend server.

### Add Integration Tests with a Real Mock Server (Optional)
For tests that need true, long-lived streaming behavior, add a simple Express server that properly handles SSE:
```js
// mock-sse-server.mjs
import { createServer } from 'http';
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  // Stream chunks over time...
});
server.listen(3456);
```

### Test at Multiple Levels
1. **Unit tests (Vitest)**: Test `chat-providers.ts` with `MockLanguageModelV4` from `ai/test`
2. **Component tests (Storybook)**: Test UI components with mocked data
3. **E2E tests (WebDriverIO/Playwright)**: Test full user flows with the fetch mock
4. **Integration tests**: Test against a real OpenRouter API (or a staging proxy)

---

## Sources

- **Playwright SSE limitation**: [microsoft/playwright#33564](https://github.com/microsoft/playwright/issues/33564) — Feature request for ReadableStream body in route.fulfill (still open)
- **Azure LogicAppsAgentChat findings**: [E2E_TESTING_FINDINGS.md](https://github.com/Azure/LogicAppsAgentChat/blob/main/e2e/E2E_TESTING_FINDINGS.md) — Documents that Playwright route.fulfill cannot simulate SSE
- **AI SDK parseJsonEventStream**: [vercel/ai source](https://github.com/vercel/ai/blob/main/packages/provider-utils/src/parse-json-event-stream.ts) — The SSE parser used by all providers
- **OpenRouter Provider test fixtures**: [OpenRouterTeam/ai-sdk-provider test](https://github.com/OpenRouterTeam/ai-sdk-provider/blob/7c043a08/src/chat/index.test.ts) — Shows exact SSE format used in provider tests
- **Vercel AI SDK testing docs**: [ai-sdk.dev/docs/ai-sdk-core/testing](https://ai-sdk.dev/docs/ai-sdk-core/testing) — MockLanguageModelV4 for unit tests
- **AI SDK stream protocols**: [ai-sdk.dev/docs/ai-sdk-ui/stream-protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) — SSE format for data streams
- **OpenRouter streaming docs**: [openrouter.ai/docs/api/reference/streaming](https://openrouter.ai/docs/api/reference/streaming) — OpenRouter-specific SSE format and comments
- **Assrt.ai Playwright SSE guide**: [assrt.ai/t/how-to-test-ai-chat-streaming-ui](https://assrt.ai/t/how-to-test-ai-chat-streaming-ui) — Comprehensive guide with working examples
- **OpenAI streaming guide**: [developers.openai.com/cookbook/examples/how_to_stream_completions](https://developers.openai.com/cookbook/examples/how_to_stream_completions) — Reference SSE format
- **Eventsource-parser library**: [github.com/rexxars/eventsource-parser](https://github.com/rexxars/eventsource-parser) — Used by AI SDK for SSE parsing
