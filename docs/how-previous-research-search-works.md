# How Previous Research Search Works

The Previous Research Search feature lets users search their saved research folders. When the user asks the AI a question, the app checks whether any previously researched folders contain relevant answers, avoiding redundant web searches.

---

## Architecture Overview

```
User Query
    │
    ▼
Tauri Command: search_research()
    │  Delegates to search_multi() / sync_folders_from_dir()
    │
    ├─ Optional: search_research_with_diagnostics()
    │
    ▼
search.rs ─── search_multi() → search() → search_inner()
    │               │               │
    │    ┌──────────┼───────────────┼──────────────────┐
    │    │          │               │                  │
    ▼    ▼          ▼               ▼                  ▼
embedding   │  QueryType        KNN + FTS          HyPE
 (query)    │  Classification   (vec0 + FTS5)   (if indexed)
            │       │               │                  │
            │  adaptive_rrf()      │                  │
            │  (weighted fusion)   │                  │
            │       │               │                  │
            │       └───────┬───────┘                  │
            │               ▼                          │
            │         RRF Fused List                   │
            │               │                          │
            │          MMR Dedup                       │
            │               │                          │
            │       Reranker (cohere/rerank)            │
            │       / Cached scores / Default            │
            │               │                          │
            │       ┌───────┴────────┐                 │
            │       │                │                 │
            │   Has results?    No results?             │
            │       │            (fallback)             │
            │   chunk_results   metadata_search         │
            │       │            (IDF-weighted)         │
            │       │                │                  │
            │       └───────┬────────┘                  │
            │               ▼                          │
            │       Chunk results OR                   │
            │       strict metadata fallback           │
            │               │                          │
            │       Final Results                      │
            │       (sorted, truncated,                 │
            │        with FTS5 snippets)                │
```

---

## Database Schema

The search uses a SQLite database with `sqlite-vec` (vector similarity) and FTS5 (full-text search).

### Tables

| Table | Purpose |
|-------|---------|
| `research_folders` | Folder metadata: `id`, `name`, `original_query` |
| `chunks` | Content chunks: `id`, `folder_id`, `filename`, `header_path`, `chunk_index`, `content`, `content_hash` |
| `chunk_embeddings` | Vector embeddings (virtual table via `sqlite-vec vec0`) — `rowid` references `chunks.id` |
| `chunks_fts` | Full-text search index (virtual table via FTS5) — mirrors `chunks.content` |
| `hype_questions` | Generated "questions this chunk answers" for HyPE search |
| `hype_embeddings` | Vector embeddings for HyPE questions (via `sqlite-vec vec0`) |

### Key SQL Constants

- `KNN_SEARCH`: `SELECT rowid, distance FROM chunk_embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT 30`
- `FTS_SEARCH`: `SELECT rowid, rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT 30`
- `HYPE_KNN_SEARCH`: Finds chunks via HyPE question embeddings, grouped by chunk with `MIN(distance)`

### Triggers

FTS5 triggers keep `chunks_fts` in sync with `chunks` table on INSERT/UPDATE/DELETE.

---

## Indexing Pipeline

Files are indexed via `index_file_inner()` (in `indexing.rs`).

### Step 1: Markdown Chunking (`chunking.rs`)

Uses `pulldown-cmark` to parse Markdown into sections by headers (h2, h3). Sections are assembled into chunks of approximately 512 tokens (~1536 characters) with 20% overlap.

Key constants:
- `DEFAULT_CHUNK_TOKENS: 512`
- `OVERLAP_RATIO: 0.20`
- `MIN_CHARS_PER_TOKEN: 3`

### Step 2: Folder Metadata Prepending

Each chunk's content gets a folder-identity prefix prepended:

```
[From: 'folder-name']

<original chunk content>
```

This ensures the embedding and full-text search are aware of which folder the chunk belongs to.

### Step 3: Content Hashing

Each chunk is SHA-256 hashed (64-char hex string). Hashes are stored in `chunks.content_hash` and used for:
- Detecting whether a chunk changed between indexing runs (skip re-embedding)
- Looking up cached embeddings during benchmark runs

### Step 4: Embedding

Chunk content is embedded via the configured embedding model (default: `qwen/qwen3-embedding-4b`, 1024 dimensions). Embeddings are stored in the `chunk_embeddings` virtual table referenced by `chunks.id`.

The embedding uses a query prefix: `"Represent this sentence for searching relevant passages: "`.

### Step 5: FTS5 Indexing

FTS5 triggers automatically index chunk content as rows are inserted/updated.

### Step 6: HyPE Support (`hype.rs`)

