import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

interface CacheMeta {
  corpus_version: string;
  embedding_model: string;
  embedding_dimensions: number;
  reranker_model: string;
  chunking_version: number;
  indexing_version: number;
  query_prefix: string;
  provider: string;
  created_at: string | null;
  description: string | null;
}

interface ProviderCache {
  meta: CacheMeta;
  document_embeddings: Record<string, number[]>;
  query_embeddings: Record<string, number[]>;
  reranker_scores: Record<string, [number, number][]>;
}

function loadProviderCache(): ProviderCache {
  const path = resolve(__dirname, "..", "fixtures", "provider-cache.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw);
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

interface CorpusFolder {
  name: string;
  files: Record<string, string>;
}

interface CorpusQuery {
  query: string;
}

interface Corpus {
  version: string;
  embedding_model: string;
  embedding_dimensions: number;
  reranker_model: string;
  chunking_version: number;
  indexing_version: number;
  folders: CorpusFolder[];
  queries: CorpusQuery[];
}

function loadCorpus(): Corpus {
  const path = resolve(__dirname, "..", "fixtures", "corpus.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("Provider cache", () => {
  it("exists as a valid JSON file", () => {
    const path = resolve(__dirname, "..", "fixtures", "provider-cache.json");
    expect(existsSync(path)).toBe(true);
    const cache = loadProviderCache();
    expect(cache.meta).toBeDefined();
  });

  it("has required meta fields", () => {
    const cache = loadProviderCache();
    expect(cache.meta.corpus_version).toBe("1.0.0");
    expect(cache.meta.embedding_model).toBe("qwen/qwen3-embedding-4b");
    expect(cache.meta.embedding_dimensions).toBe(1024);
    expect(cache.meta.reranker_model).toBe("cohere/rerank-4-pro");
  });

  it("cache meta version matches corpus version", () => {
    const corpus = loadCorpus();
    const cache = loadProviderCache();
    expect(cache.meta.corpus_version).toBe(corpus.version);
  });

  it("cache meta embedding model matches corpus", () => {
    const corpus = loadCorpus();
    const cache = loadProviderCache();
    expect(cache.meta.embedding_model).toBe(corpus.embedding_model);
  });

  it("cache meta dimensions matches corpus", () => {
    const corpus = loadCorpus();
    const cache = loadProviderCache();
    expect(cache.meta.embedding_dimensions).toBe(corpus.embedding_dimensions);
  });

  it("cache meta chunking version matches corpus", () => {
    const corpus = loadCorpus();
    const cache = loadProviderCache();
    expect(cache.meta.chunking_version).toBe(corpus.chunking_version);
  });

  it("document_embeddings are keyed by SHA-256 content hash", () => {
    const cache = loadProviderCache();
    for (const key of Object.keys(cache.document_embeddings)) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("query_embeddings are keyed by SHA-256 query hash", () => {
    const cache = loadProviderCache();
    for (const key of Object.keys(cache.query_embeddings)) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("embedding arrays have correct dimensions", () => {
    const cache = loadProviderCache();
    const dims = cache.meta.embedding_dimensions;
    for (const emb of Object.values(cache.document_embeddings)) {
      if (emb.length > 0) {
        expect(emb.length).toBe(dims);
      }
    }
    for (const emb of Object.values(cache.query_embeddings)) {
      if (emb.length > 0) {
        expect(emb.length).toBe(dims);
      }
    }
  });

  it("hash function matches expected format", () => {
    const h = hashContent("hello world");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    );
  });

  it("same content produces same hash", () => {
    const h1 = hashContent("test content");
    const h2 = hashContent("test content");
    expect(h1).toBe(h2);
  });

  it("different content produces different hash", () => {
    const h1 = hashContent("content A");
    const h2 = hashContent("content B");
    expect(h1).not.toBe(h2);
  });
});

describe("Cache invalidation", () => {
  it("detects version mismatch", () => {
    const corpus = loadCorpus();
    const cache = loadProviderCache();
    const versionsMatch = cache.meta.corpus_version === corpus.version;
    expect(versionsMatch).toBe(true);
  });

  it("detects model mismatch", () => {
    const corpus = loadCorpus();
    const cache = loadProviderCache();
    const modelsMatch = cache.meta.embedding_model === corpus.embedding_model;
    expect(modelsMatch).toBe(true);
  });

  it("detects dimension mismatch", () => {
    const corpus = loadCorpus();
    const cache = loadProviderCache();
    const dimsMatch =
      cache.meta.embedding_dimensions === corpus.embedding_dimensions;
    expect(dimsMatch).toBe(true);
  });

  it("detects chunking version mismatch", () => {
    const corpus = loadCorpus();
    const cache = loadProviderCache();
    const chunkingMatch =
      cache.meta.chunking_version === corpus.chunking_version;
    expect(chunkingMatch).toBe(true);
  });
});
