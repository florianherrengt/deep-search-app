# Research Library Semantic Search

Design spec for adding hybrid semantic search to the Deep Search App's research library.

## Problem

The AI agent saves research findings as files under `AppData/search-results/<folder>/`. Over time, users accumulate a large library of research across many sessions. There is no way to search across this library — neither for the human user nor the AI agent during a session.

## Solution

Build a hybrid search system using:

- **sqlite-vec** for vector similarity search (KNN) — local, offline
- **SQLite FTS5** for keyword search (BM25) — local, offline
- **Adaptive Reciprocal Rank Fusion (RRF)** to combine both
- **Cohere reranking** via OpenRouter API (`cohere/rerank-4-pro`, free) for final result quality
- **OpenRouter API** for embedding inference (`qwen/qwen3-embedding-4b`, $0.02/M tokens)

Search index and retrieval run locally in the Rust backend. Both embedding and reranking use the user's existing OpenRouter API key (already configured in settings). One API key, no local model files, no ONNX dependency, no pooling bugs.

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────────┐
│  TypeScript  │     │                 Rust Backend                  │
│              │     │                                              │
│  UI search   │────>│  search_research(query, folder?, limit?)     │
│  Agent tool  │────>│     │                                        │
│              │     │     ├─► OpenRouter embed (Qwen3-4B, 1024d)  │
│              │     │     │                                        │
│              │     │     ├─► vec0 KNN (top 50) ─┐                 │
│              │     │     ├─► FTS5 BM25 (top 50)─┤                 │
│              │     │     │                       │                 │
│              │     │     └─► Adaptive RRF ◄──────┘                │
│              │     │          │                                    │
│              │     │          ├─► Post-filter (folder scope)      │
│              │     │          ├─► MMR dedup (~15 candidates)      │
│              │     │          ├─► Cohere rerank via OpenRouter    │
│              │     │          └─► Context expansion (+/-1 chunks) │
│              │     │               │                               │
│  Results     │<────│               └─► Vec<SearchResult>          │
│  display     │     │                                              │
│              │     │  index_research_file(folder, file, content)  │
│  Index       │────>│     │                                        │
│  trigger     │     │     ├─► Markdown-aware chunking (512 tokens)│
│              │     │     ├─► Content hash check (skip unchanged)  │
│              │     │     ├─► OpenRouter batch embed chunks        │
│              │     │     └─► INSERT into chunks + embeddings + FTS│
└─────────────┘     └──────────────────────────────────────────────┘
```

## Data Model

Single SQLite database at `AppData/research.db`.

```sql
CREATE TABLE research_folders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  query TEXT,
  created_at TEXT DEFAULT (DATETIME('now'))
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  folder_id INTEGER NOT NULL REFERENCES research_folders(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  header_path TEXT,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (DATETIME('now')),
  UNIQUE(folder_id, filename, chunk_index)
);

-- Vector embeddings via sqlite-vec.
-- rowid must match chunks.id for the join.
CREATE VIRTUAL TABLE chunk_embeddings USING vec0(
  embedding float[1024]
);

-- Full-text search via FTS5 with Porter stemming.
-- Uses content-sync mode: auto-updates when chunks table changes.
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  content='chunks',
  content_rowid='id',
  tokenize='porter'
);
```

**Notes:**
- `chunk_embeddings.rowid` = `chunks.id`. Insert embeddings as `INSERT INTO chunk_embeddings(rowid, embedding) VALUES (?, ?)`. Join on `chunk_embeddings.rowid = chunks.id`.
- sqlite-vec does not support filtered KNN. Folder-scoped search is done by post-filtering KNN results after retrieval.
- `content_hash` (SHA-256 of content) enables skip-re-embedding when file content hasn't changed.
- `ON CONFLICT DO UPDATE` preserves row IDs so embeddings stay valid on re-index:

```sql
INSERT INTO chunks (folder_id, filename, header_path, chunk_index, content, content_hash)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(folder_id, filename, chunk_index) DO UPDATE SET
  header_path = excluded.header_path,
  content = excluded.content,
  content_hash = excluded.content_hash;
```

## Chunking Strategy

Markdown-aware recursive character splitting, based on 2026 benchmark consensus:

1. **Header splitting first:** Split on `##` and `###` headings to preserve logical sections
2. **Recursive character splitting within sections:** 512 tokens target, 10-20% overlap, separators: `\n\n` → `\n` → `. ` → ` ` → `""`
3. **Metadata enrichment:** Prepend header path to each chunk before embedding (e.g., `"Key Findings > Attention Mechanism\n\nOriginal chunk text..."`)
4. **Code block integrity:** Don't split inside fenced code blocks (```)

## Embedding Model

