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

`deep_search` handles start, polling, and follow-up questions based on the input
shape.

Start new research:

```json
{ "question": "Research React 19 migration risk for this repo" }
```

Poll an existing research session:

```json
{ "session_id": "abc" }
```

Ask a follow-up after a completed answer:

```json
{
  "session_id": "abc",
  "question": "Now compare that with the Vue migration risk."
}
```

No folder name, chat id, source list, artifact paths, or debug metadata is
required in the request. Those are app internals.

The desktop app writes a stdio MCP proxy into its app data directory. Users
should copy the path from Settings under Deep Search MCP, then reference that
file directly in their MCP client config:

```json
{
  "mcpServers": {
    "deep-search": {
      "command": "/Users/you/Library/Application Support/com.deep-search-app.app/deep-search-mcp.mjs"
    }
  }
}
```

If the MCP client does not execute shebang scripts directly, use Node with the
same proxy file:

```json
{
  "mcpServers": {
    "deep-search": {
      "command": "node",
      "args": ["/Users/you/Library/Application Support/com.deep-search-app.app/deep-search-mcp.mjs"]
    }
  }
}
```

`npm run mcp` remains available as a development smoke command, but it is not
required in MCP client configuration.

The desktop app must already be running. On startup, the app writes
`mcp-bridge.json` into its app data directory with a localhost port and bearer
token. The proxy reads that file and forwards MCP calls to the running app.

If the proxy cannot find the config file automatically, set:

```json
{
  "mcpServers": {
    "deep-search": {
      "command": "/Users/you/Library/Application Support/com.deep-search-app.app/deep-search-mcp.mjs",
      "env": {
        "DEEP_SEARCH_MCP_BRIDGE_CONFIG": "/absolute/path/to/mcp-bridge.json"
      }
    }
  }
}
```

---

## 3. Return Shape

`deep_search` returns one of four states.

Running:

```json
{
  "session_id": "abc",
  "status": "running"
}
```

`running` is not a terminal response. The caller must call `deep_search` again
with the same `session_id` until the response is `done`, `failed`, or
`cancelled`.

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

After `done`, a follow-up uses the same `session_id` plus a new `question`. The
app appends the question to the same chat history and starts another research
turn in the same saved session.

---

## 4. Clarification Questions

The MCP call does not pause for user clarification questions.

When the app research agent calls `ask_questions` during an MCP-created research
session, the app marks that tool call as skipped and immediately continues the
run. The model receives a tool result telling it to proceed with reasonable
assumptions and finish the original request.

```text
deep_search({ question })
  -> { session_id, status: "running" | "done" | "failed" | "cancelled" }
```

This keeps the MCP flow single-user-prompt oriented: ask once, poll if needed,
then read the final answer.

---

## 5. App Integration Contract

MCP-created research must enter the same app path as UI-created research.

The implementation factors the current chat research path into a shared
headless runner:

```text
DeepSearchSessionManager
  handle({ question })
  handle({ session_id })
  handle({ session_id, question })
  cancel(session_id)
```

The existing UI and the MCP bridge should both use this runner.

The runner must preserve these behaviours:

- Create or reuse a research folder through the existing folder lifecycle.
- Save chat messages with `saveResearchChatMessages`.
- Run the existing guarded stream and tool registry.
- Skip MCP `ask_questions` calls and continue without returning a question state.
- Append follow-up questions to the same saved chat after a completed answer.
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
done
failed
cancelled
```

Only `session_id`, `status`, `result`, and `error` need to cross the MCP
boundary.

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

The coding agent must call `deep_search` again with the same `session_id`.

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

---

## 10. Copy-Paste Skill Example

Use this as a coding-agent skill when the agent supports reusable skills or
instruction files. Replace only the MCP config path in your agent setup; the
skill text can be copied as-is.

````markdown
---
name: deep-search-mcp
description: Use Deep Search MCP for web-backed research, source checking, product/company/API lookups, current facts, comparison research, and any task where a coding agent needs a cited answer from the running Deep Search desktop app.
---

# Deep Search MCP

Use the `deep_search` MCP tool when the user asks for research that benefits
from current web search, page reading, source comparison, or citations.

## Workflow

1. Start research with:

   ```json
   { "question": "<the user's full research request>" }
   ```

2. If the result is:

   ```json
   { "status": "running", "session_id": "..." }
   ```

   call `deep_search` again with only that `session_id` until the status is
   `done`, `failed`, or `cancelled`.

3. If the result is `done`, use `result` as the research answer. Preserve useful
   citations and uncertainty from the result.

4. If the user asks a follow-up, reuse the same session:

   ```json
   { "session_id": "<previous session_id>", "question": "<follow-up>" }
   ```

## Rules

- Do not call lower-level search or extraction tools when `deep_search` can run
  the research session.
- Do not ask the user Deep Search clarification questions. The MCP runner skips
  app-generated clarification questions and continues with reasonable
  assumptions.
- Do not treat `running` as a final answer. Poll with the same `session_id`.
- Do not invent citations. If Deep Search returns uncertainty or a failure,
  report that directly.
- Keep the final response focused on the user's question, not on MCP mechanics.
````
