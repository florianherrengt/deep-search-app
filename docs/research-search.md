# Research Recall and Memories

The sidebar and the AI agent search saved research locally. No provider key or hosted search service is required.

## Sidebar search

Typing in **Search chat history** runs a debounced keyword search over:

- Chat titles
- User-authored messages
- Completed answers to `ask_questions`

Assistant responses and generated research files are deliberately excluded. Each result identifies one exact chat and opens that chat, including results stored in another research folder.

## `search_research` tool

```text
search_research({ query: "how do transformers handle long context", limit: 8 })
```

The tool accepts one query or an array of queries. It searches two separately filtered record types:

- `research_chat` results identify exact prior chats with `folder_name`, `chat_id`, `title`, `matched_query`, `updated_at`, and `score`. These can justify asking whether to continue another research folder.
- `memory` results identify relevant facts retrieved from per-folder `memories.md` files, with `source_folder`, `updated_at`, and relevance `score`. Memory-only results are used silently when useful and never trigger a folder-switch question. The guardrail and answer handler require a matching `research_chat` result; the direct switch tool additionally requires the user to have explicitly selected the offered continuation.

When a matching chat and memory come from the same folder, the facts are attached to the chat as `relevant_memories`. All records from the active research folder are excluded from this cross-folder search because active-folder context is supplied directly.

## Active-folder continuity

Before each model turn, the app loads a bounded context snapshot for the active folder:

- folder name and direct file list;
- `summary.md`, falling back to `README.md`, the latest chat title, or the folder name for the topic;
- parsed facts from `memories.md`.

This snapshot is injected inside an explicit untrusted-data boundary, not as instructions. Boundary characters are escaped, and topic, filename, per-memory, and aggregate memory budgets keep it below the prompt allowance. These recall bounds never truncate or delete the source `memories.md`. The current user message always overrides stored context and memories. The generic file tools remain available when the agent needs full file contents.

Memory extraction is best-effort. A provider, parse, read, or write failure is reported through the memory sub-agent but does not stop the main research response. Failed candidates are retried at most three times; queue size and work per turn are bounded, and oversized inputs are preserved without sending an unsafe extraction prompt. Extraction and folder merges share per-folder locks so concurrent transports cannot overwrite each other's facts. Canonical lists are deduplicated, while legacy metadata and unparseable manual content survive both merges and normal extraction rewrites.

The chat transcript persists whether its folder is still provisional, so a remounted or restarted transport can finish the same continuation safely. Before continuing an earlier folder, the destination is revalidated under the research-history lock. The provisional memories are then merged while locked; recursive cleanup happens only if the source has no other chats, research files, or subfolders. A failed merge/check or any remaining data retains the source folder rather than risking loss.

## Indexing and embeddings

- Orama provides English BM25 keyword search, stemming, typo tolerance, filtering, and hybrid keyword/vector retrieval.
- `Xenova/all-MiniLM-L6-v2` provides 384-dimensional embeddings through Transformers.js and ONNX Runtime Web.
- The embedding model is revision-pinned, quantized to q8 (about 23 MB), downloaded on the first semantic search, and cached by the webview for later offline use.
- Inference runs single-threaded in a Web Worker so it does not block the UI and does not require `SharedArrayBuffer`.
- Saved chats and parsed `memories.md` facts remain authoritative. The in-memory Orama index is rebuilt from disk; record embeddings are cached in the Tauri store and reused when their text is unchanged. Memory cache IDs use stable SHA-256 digests, so reordering facts does not recompute unchanged embeddings and fact text is not duplicated in cache keys. Removed records are pruned on rebuild.
- Sidebar searches filter the shared index to chat records, so memory facts never appear as clickable chat results.
- If the model cannot load or run, `search_research` falls back to keyword results.
