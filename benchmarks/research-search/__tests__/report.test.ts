import { describe, it, expect } from "vitest";

interface StageLatencies {
  total_ms: number;
  embedding_ms: number;
  knn_ms: number;
  fts_ms: number;
  rrf_ms: number;
  mmr_ms: number;
  reranker_ms: number;
  metadata_ms: number;
}

interface SearchDiagnostics {
  query: string;
  knn_candidate_count: number;
  fts_candidate_count: number;
  fused_candidate_count: number;
  mmr_candidate_count: number;
  reranked_candidate_count: number;
  metadata_match_count: number;
  final_result_count: number;
  reranker_threshold: number;
  latency_stage_ms: StageLatencies;
  error: string | null;
}

interface FolderScore {
  recall_at_1: number;
  recall_at_3: number;
  recall_at_5: number;
  mrr: number;
  rank_of_first_expected: number | null;
  irrelevant_appeared: string[];
  irrelevant_appeared_top_3: string[];
  no_match_correct: boolean;
  best_score_per_folder: Record<string, number>;
  chunks_per_folder: Record<string, number>;
}

interface QueryResult {
  query_id: string;
  query_text: string;
  description: string;
  expected_relevant: string[];
  expected_irrelevant: string[];
  returned_folders: string[];
  returned_scores: number[];
  diagnostics: SearchDiagnostics;
  scoring: FolderScore;
  passed: boolean;
}

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

interface AggregateReport {
  recall_at_1: number;
  recall_at_3: number;
  recall_at_5: number;
  mrr: number;
  total_queries: number;
  passed_queries: number;
  no_match_queries: number;
  no_match_correct: number;
  false_positives: string[];
  false_positives_top_3: string[];
  cache_metadata: CacheMeta;
  query_results: QueryResult[];
}

interface BenchReport {
  timestamp: string;
  aggregate: AggregateReport;
}

function makeDiagnostics(overrides: Partial<SearchDiagnostics> = {}): SearchDiagnostics {
  return {
    query: "test query",
    knn_candidate_count: 50,
    fts_candidate_count: 30,
    fused_candidate_count: 60,
    mmr_candidate_count: 10,
    reranked_candidate_count: 5,
    metadata_match_count: 2,
    final_result_count: 7,
    reranker_threshold: 0.55,
    latency_stage_ms: {
      total_ms: 10,
      embedding_ms: 2,
      knn_ms: 1,
      fts_ms: 1,
      rrf_ms: 1,
      mmr_ms: 1,
      reranker_ms: 3,
      metadata_ms: 1,
    },
    error: null,
    ...overrides,
  };
}

function makeQueryResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    query_id: "test-q",
    query_text: "test query",
    description: "test description",
    expected_relevant: ["folder-a"],
    expected_irrelevant: [],
    returned_folders: ["folder-a"],
    returned_scores: [0.95],
    diagnostics: makeDiagnostics(),
    scoring: {
      recall_at_1: 1.0,
      recall_at_3: 1.0,
      recall_at_5: 1.0,
      mrr: 1.0,
      rank_of_first_expected: 1,
      irrelevant_appeared: [],
      irrelevant_appeared_top_3: [],
      no_match_correct: true,
      best_score_per_folder: { "folder-a": 0.95 },
      chunks_per_folder: { "folder-a": 1 },
    },
    passed: true,
    ...overrides,
  };
}