- **Model:** `qwen/qwen3-embedding-4b` via OpenRouter API
- **API:** OpenAI-compatible embeddings endpoint at `https://openrouter.ai/api/v1/embeddings`
- **Dimensions:** 1024 (Matryoshka-truncated from native 2560 via `dimensions` parameter)
- **Authentication:** Uses the user's existing `openrouter_api_key` from app settings
- **Pooling:** Handled server-side by OpenRouter. No client-side pooling needed.
- **Instruction prefix:** Qwen3 benefits from query-side instructions. Use `"Represent this sentence for searching relevant passages: "` prefix on queries, no prefix on documents
- **Batching:** OpenRouter supports batch embedding (multiple inputs per request). Batch chunks during indexing for efficiency.
- **Cost:** OpenRouter embedding API is typically very cheap (~$0.01/1M tokens). For a research library with 10K chunks at ~500 tokens each, full indexing costs ~$0.05.

## Reranker

- **Model:** `cohere/rerank-4-pro` via OpenRouter API (free tier)
- **API:** Cohere reranking endpoint via OpenRouter
- **Role:** Re-scores top ~15 MMR-deduplicated candidates after RRF fusion
- **Output:** Top 5-8 final results
- **Cost:** Free on OpenRouter
- **Input:** Query + array of document texts. Returns relevance scores.

## Search Pipeline

### Step 1: Embed Query

Rust calls the OpenRouter embeddings API with the raw query string (with instruction prefix). Produces a 1024-dim float vector. Uses the user's existing `openrouter_api_key`.

### Step 2: Parallel Retrieval

Both searches run on the same SQLite connection (WAL mode for concurrent reads):

**Vector search (KNN):**
```sql
SELECT rowid, distance
FROM chunk_embeddings
WHERE embedding MATCH ?
ORDER BY distance
LIMIT 50
```

**FTS5 keyword search (BM25):**
```sql
SELECT rowid, rank
FROM chunks_fts
WHERE chunks_fts MATCH ?
ORDER BY rank
LIMIT 50
```

**FTS5 query sanitization:** Raw user/agent queries can contain FTS5 operators (`AND`, `OR`, `NOT`, `(`, `)`, `"`, `*`) that will cause parse errors or unintended logic. Sanitize the query before passing to `MATCH` by wrapping the entire query in double-quotes: `format!("\"{}\"", query.replace('"', "\"\""))`. This treats the input as a single phrase query, disabling all operator interpretation.

### Step 3: Adaptive Reciprocal Rank Fusion (RRF)

Standard RRF with `k = 60`:

```
score(chunk) = 1/(60 + rank_vec(chunk)) + 1/(60 + rank_fts(chunk))
```

Future enhancement: adaptive IDF weighting per vstash's paper (per-query weights based on mean IDF of query terms — rare terms boost keyword weight, common terms boost vector weight).

### Step 4: Post-Filter

If folder scope requested, join with `chunks` table to get `folder_id` and filter out non-matching results. Applied after KNN since vec0 doesn't support filtered search.

### Step 5: MMR Dedup

Maximal Marginal Relevance to ensure result diversity:
- For each candidate, check cosine similarity to already-selected results
- Skip candidates that are too similar (>0.85 cosine) to already-selected results
- Reduces from ~50 fused results to ~15 diverse candidates

### Step 6: Cohere Rerank via OpenRouter

Re-score ~15 candidates using `cohere/rerank-4-pro` via OpenRouter API:
- Input: query + array of chunk contents
- Output: relevance scores per document
- Sort by score, return top 5-8
- Free on OpenRouter

### Step 7: Context Expansion

Include adjacent chunks (+/-1 by chunk_index within same file) for richer context. Optional, controlled by parameter.

## Indexing Flow

### On File Save (by AI agent)

1. Agent calls `save_research_file` tool (existing flow, unchanged)
2. After write, frontend calls `invoke("index_research_file", { folder, filename, content })`
3. Rust:
   - Chunk the file content
   - Compute content hash per chunk, compare with stored hashes
   - Skip unchanged chunks (no re-embedding needed)
   - Batch embed new/changed chunks via OpenRouter API
   - Insert/update `chunks` table (ON CONFLICT DO UPDATE)
   - Insert/update `chunk_embeddings` (delete old vectors for replaced chunks, insert new)
   - FTS5 content-sync handles text index updates automatically

### On Session Start

4. `generateResearchFolder()` (existing) creates folder and README.md
5. Also calls `invoke("register_research_folder", { name, query })` to insert into `research_folders` table

### On App Start (Backfill)

6. Scan `AppData/search-results/` for folders/files not yet in the database
7. Queue them for indexing in background
8. Show progress indicator during backfill

## Rust Module Structure

```
src-tauri/src/
├── lib.rs                        # Modified: add DB state, register commands
├── main.rs                       # Unchanged
└── research_search/
    ├── mod.rs                    # Module root, Database struct, init
    ├── schema.rs                 # CREATE TABLE/FTS5/vec0 SQL
    ├── chunking.rs               # Markdown-aware text splitter
    ├── embeddings.rs             # OpenRouter embedding API client
    ├── reranker.rs               # OpenRouter Cohere rerank API client
    ├── search.rs                 # KNN + FTS5 + RRF + MMR pipeline
    └── indexing.rs               # File indexing orchestration
```