The schema and search path support HyPE questions via `hype_questions` and `hype_embeddings`, but default indexing and benchmark refresh do **not** currently call `generate_hype_for_folder()`. In normal production and benchmark runs, HyPE contributes only if those tables were populated separately.

When enabled, HyPE calls an LLM (default: `openai/gpt-4o-mini` via OpenRouter) to generate up to 3 "questions this chunk answers", embeds those questions, and searches them alongside normal chunk embeddings.

---

## Search Pipeline (`search_inner()` in `search.rs`)

### Step 1: Embedding

The user query is embedded using the same model and query prefix as document chunking.

### Step 2: Query Type Classification

`classify_query()` categorizes queries into three types:

| Type | Detection | vec_weight | fts_weight |
|------|-----------|-----------|------------|
| **ExactPhrase** | Wrapped in double quotes (`"..."`) | 0.0 | 2.0 |
| **Conceptual** | >5 words, or contains `?`, `what`, `how`, `explain`, `describe`, `compare`, `difference`, `tradeoff` | 1.3 | 0.7 |
| **Keyword** | Everything else | 0.7 | 1.3 |

ExactPhrase queries skip vector search entirely and use FTS5 phrase matching.

### Step 3: KNN Vector Search

The query embedding is matched against `chunk_embeddings` via `sqlite-vec` cosine distance. Returns up to 30 candidates.

HyPE results (if any questions matched) are merged into the vector results (deduplicated by chunk_id).

### Step 4: FTS Full-Text Search

The query is tokenized and converted to an FTS5 boolean query: individual terms joined with `OR`. Example:
```
"hammock" OR "size" OR "11ft" OR "12ft" OR "tall" OR "person"
```

For ExactPhrase queries, the entire phrase is used as a quoted FTS5 match:
```
"health impact of sleeping"
```

Returns up to 30 candidates ranked by FTS5 relevance.

### Step 5: RRF Fusion (Reciprocal Rank Fusion)

`adaptive_rrf()` merges KNN and FTS results using weighted Reciprocal Rank Fusion:

```
RRF_score(chunk_id) = Σ weight / (RRF_K + rank + 1)
```

Where `RRF_K = 20.0` and weights come from query type classification.

This produces a single fused ranking that balances semantic similarity and keyword matching.

### Step 6: Folder Filtering (optional)

If a specific folder is targeted, results from other folders are removed.

### Step 7: MMR Dedup (Maximal Marginal Relevance)

`mmr_dedup()` removes near-duplicate chunks (cosine similarity > 0.85) to increase result diversity. Only the first occurrence of each semantically similar cluster is kept.

### Step 8: Reranker

The top 15 diverse candidates are rescored by a reranker model (default: `cohere/rerank-4-pro`). The reranker considers the full query text against each chunk's content for a more precise relevance assessment.

Reranker score priority order:
1. **Cached scores** — benchmark-provided precomputed scores
2. **Production config** — live API call with user's reranker config
3. **Default config** — fallback using empty/default config

Results are filtered by a strong minimum score threshold of **0.55**.

There is one retrieval-aware exception: if FTS produced candidates, a candidate in the top 2 pre-rerank retrieval positions may pass with score >= **0.25**. This keeps strong lexical+vector candidates from being dropped by an overly conservative reranker while preventing vector-only gibberish matches.

### Step 9: Metadata Search Fallback

**If the reranker returns no results**, the system falls back to `folder_metadata_search()` in **strict mode**. This searches folder names and saved original queries for term overlap.

Strict mode removes common metadata stopwords (`best`, `for`, `what`, `the`, etc.) and then uses **IDF (Inverse Document Frequency) scoring**. Each remaining query term is weighted by how rarely it appears across all folder names and original queries:

```
IDF(term) = ln(1 + total_folders / (1 + document_frequency))
matched_idf = sum of IDFs for terms that match this folder
total_idf   = sum of IDFs for all query terms
ratio       = matched_idf / total_idf
```

Folders must exceed `MIN_METADATA_OVERLAP_RATIO` (0.25) to be included. This ensures a single common word (like "best") cannot trigger a match by itself.

### Step 10: Result Selection

If chunk results exist, the system returns those chunk results sorted by reranker score and truncated to the requested limit. It does not append lenient metadata matches. This avoids broad folder-name matches polluting otherwise precise chunk results.

If no chunk results pass the reranker policy, the strict metadata fallback results are returned instead.

### Step 11: FTS5 Snippets

For each returned chunk, `get_fts_snippet()` uses FTS5's `snippet()` function to extract relevant text excerpts with `<mark>` highlighting around matching terms. Snippets are truncated to 200 characters.