function computeAggregate(results: QueryResult[], cacheMeta: CacheMeta): AggregateReport {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;

  const recall1Sum = results.reduce((s, r) => s + r.scoring.recall_at_1, 0);
  const recall3Sum = results.reduce((s, r) => s + r.scoring.recall_at_3, 0);
  const recall5Sum = results.reduce((s, r) => s + r.scoring.recall_at_5, 0);
  const mrrSum = results.reduce((s, r) => s + r.scoring.mrr, 0);

  const noMatchQueries = results.filter((r) => r.expected_relevant.length === 0).length;
  const noMatchCorrect = results.filter(
    (r) => r.expected_relevant.length === 0 && r.scoring.no_match_correct
  ).length;

  const falsePositives = results
    .filter((r) => r.scoring.irrelevant_appeared.length > 0)
    .map((r) => `${r.query_id}: ${r.scoring.irrelevant_appeared.join(", ")}`);
  const falsePositivesTop3 = results
    .filter((r) => r.scoring.irrelevant_appeared_top_3.length > 0)
    .map((r) => `${r.query_id}: ${r.scoring.irrelevant_appeared_top_3.join(", ")}`);

  return {
    recall_at_1: total > 0 ? recall1Sum / total : 0,
    recall_at_3: total > 0 ? recall3Sum / total : 0,
    recall_at_5: total > 0 ? recall5Sum / total : 0,
    mrr: total > 0 ? mrrSum / total : 0,
    total_queries: total,
    passed_queries: passed,
    no_match_queries: noMatchQueries,
    no_match_correct: noMatchCorrect,
    false_positives: falsePositives,
    false_positives_top_3: falsePositivesTop3,
    cache_metadata: cacheMeta,
    query_results: results,
  };
}

const defaultCacheMeta: CacheMeta = {
  corpus_version: "1.0.0",
  embedding_model: "qwen/qwen3-embedding-4b",
  embedding_dimensions: 1024,
  reranker_model: "cohere/rerank-4-pro",
  chunking_version: 1,
  indexing_version: 1,
  query_prefix: "Represent this sentence for searching relevant passages: ",
  provider: "openrouter",
  created_at: null,
  description: null,
};

describe("Report generation", () => {
  it("aggregates recall scores correctly for all-pass", () => {
    const results = [
      makeQueryResult({ query_id: "q1", scoring: { ...makeQueryResult().scoring, recall_at_1: 1.0, recall_at_3: 1.0, recall_at_5: 1.0, mrr: 1.0 } }),
      makeQueryResult({ query_id: "q2", scoring: { ...makeQueryResult().scoring, recall_at_1: 0.5, recall_at_3: 1.0, recall_at_5: 1.0, mrr: 0.5 } }),
    ];
    const agg = computeAggregate(results, defaultCacheMeta);
    expect(agg.recall_at_1).toBe(0.75);
    expect(agg.recall_at_3).toBe(1.0);
    expect(agg.recall_at_5).toBe(1.0);
    expect(agg.mrr).toBe(0.75);
  });

  it("counts passed queries correctly", () => {
    const results = [
      makeQueryResult({ query_id: "q1", passed: true }),
      makeQueryResult({ query_id: "q2", passed: false }),
    ];
    const agg = computeAggregate(results, defaultCacheMeta);
    expect(agg.passed_queries).toBe(1);
    expect(agg.total_queries).toBe(2);
  });

  it("counts no-match queries correctly", () => {
    const results = [
      makeQueryResult({ query_id: "q1", expected_relevant: [], expected_irrelevant: [], passed: true }),
      makeQueryResult({ query_id: "q2", expected_relevant: ["x"], expected_irrelevant: [], passed: true }),
    ];
    const agg = computeAggregate(results, defaultCacheMeta);
    expect(agg.no_match_queries).toBe(1);
  });

  it("counts no-match correct when empty results for no-match query", () => {
    const noMatchResult = makeQueryResult({
      query_id: "q-nomatch",
      expected_relevant: [],
      expected_irrelevant: [],
      returned_folders: [],
      returned_scores: [],
      scoring: {
        recall_at_1: 1.0,
        recall_at_3: 1.0,
        recall_at_5: 1.0,
        mrr: 1.0,
        rank_of_first_expected: null,
        irrelevant_appeared: [],
        irrelevant_appeared_top_3: [],
        no_match_correct: true,
        best_score_per_folder: {},
        chunks_per_folder: {},
      },
      passed: true,
    });
    const agg = computeAggregate([noMatchResult], defaultCacheMeta);
    expect(agg.no_match_correct).toBe(1);
  });

  it("detects false positives from irrelevant appeared", () => {
    const results = [
      makeQueryResult({
        query_id: "q1",
        expected_irrelevant: ["bad-folder"],
        scoring: {
          ...makeQueryResult().scoring,
          irrelevant_appeared: ["bad-folder"],
          irrelevant_appeared_top_3: ["bad-folder"],
        },
      }),
    ];
    const agg = computeAggregate(results, defaultCacheMeta);
    expect(agg.false_positives.length).toBe(1);
    expect(agg.false_positives[0]).toContain("bad-folder");
    expect(agg.false_positives_top_3.length).toBe(1);
    expect(agg.false_positives_top_3[0]).toContain("bad-folder");
  });

  it("does not count lower-ranked false positives as top-3 failures", () => {
    const results = [
      makeQueryResult({
        query_id: "q1",
        expected_irrelevant: ["bad-folder"],
        scoring: {
          ...makeQueryResult().scoring,
          irrelevant_appeared: ["bad-folder"],
          irrelevant_appeared_top_3: [],
        },
      }),
    ];
    const agg = computeAggregate(results, defaultCacheMeta);
    expect(agg.false_positives).toEqual(["q1: bad-folder"]);
    expect(agg.false_positives_top_3).toEqual([]);
  });

  it("empty results produces zero aggregates", () => {
    const agg = computeAggregate([], defaultCacheMeta);
    expect(agg.total_queries).toBe(0);
    expect(agg.recall_at_1).toBe(0);
    expect(agg.recall_at_3).toBe(0);
    expect(agg.recall_at_5).toBe(0);
    expect(agg.mrr).toBe(0);
  });

  it("includes cache metadata in aggregate", () => {
    const agg = computeAggregate([], defaultCacheMeta);
    expect(agg.cache_metadata.corpus_version).toBe("1.0.0");
    expect(agg.cache_metadata.embedding_model).toBe("qwen/qwen3-embedding-4b");
  });
});

