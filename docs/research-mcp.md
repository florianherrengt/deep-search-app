# Deep Search MCP

This document describes the MCP interface for letting external coding agents run
Deep Search research.

The MCP must behave as if the user started the research inside the desktop app.
That means MCP-created research must use the same chat transport, research
folder lifecycle, saved history, page extraction, browser rendering, sub-agent
events, and guardrails as normal app research.

---

## 1. Mental Model

The MCP server is a thin bridge into the running Deep Search app.

It does not run a separate research pipeline.

```text
Coding agent
  -> deep_search MCP tool
  -> Deep Search app bridge
  -> normal app research runner
  -> saved research folder, chat history, extracted pages, final answer
```

The app remains the owner of:

- LLM provider settings
- Search provider keys
- research folder creation
- chat transcript persistence
- `README.md`, `summary.md`, and extracted page files
- Tauri webview rendering
- Chrome DevTools MCP fallback
- sub-agent run persistence

The MCP only starts or resumes a research session and returns the current state
to the caller.

---

## 2. Tool Surface

The primary tool should be one tool:

```text
deep_search
```

Optional:

```text
deep_search_cancel
```

`deep_search` handles start, poll, and question answers based on the input shape.

Start new research:

```json
{ "question": "Research React 19 migration risk for this repo" }
```

Poll an existing research session:

```json
{ "session_id": "abc" }
```

Answer pending questions:

```json
{
  "session_id": "abc",
  "answers": ["migration plan"]
}
```

No folder name, chat id, source list, artifact paths, or debug metadata is
required in the request. Those are app internals.

Run the stdio MCP proxy with:

```sh
npm run mcp
```

The desktop app must already be running. On startup, the app writes
`mcp-bridge.json` into its app data directory with a localhost port and bearer
token. The proxy reads that file and forwards MCP calls to the running app.

If the proxy cannot find the config file automatically, set:

```sh
DEEP_SEARCH_MCP_BRIDGE_CONFIG=/absolute/path/to/mcp-bridge.json npm run mcp
```

---

## 3. Return Shape

`deep_search` returns one of three states.

Running:

```json
{
  "session_id": "abc",
  "status": "running"
}
```

Questions:

```json
{
  "session_id": "abc",
  "status": "questions",
  "questions": [
    {
      "text": "Do you want a migration plan or a risk assessment?",
      "options": ["migration plan", "risk assessment"]
    }
  ]
}
```

Done:

```json
{
  "session_id": "abc",
  "status": "done",
  "result": "Final cited research answer..."
}
```

Failed:

```json
{
  "session_id": "abc",
  "status": "failed",
  "error": "No chat model is configured."
}
```

Question answers are matched by order. If the app asks multiple questions, the
caller returns one answer per question.

---

## 4. Split-Phase Questions

The MCP call must not stay open waiting for the user to answer questions.

When the app research agent calls `ask_questions`, the app pauses the run,
persists the current chat transcript, and returns `status: "questions"` from
`deep_search`.

The coding agent then asks its user for the answer and calls `deep_search` again
with `session_id` and `answers`.

```text
deep_search({ question })
  -> { session_id, status: "questions", questions }

deep_search({ session_id, answers })
  -> { session_id, status: "running" | "questions" | "done" }
```

This makes question handling work in ordinary MCP clients. It does not depend on
server-pushed interactive prompts.

---

## 5. App Integration Contract

MCP-created research must enter the same app path as UI-created research.

The implementation factors the current chat research path into a shared
headless runner:

```text
DeepSearchSessionManager
  handle({ question })
  handle({ session_id })
  handle({ session_id, answers })
  cancel(session_id)
```

The existing UI and the MCP bridge should both use this runner.

The runner must preserve these behaviours:

- Create or reuse a research folder through the existing folder lifecycle.
- Save chat messages with `saveResearchChatMessages`.
- Run the existing guarded stream and tool registry.
- Keep `ask_questions` as the structured pause point.
- Save extracted HTML, cleaned text, and summaries into the research folder.
- Use the configured extraction backend: fetch, webview, Scrape.do, or Chrome.
- Emit and persist sub-agent events as normal.
- Leave the research visible and resumable from the desktop app.

The MCP must not write research files directly.

---

## 6. Browser Rendering

MCP research uses the app's configured page extraction behavior.

The default is whatever the user selected in Settings. If the app is configured
to use the built-in Tauri webview, MCP research uses that. If Chrome DevTools MCP
is enabled as a fallback or backend, MCP research uses the same path.

The MCP tool should not expose browser-rendering controls in the first version.
External coding agents should get the same behavior as the app user.

---

## 7. Session State

Internally, the app tracks at least these states:

```text
running
questions
done
failed
cancelled
```

Only `session_id`, `status`, `questions`, `result`, and `error` need to cross the
MCP boundary.

Everything else stays inside the app.

---

## 8. Failure Cases

If the desktop app is not running, the MCP should return a clear failure or try
to start the app, depending on platform support.

If no model or search provider is configured, the result should be:

```json
{
  "session_id": "abc",
  "status": "failed",
  "error": "No chat model is configured."
}
```

If a research run is still working after the MCP call's wait window, return:

```json
{
  "session_id": "abc",
  "status": "running"
}
```

The coding agent can call `deep_search` again with the same `session_id`.

---

## 9. Non-Goals

The MCP should not expose every internal research tool as MCP tools.

Avoid this:

```text
brave_search
extract_page_content
create_research_plan
facts_check
```

That makes the coding agent orchestrate research itself and loses the main value
of Deep Search: enforced planning, reading, persistence, checkpointing, and
fact-checking.

The MCP should expose a research session, not a search toolbox.