## Tauri Commands

All commands are synchronous (`fn`, not `async fn`). Tauri runs them on a dedicated thread pool, avoiding Mutex-across-await issues. The exception is embedding calls to OpenRouter, which are blocking HTTP requests made via `tauri-plugin-http`'s `reqwest` client.

```rust
#[tauri::command]
fn register_research_folder(name: String, query: String) -> Result<i64, String>;

#[tauri::command]
fn index_research_file(api_key: String, folder: String, filename: String, content: String) -> Result<(), String>;

#[tauri::command]
fn search_research(api_key: String, query: String, folder: Option<String>, limit: Option<u32>) -> Result<Vec<SearchResult>, String>;

#[tauri::command]
fn list_research_folders() -> Result<Vec<ResearchFolder>, String>;

#[tauri::command]
fn backfill_index(api_key: String) -> Result<(), String>;
```

**Return types:**

```rust
#[derive(Serialize, Deserialize)]
struct SearchResult {
    chunk_id: i64,
    content: String,
    filename: String,
    folder_name: String,
    header_path: Option<String>,
    score: f64,
    adjacent_chunks: Option<Vec<AdjacentChunk>>,
}

#[derive(Serialize, Deserialize)]
struct AdjacentChunk {
    chunk_index: i32,
    content: String,
}

#[derive(Serialize, Deserialize)]
struct ResearchFolder {
    id: i64,
    name: String,
    query: Option<String>,
    created_at: String,
    chunk_count: i64,
}
```

## State Management

```rust
struct ResearchState {
    db: Mutex<rusqlite::Connection>,
}
```

- `db`: Mutex-wrapped SQLite connection. Locked only during actual SQL operations.
- No local model state. Both embedding and reranking are API calls to OpenRouter.
- The `api_key` is passed per-command from TypeScript (already available in settings).

## TypeScript Integration

### Agent Tool

New tool `search_research` registered in `createTools()`:

```typescript
// src/tools/search-research-tool.ts
export function createSearchResearchTool() {
  return tool({
    description: "Search across all past research sessions for relevant information. Use this to find facts, sources, and notes from previous research.",
    inputSchema: zodSchema(z.object({
      query: z.string().describe("Natural language search query"),
      folder: z.string().optional().describe("Limit to a specific research folder"),
      limit: z.number().optional().describe("Max results (default 8)"),
    })),
    execute: async ({ query, folder, limit }) => {
      return invoke("search_research", { query, folder, limit: limit ?? 8 });
    },
  });
}
```

### UI Research Browser

A new tab/panel in the existing `TabPanel` for browsing and searching past research:

- Search bar at top
- Results list below: folder name, filename, header path, highlighted snippet
- Click result to expand with adjacent context
- Filter by folder dropdown

### Library Wrapper

```typescript
// src/lib/research-search.ts
export async function searchResearch(query: string, options?: { folder?: string; limit?: number }) {
  return invoke<SearchResult[]>("search_research", { query, ...options });
}

export async function indexResearchFile(folder: string, filename: string, content: string) {
  return invoke("index_research_file", { folder, filename, content });
}

export async function listResearchFolders() {
  return invoke<ResearchFolder[]>("list_research_folders");
}
```

## Rust Dependencies (Cargo.toml additions)

```toml
[dependencies]
rusqlite = { version = "0.31", features = ["bundled"] }
sqlite-vec = "0.1"
sha2 = "0.10"
serde_json = "1"                                       # parsing API responses
```

## File Size Estimates

| Component | Size | Notes |
|-----------|------|-------|
| research.db (1K chunks) | ~10 MB | 1000 chunks x 1024 floats x 4 bytes + metadata |
| research.db (10K chunks) | ~60 MB | Scales linearly |

No local model files. Embedding and reranking use OpenRouter API.

## Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Query embedding (OpenRouter) | <500ms | API round-trip |
| KNN + FTS5 retrieval | <10ms | SQLite WAL mode, parallel queries |
| RRF + MMR fusion | <5ms | In-memory rank merge |
| Cohere rerank (OpenRouter, 15 candidates) | <500ms | API round-trip |
| Full search pipeline | <1.5s | Two API calls + local retrieval |
| File indexing (per file) | <3s | Chunking + batch embed API + insert |
| Backfill (100 files) | <10min | Background, non-blocking |

## Future Enhancements

- **Adaptive IDF RRF weighting** — per-query weights based on query term IDF
- **Matryoshka dimension tuning** — test if 512 dims suffice vs 1024 for storage savings
- **Query cache** — LRU cache for repeated queries (vstash reports 700x speedup on cache hits)
- **Incremental FTS reindex** — only update changed chunks in FTS5 index