### Step 12: Result Assembly

Results are:
1. Sorted by score (descending)
2. Truncated to the requested limit (default: 8)
3. Each result includes: `chunk_id`, `content`, `filename`, `folder_name`, `header_path`, `score`, `adjacent_chunks`, `snippet`

---

## Benchmark System

### Fixture Corpus (`benchmarks/research-search/fixtures/corpus.json`)

A hand-authored test corpus with:
- **8 folders**: hammock-sleep-health, hammock-sizing-guide, hammock-camping-gear, sleep-optimization, standing-desk-ergonomics, ergonomic-chair-buying-guide, coffee-brewing-methods, protein-intake-muscle
- **14 queries**: exact matches, paraphrased queries, metadata-only matches, distractors, no-match queries, multi-relevant queries, sparse content, cross-domain queries
- Each query specifies `expected_relevant` and `expected_irrelevant` folder lists

### Generated Real-History Corpus

`scripts/generate-research-search-corpus.mjs` builds a larger local benchmark from `~/projects/researches/data`.

The generated files are ignored by git because they contain private local research data:

- `benchmarks/research-search/fixtures/real-corpus.json`
- `benchmarks/research-search/fixtures/real-provider-cache.json`
- `benchmarks/research-search/results-real/`

Default generation:

- Selects up to 40 folders with `metadata.json` descriptions and content files
- Excludes `raw/`, `metadata.json`, and `AGENTS.md`
- Includes a synthetic `folder-metadata.md` per folder so folder descriptions and related links are searchable
- Copies up to 4 source files per folder, capped at 16,000 characters per file
- Generates description queries, narrow related-folder queries from `metadata.related`, and fixed no-match queries
- Uses metadata descriptions as deterministic labels rather than asking an LLM to judge correctness

Related links are treated as an undirected graph for benchmark labeling. If folder A lists folder B, both directions are considered related, and neither folder can become the other's expected-irrelevant hard negative. Related-query cases include one neighboring folder at a time so the pass/fail condition checks a concrete pair instead of requiring every broad neighboring topic to rank in the top 3.

Generated hard negatives are intentionally conservative: they must have meaningful lexical overlap with the source query, and any 1-hop related folder for the expected-relevant set is excluded. This keeps `expected_irrelevant` focused on true distractors rather than adjacent research that the search should reasonably surface.

The real-history corpus is intended to be generated once and then treated as a frozen benchmark snapshot. The generator refuses to overwrite an existing `real-corpus.json` unless `--force` is passed. If the frozen snapshot is intentionally regenerated, its content-based `version` changes and the old provider cache is invalidated.

### Provider Cache (`benchmarks/research-search/fixtures/provider-cache.json`)

Pre-computed embeddings and reranker scores to enable fast offline benchmarks without repeated API calls. Contains:
- `meta`: corpus version, model names, dimensions
- `document_embeddings`: chunk-hash → embedding vector (SHA-256 hex keys, 1024-dim values)
- `query_embeddings`: query-hash → embedding vector
- `reranker_scores`: query-hash → `{ index, chunk_hash, score }[]`

Each cached reranker score is bound to the candidate chunk's SHA-256 hash. If the current candidate list no longer matches the cache, the benchmark fails with a refresh error instead of applying scores to the wrong chunks.

Generated via `npm run benchmark:research-search:refresh` (requires `OPENROUTER_API_KEY` in `.env`).

Legacy tuple caches can be migrated without provider calls with:

```bash
cargo run --manifest-path src-tauri/Cargo.toml --bin research-search-benchmark -- --migrate-legacy-cache
```

Migration reuses existing provider scores and attaches current candidate hashes; a full refresh is still the source of truth after meaningful candidate-generation changes.

### Benchmark Binary (`src-tauri/src/bin/research-search-benchmark.rs`)

1. Loads `corpus.json` and `provider-cache.json` (or custom `--corpus`, `--cache`, and `--report-dir` paths)
2. Validates cache metadata against corpus (version, model, dimensions, chunking version)
3. Creates an in-memory database via `init_database_memory()`
4. Indexes fixture files through `index_file_inner()` with cached embeddings
5. Uses the same `collect_rerank_candidates()` path as production when refreshing cached reranker scores
6. Runs each query through `search_inner()` with cached embeddings and hash-bound reranker scores
7. Scores each query at the **folder level**

Refresh batches document and query embeddings across the whole corpus. This keeps generated real-history benchmark refreshes to the provider's batch limit instead of one embedding request per file/query.

