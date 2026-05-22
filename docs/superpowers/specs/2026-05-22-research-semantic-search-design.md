# Research Library Semantic Search

Design spec for adding hybrid semantic search to the Deep Search App's research library.

## Problem

The AI agent saves research findings as files under `AppData/search-results/<folder>/`. Over time, users accumulate a large library of research across many sessions. There is no way to search across this library — neither for the human user nor the AI agent during a session.

## Solution

Build a fully local, offline-capable hybrid search system using:

- **sqlite-vec** for vector similarity search (KNN)
- **SQLite FTS5** for keyword search (BM25)
- **Adaptive Reciprocal Rank Fusion (RRF)** to combine both
- **Cross-encoder reranking** for final result quality
- **ONNX Runtime** (Rust) for embedding and reranker inference

All compute runs natively in the Rust backend. No Python dependency, no API calls, no internet required.

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────────┐
│  TypeScript  │     │                 Rust Backend                  │
│              │     │                                              │
│  UI search   │────>│  search_research(query, folder?, limit?)     │
│  Agent tool  │────>│     │                                        │
│              │     │     ├─► ONNX embed query (Qwen3-4B, 1024d)  │
│              │     │     │                                        │
│              │     │     ├─► vec0 KNN (top 50) ─┐                 │
│              │     │     ├─► FTS5 BM25 (top 50)─┤                 │
│              │     │     │                       │                 │
│              │     │     └─► Adaptive RRF ◄──────┘                │
│              │     │          │                                    │
│              │     │          ├─► Post-filter (folder scope)      │
│              │     │          ├─► MMR dedup (~15 candidates)      │
│              │     │          ├─► Cross-encoder rerank (top 5-8)  │
│              │     │          └─► Context expansion (+/-1 chunks) │
│              │     │               │                               │
│  Results     │<────│               └─► Vec<SearchResult>          │
│  display     │     │                                              │
│              │     │  index_research_file(folder, file, content)  │
│  Index       │────>│     │                                        │
│  trigger     │     │     ├─► Markdown-aware chunking (512 tokens)│
│              │     │     ├─► Content hash check (skip unchanged)  │
│              │     │     ├─► ONNX batch embed chunks              │
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

- **Model:** Qwen3-Embedding-4B (Apache 2.0)
- **ONNX export:** `majentik/Qwen3-Embedding-4B-ONNX-INT8` (dynamic INT8 quantization, ready to use)
- **Native dimensions:** 2560 (Matryoshka-capable)
- **Truncated dimensions:** 1024 (good quality/storage balance, configurable)
- **Model size:** ~3.8 GB (INT8)
- **Inference:** ONNX Runtime via `ort` crate, native Apple Silicon performance (~18K tok/s)
- **Storage:** Model downloaded once to `AppData/models/qwen3-embedding-4b-int8/` and cached
- **Instruction prefix:** Qwen3 benefits from query-side instructions. Use `"Represent this sentence for searching relevant passages: "` prefix on queries, no prefix on documents
- **Note:** The FP32 ONNX export (~16GB) is too large for practical use. The `optimum` CLI doesn't yet support full graph optimisation for Qwen3 (`NotImplementedError`). Use the pre-exported INT8 model from majentik.

## Reranker

- **Model:** ms-marco-MiniLM-L-6-v2 (MIT license)
- **Size:** 22M params, ~90MB
- **Role:** Re-scores top ~15 MMR-deduplicated candidates after RRF fusion
- **Output:** Top 5-8 final results
- **Inference:** ONNX Runtime via `ort` crate
- **Storage:** Model at `AppData/models/ms-marco-MiniLM-L-6-v2/`

## Search Pipeline

### Step 1: Embed Query

Rust runs the Qwen3-Embedding-4B model via ONNX Runtime on the raw query string. Produces a 1024-dim float vector. Query instruction prefix applied.

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

### Step 6: Cross-Encoder Rerank

Re-score ~15 candidates using ms-marco-MiniLM-L-6-v2:
- Input: (query, chunk_content) pairs
- Output: relevance scores
- Sort by score, return top 5-8

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
   - Batch embed new/changed chunks via ONNX Runtime
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
    ├── embeddings.rs             # ONNX model loading + batch inference
    ├── reranker.rs               # Cross-encoder reranking
    ├── search.rs                 # KNN + FTS5 + RRF + MMR pipeline
    └── indexing.rs               # File indexing orchestration
```

## Tauri Commands

All commands are synchronous (`fn`, not `async fn`). Tauri runs them on a dedicated thread pool, avoiding Mutex-across-await issues.

```rust
#[tauri::command]
fn register_research_folder(name: String, query: String) -> Result<i64, String>;

#[tauri::command]
fn index_research_file(folder: String, filename: String, content: String) -> Result<(), String>;

#[tauri::command]
fn search_research(query: String, folder: Option<String>, limit: Option<u32>) -> Result<Vec<SearchResult>, String>;

#[tauri::command]
fn list_research_folders() -> Result<Vec<ResearchFolder>, String>;

#[tauri::command]
fn backfill_index() -> Result<(), String>;
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
    embedding_session: Arc<ort::Session>,   // Send + Sync, no mutex needed
    reranker_session: Arc<ort::Session>,    // Send + Sync, no mutex needed
    tokenizer: Arc<Tokenizer>,              // Send + Sync
}
```

- `db`: Mutex-wrapped SQLite connection. Locked only during actual SQL operations.
- `embedding_session` / `reranker_session`: `Arc`-wrapped ONNX sessions, lock-free for inference.
- Models loaded lazily on first use (avoids slow startup). Show loading indicator in UI.

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
ort = { version = "2", features = ["load-dynamic"] }
tokenizers = "0.21"
sha2 = "0.10"
```

## File Size Estimates

| Component | Size | Notes |
|-----------|------|-------|
| Qwen3-Embedding-4B (INT8) | ~3.8 GB | Downloaded once, cached in AppData |
| ms-marco-MiniLM-L-6-v2 | ~90 MB | Downloaded once, cached in AppData |
| ONNX Runtime library | ~50 MB | Bundled with app |
| research.db (1K chunks) | ~10 MB | 1000 chunks x 1024 floats x 4 bytes + metadata |
| research.db (10K chunks) | ~60 MB | Scales linearly |

## Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Query embedding | <100ms | Single query, ONNX on Apple Silicon |
| KNN + FTS5 retrieval | <10ms | SQLite WAL mode, parallel queries |
| RRF + MMR fusion | <5ms | In-memory rank merge |
| Cross-encoder rerank (15 candidates) | <200ms | MiniLM on CPU |
| Full search pipeline | <350ms | End-to-end, cold query |
| File indexing (per file) | <2s | Chunking + batch embed + insert |
| Backfill (100 files) | <5min | Background, non-blocking |

## Future Enhancements

- **Adaptive IDF RRF weighting** — per-query weights based on query term IDF
- **Self-supervised embedding refinement** — mine disagreement between vector and keyword search to fine-tune embeddings on the user's corpus (vstash approach)
- **Matryoshka dimension tuning** — test if 512 dims suffice vs 1024 for storage savings
- **Query cache** — LRU cache for repeated queries (vstash reports 700x speedup on cache hits)
- **Incremental FTS reindex** — only update changed chunks in FTS5 index