describe("Diagnostics output", () => {
  it("diagnostics has all stage counts", () => {
    const d = makeDiagnostics();
    expect(d.knn_candidate_count).toBeGreaterThanOrEqual(0);
    expect(d.fts_candidate_count).toBeGreaterThanOrEqual(0);
    expect(d.fused_candidate_count).toBeGreaterThanOrEqual(0);
    expect(d.mmr_candidate_count).toBeGreaterThanOrEqual(0);
    expect(d.reranked_candidate_count).toBeGreaterThanOrEqual(0);
    expect(d.metadata_match_count).toBeGreaterThanOrEqual(0);
    expect(d.final_result_count).toBeGreaterThanOrEqual(0);
  });

  it("diagnostics has all latency measurements", () => {
    const d = makeDiagnostics();
    expect(d.latency_stage_ms.total_ms).toBeGreaterThanOrEqual(0);
    expect(d.latency_stage_ms.embedding_ms).toBeGreaterThanOrEqual(0);
    expect(d.latency_stage_ms.knn_ms).toBeGreaterThanOrEqual(0);
    expect(d.latency_stage_ms.fts_ms).toBeGreaterThanOrEqual(0);
    expect(d.latency_stage_ms.rrf_ms).toBeGreaterThanOrEqual(0);
    expect(d.latency_stage_ms.mmr_ms).toBeGreaterThanOrEqual(0);
    expect(d.latency_stage_ms.reranker_ms).toBeGreaterThanOrEqual(0);
    expect(d.latency_stage_ms.metadata_ms).toBeGreaterThanOrEqual(0);
  });

  it("diagnostics captures error string", () => {
    const d = makeDiagnostics({ error: "Test error" });
    expect(d.error).toBe("Test error");
  });

  it("reranker_threshold is recorded", () => {
    const d = makeDiagnostics();
    expect(d.reranker_threshold).toBe(0.55);
  });
});