### Scoring Metrics

| Metric | Description |
|--------|-------------|
| **Recall@1** | Fraction of expected folders appearing in top 1 result |
| **Recall@3** | Fraction of expected folders appearing in top 3 results |
| **Recall@5** | Fraction of expected folders appearing in top 5 results |
| **MRR** | Mean Reciprocal Rank: 1 / rank_of_first_expected |
| **rank-of-first-expected** | Position (1-based) of the first expected folder |
| **irrelevant_appeared** | Expected-irrelevant folders that appeared in results |
| **irrelevant_appeared_top_3** | Expected-irrelevant folders appearing in the top 3 unique returned folders |
| **no_match_correct** | For no-match queries: true if zero results returned |
| **best_score_per_folder** | Highest score per returned folder |
| **chunks_per_folder** | Number of chunks returned per folder |

### Pass Criteria

| Query type | Pass condition |
|-----------|---------------|
| Single relevant folder | `recall@1 >= 1.0` (expected folder must be top result) |
| Multiple relevant folders | `recall@3 >= 1.0` (all expected folders found in top 3) |
| No-match query | Zero results returned |

All query types also fail if search produced an error or if any expected-irrelevant folder appears in the top 3 unique returned folders.

### Outputs

- `benchmarks/research-search/results/report.json` — machine-readable
- `benchmarks/research-search/results/report.md` — human-readable, per-query diagnostics

### npm Scripts

```bash
npm run benchmark:research-search         # Run with existing cache
npm run benchmark:research-search:refresh  # Regenerate cache + run
npm run benchmark:research-search:validate-chunking # Offline chunker preflight for the synthetic corpus
npm run benchmark:research-search:real:generate  # Generate ignored real-corpus.json from local research data
npm run benchmark:research-search:real:regenerate # Force a new frozen real-corpus snapshot
npm run benchmark:research-search:real:validate-chunking # Offline chunker preflight for the real corpus
npm run benchmark:research-search:real:refresh   # Generate real-provider-cache.json with OpenRouter, then run
npm run benchmark:research-search:real           # Run real corpus with existing real-provider-cache.json
```

`benchmark:research-search:real:refresh` sends generated real-corpus content and benchmark queries to OpenRouter for embeddings and reranker scores. Run it only after explicitly approving that external transfer of local research data.

### Diagnostics

Each query returns `SearchDiagnostics` with stage-level counts and latencies:

```json
{
  "query": "...",
  "knn_candidate_count": 10,
  "fts_candidate_count": 7,
  "fused_candidate_count": 10,
  "mmr_candidate_count": 10,
  "reranked_candidate_count": 2,
  "metadata_match_count": 4,
  "final_result_count": 6,
  "reranker_threshold": 0.55,
  "latency_stage_ms": {
    "total_ms": 3,
    "embedding_ms": 0,
    "knn_ms": 0,
    "fts_ms": 0,
    "rrf_ms": 0,
    "mmr_ms": 0,
    "reranker_ms": 0,
    "metadata_ms": 0
  }
}
```

---

## Key Design Decisions

### Chunk Overlap
Chunks overlap by 20% to prevent information loss at chunk boundaries. Overlap content is taken from the tail of the previous chunk, preserving context.

### RRF Over Simple Concat
Reciprocal Rank Fusion was chosen over concatenating KNN + FTS results because it naturally handles the different score distributions of vector distance and FTS rank, producing a balanced merged ranking.

### MMR for Diversity
Without MMR deduplication, multiple chunks from the same folder with similar content would crowd out results from other folders. The 0.85 cosine similarity threshold prevents this.

### Reranker as Signal Booster
The embedding-based search is fast but imprecise. The reranker adds a second-pass precision boost by evaluating full query-to-chunk relevance, filtering out semantically close but contextually wrong matches.

The reranker policy uses a strong threshold of 0.55 plus a guarded fallback for top-2 retrieval candidates with score >= 0.25 when FTS also found lexical matches. This avoids two failure modes seen in the fixture corpus: marginal lower-ranked distractors passing, and genuinely relevant top retrieval candidates being pruned too aggressively.

### Metadata Fallback with IDF
When no chunks pass the reranker policy, the system falls back to folder metadata matching. IDF weights ensure that only genuinely relevant folder names or original queries trigger matches, not incidental word overlaps. The ratio threshold (0.25) requires a meaningful fraction of query terms to match.

### In-Memory Database for Benchmarks
The benchmark uses `init_database_memory()` (SQLite in-memory) for isolation and speed. The production system uses `init_database()` (on-disk SQLite at the app data directory).
