# Chat History Search

The sidebar and the AI agent search saved chat history locally. No provider key or hosted search service is required.

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

The tool accepts one query or an array of queries. It returns exact chat matches with `folder_name`, `chat_id`, `title`, `matched_query`, `updated_at`, and `score`. The active chat is excluded when its identity is known; other chats in the same folder remain searchable.

## Indexing and embeddings

- Orama provides English BM25 keyword search, stemming, typo tolerance, filtering, and hybrid keyword/vector retrieval.
- `Xenova/all-MiniLM-L6-v2` provides 384-dimensional embeddings through Transformers.js and ONNX Runtime Web.
- The embedding model is revision-pinned, quantized to q8 (about 23 MB), downloaded on the first semantic search, and cached by the webview for later offline use.
- Inference runs single-threaded in a Web Worker so it does not block the UI and does not require `SharedArrayBuffer`.
- Chat records remain authoritative. The in-memory Orama index is rebuilt from saved chats; record embeddings are cached in the Tauri store and reused when their text is unchanged.
- If the model cannot load or run, `search_research` falls back to keyword results.
