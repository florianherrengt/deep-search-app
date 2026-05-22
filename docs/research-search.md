# Research Library Search

The AI agent can search across all past research sessions using the `search_research` tool. It's available in every chat session — no setup needed.

## For the agent

### Searching

```
search_research({ query: "how do transformers handle long context" })
```

Returns matching research folders only. Each result includes the folder name as `folder_name`; chunk content is intentionally omitted from the agent-facing tool result.
If the search backend is temporarily unavailable, the agent-facing tool returns no matches instead of exposing provider errors in chat.

Optional parameters:
- `folder` — limit to a specific research folder (e.g. `"acme-market-map"`)
- `limit` — max results, default 8

### When to use it

- Before starting new research, check if the topic was already covered in a past session
- When the user asks about something that might have been researched before
- When following up on a previous research thread

### How indexing works

- Files are indexed automatically when saved via `save_research_file`
- Research folders are registered when created (first message of a session)
- The search uses hybrid semantic + keyword matching with reranking
- Results are filtered by relevance — irrelevant queries return nothing

### Architecture

- Embedding model: `qwen/qwen3-embedding-4b` (1024 dimensions) via OpenRouter
- Keyword search: SQLite FTS5 with Porter stemming
- Vector search: sqlite-vec KNN
- Fusion: Adaptive Reciprocal Rank Fusion
- Reranking: `cohere/rerank-4-pro` via OpenRouter (free)
- Uses the user's existing OpenRouter API key
