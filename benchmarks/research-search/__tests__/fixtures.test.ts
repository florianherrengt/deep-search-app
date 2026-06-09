import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface CorpusFolder {
  name: string;
  original_query: string;
  files: Record<string, string>;
}

interface CorpusQuery {
  id: string;
  query: string;
  expected_relevant: string[];
  expected_irrelevant: string[];
  description: string;
}

interface Corpus {
  version: string;
  embedding_model: string;
  embedding_dimensions: number;
  reranker_model: string;
  chunking_version: number;
  indexing_version: number;
  query_prefix: string;
  folders: CorpusFolder[];
  queries: CorpusQuery[];
}

function loadCorpus(): Corpus {
  const path = resolve(__dirname, "..", "fixtures", "corpus.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw);
}

describe("Corpus fixture loading", () => {
  it("loads a valid corpus with version", () => {
    const corpus = loadCorpus();
    expect(corpus.version).toBe("1.0.0");
  });

  it("has the expected number of folders", () => {
    const corpus = loadCorpus();
    expect(corpus.folders.length).toBe(8);
  });

  it("has the expected number of queries", () => {
    const corpus = loadCorpus();
    expect(corpus.queries.length).toBe(14);
  });

  it("all folders have a name and original_query", () => {
    const corpus = loadCorpus();
    for (const folder of corpus.folders) {
      expect(folder.name).toBeTruthy();
      expect(typeof folder.original_query).toBe("string");
    }
  });

  it("all folders have at least one file", () => {
    const corpus = loadCorpus();
    for (const folder of corpus.folders) {
      const filenames = Object.keys(folder.files);
      expect(filenames.length).toBeGreaterThanOrEqual(1);
      for (const name of filenames) {
        expect(typeof folder.files[name]).toBe("string");
        expect(folder.files[name].length).toBeGreaterThan(0);
      }
    }
  });

  it("all queries have an id and query text", () => {
    const corpus = loadCorpus();
    for (const q of corpus.queries) {
      expect(q.id).toBeTruthy();
      expect(q.query).toBeTruthy();
      expect(q.description).toBeTruthy();
    }
  });

  it("has at least one no-match query with empty expected_relevant", () => {
    const corpus = loadCorpus();
    const noMatchQueries = corpus.queries.filter(
      (q) => q.expected_relevant.length === 0
    );
    expect(noMatchQueries.length).toBeGreaterThanOrEqual(1);
  });

  it("has at least one query with multiple expected_relevant folders", () => {
    const corpus = loadCorpus();
    const multiQueries = corpus.queries.filter(
      (q) => q.expected_relevant.length >= 2
    );
    expect(multiQueries.length).toBeGreaterThanOrEqual(1);
  });

  it("has exact match query (q1-exact-match)", () => {
    const corpus = loadCorpus();
    const q1 = corpus.queries.find((q) => q.id === "q1-exact-match");
    expect(q1).toBeDefined();
    expect(q1!.expected_relevant).toContain("hammock-sleep-health");
  });

  it("has paraphrased query (q2-paraphrased)", () => {
    const corpus = loadCorpus();
    const q2 = corpus.queries.find((q) => q.id === "q2-paraphrased");
    expect(q2).toBeDefined();
    expect(q2!.expected_relevant).toContain("hammock-sleep-health");
  });

  it("has metadata-only match query", () => {
    const corpus = loadCorpus();
    const q3 = corpus.queries.find((q) => q.id === "q3-metadata-only");
    expect(q3).toBeDefined();
  });

  it("has distractor query", () => {
    const corpus = loadCorpus();
    const q4 = corpus.queries.find((q) => q.id === "q4-distractor");
    expect(q4).toBeDefined();
    expect(q4!.expected_irrelevant.length).toBeGreaterThan(0);
  });

  it("has gibberish no-match query", () => {
    const corpus = loadCorpus();
    const q12 = corpus.queries.find((q) => q.id === "q12-no-match-gibberish");
    expect(q12).toBeDefined();
    expect(q12!.expected_relevant).toEqual([]);
  });

  it("query expected_relevant folders exist in corpus folders", () => {
    const corpus = loadCorpus();
    const folderNames = new Set(corpus.folders.map((f) => f.name));
    for (const q of corpus.queries) {
      for (const name of q.expected_relevant) {
        expect(folderNames.has(name)).toBe(true);
      }
    }
  });

  it("corpus has embedding config fields", () => {
    const corpus = loadCorpus();
    expect(corpus.embedding_model).toBe("qwen/qwen3-embedding-4b");
    expect(corpus.embedding_dimensions).toBe(1024);
    expect(corpus.reranker_model).toBe("cohere/rerank-4-pro");
  });

  it("includes sparse-content folder with single file", () => {
    const corpus = loadCorpus();
    const sparse = corpus.folders.find(
      (f) => f.name === "hammock-camping-gear"
    );
    expect(sparse).toBeDefined();
    expect(Object.keys(sparse!.files).length).toBe(1);
  });
});
