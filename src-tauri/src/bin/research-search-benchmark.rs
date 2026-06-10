use std::collections::HashMap;
use std::path::Path;

use deep_search_app_lib::research_search::{
    self, embeddings::EmbeddingConfig, indexing, reranker::RerankerConfig,
    search::CachedRerankScore, serialize_f32_vec, Database, SearchDiagnostics, SearchResult,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Corpus {
    version: String,
    embedding_model: String,
    embedding_dimensions: usize,
    reranker_model: String,
    chunking_version: u32,
    indexing_version: u32,
    query_prefix: String,
    folders: Vec<CorpusFolder>,
    queries: Vec<CorpusQuery>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CorpusFolder {
    name: String,
    original_query: String,
    files: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CorpusQuery {
    id: String,
    query: String,
    expected_relevant: Vec<String>,
    expected_irrelevant: Vec<String>,
    description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProviderCache {
    meta: CacheMeta,
    document_embeddings: HashMap<String, Vec<f32>>,
    query_embeddings: HashMap<String, Vec<f32>>,
    reranker_scores: HashMap<String, Vec<CachedRerankScore>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacyProviderCache {
    meta: CacheMeta,
    document_embeddings: HashMap<String, Vec<f32>>,
    query_embeddings: HashMap<String, Vec<f32>>,
    reranker_scores: HashMap<String, Vec<(usize, f64)>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheMeta {
    corpus_version: String,
    embedding_model: String,
    embedding_dimensions: usize,
    reranker_model: String,
    chunking_version: u32,
    indexing_version: u32,
    query_prefix: String,
    provider: String,
    created_at: Option<String>,
    description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct QueryResult {
    query_id: String,
    query_text: String,
    description: String,
    expected_relevant: Vec<String>,
    expected_irrelevant: Vec<String>,
    returned_folders: Vec<String>,
    returned_scores: Vec<f64>,
    diagnostics: SearchDiagnostics,
    scoring: FolderScore,
    passed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FolderScore {
    recall_at_1: f64,
    recall_at_3: f64,
    recall_at_5: f64,
    mrr: f64,
    rank_of_first_expected: Option<usize>,
    irrelevant_appeared: Vec<String>,
    irrelevant_appeared_top_3: Vec<String>,
    no_match_correct: bool,
    best_score_per_folder: HashMap<String, f64>,
    chunks_per_folder: HashMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AggregateReport {
    recall_at_1: f64,
    recall_at_3: f64,
    recall_at_5: f64,
    mrr: f64,
    total_queries: usize,
    passed_queries: usize,
    no_match_queries: usize,
    no_match_correct: usize,
    false_positives: Vec<String>,
    false_positives_top_3: Vec<String>,
    cache_metadata: CacheMeta,
    query_results: Vec<QueryResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BenchReport {
    timestamp: String,
    aggregate: AggregateReport,
}

#[derive(Debug, Clone)]
struct BenchmarkArgs {
    refresh: bool,
    migrate_legacy_cache: bool,
    validate_chunking: bool,
    corpus_path: String,
    cache_path: String,
    report_dir: String,
}

fn main() {
    dotenvy::dotenv().ok();
    let args: Vec<String> = std::env::args().collect();
    let args = parse_args(&args);

    let corpus: Corpus = serde_json::from_str(
        &std::fs::read_to_string(&args.corpus_path).expect("Failed to read corpus.json"),
    )
    .expect("Failed to parse corpus.json");

    if args.validate_chunking {
        validate_corpus_chunking(&corpus);
        return;
    }

    if args.migrate_legacy_cache {
        eprintln!("Migrating legacy reranker score tuples to chunk-hash-bound entries...");
        let legacy_cache = load_legacy_cache(&args.cache_path);
        let migrated_cache = migrate_legacy_cache_entries(&corpus, legacy_cache);
        let json =
            serde_json::to_string_pretty(&migrated_cache).expect("Failed to serialize cache");
        std::fs::write(&args.cache_path, &json).expect("Failed to write provider-cache.json");
        eprintln!("Provider cache migrated at {}", args.cache_path);
        return;
    }

    let cache = if args.refresh {
        eprintln!("Refreshing provider cache with live API calls...");
        let fresh_cache = build_cache(&corpus);
        let json = serde_json::to_string_pretty(&fresh_cache).expect("Failed to serialize cache");
        std::fs::write(&args.cache_path, &json).expect("Failed to write provider-cache.json");
        eprintln!("Provider cache saved to {}", args.cache_path);
        fresh_cache
    } else {
        let cache = load_or_empty_cache(&args.cache_path);
        validate_cache(&corpus, &cache, &args.cache_path);
        if cache.document_embeddings.is_empty() {
            eprintln!(
                "Provider cache is empty. Run with `--refresh` first for cache path {}.",
                args.cache_path
            );
            std::process::exit(1);
        }
        cache
    };

    research_search::register_sqlite_vec_extension();

    eprintln!("Initializing in-memory database...");
    let db = research_search::init_database_memory(corpus.embedding_dimensions)
        .expect("Failed to init database");

    eprintln!("Indexing {} fixture folders...", corpus.folders.len());
    for folder in &corpus.folders {
        index_folder(&db, folder, &cache);
    }

    eprintln!("Running {} benchmark queries...", corpus.queries.len());
    let mut query_results: Vec<QueryResult> = Vec::new();

    for q in &corpus.queries {
        let result = run_benchmark_query(&db, q, &cache);
        query_results.push(result);
    }

    let aggregate = compute_aggregate(&query_results, &cache.meta);

    std::fs::create_dir_all(&args.report_dir).expect("Failed to create report directory");

    let bench_report = BenchReport {
        timestamp: chrono_now(),
        aggregate,
    };

    let json_path = format!("{}/report.json", args.report_dir);
    let json = serde_json::to_string_pretty(&bench_report).expect("Failed to serialize report");
    std::fs::write(&json_path, &json).expect("Failed to write report.json");
    eprintln!("JSON report written to {}", json_path);

    let md_path = format!("{}/report.md", args.report_dir);
    let md = generate_markdown_report(&bench_report);
    std::fs::write(&md_path, &md).expect("Failed to write report.md");
    eprintln!("Markdown report written to {}", md_path);

    let passed = bench_report.aggregate.passed_queries;
    let total = bench_report.aggregate.total_queries;
    eprintln!(
        "\nBenchmark complete: {}/{} passed | Recall@1={:.3} Recall@3={:.3} Recall@5={:.3} MRR={:.3}",
        passed,
        total,
        bench_report.aggregate.recall_at_1,
        bench_report.aggregate.recall_at_3,
        bench_report.aggregate.recall_at_5,
        bench_report.aggregate.mrr,
    );

    if passed < total {
        eprintln!(
            "{} queries FAILED. See {}/report.md for details.",
            total - passed,
            args.report_dir
        );
        std::process::exit(1);
    }
}

fn parse_args(args: &[String]) -> BenchmarkArgs {
    let mut parsed = BenchmarkArgs {
        refresh: false,
        migrate_legacy_cache: false,
        validate_chunking: false,
        corpus_path: "benchmarks/research-search/fixtures/corpus.json".to_string(),
        cache_path: "benchmarks/research-search/fixtures/provider-cache.json".to_string(),
        report_dir: "benchmarks/research-search/results".to_string(),
    };

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--refresh" => parsed.refresh = true,
            "--migrate-legacy-cache" => parsed.migrate_legacy_cache = true,
            "--validate-chunking" => parsed.validate_chunking = true,
            "--corpus" => {
                i += 1;
                parsed.corpus_path = required_arg(args, i, "--corpus");
            }
            "--cache" => {
                i += 1;
                parsed.cache_path = required_arg(args, i, "--cache");
            }
            "--report-dir" => {
                i += 1;
                parsed.report_dir = required_arg(args, i, "--report-dir");
            }
            "--help" | "-h" => {
                print_usage();
                std::process::exit(0);
            }
            unknown => {
                eprintln!("Unknown argument: {}", unknown);
                print_usage();
                std::process::exit(2);
            }
        }
        i += 1;
    }

    parsed
}

fn required_arg(args: &[String], index: usize, flag: &str) -> String {
    args.get(index).cloned().unwrap_or_else(|| {
        eprintln!("{} requires a value", flag);
        print_usage();
        std::process::exit(2);
    })
}

fn print_usage() {
    eprintln!(
        "Usage: research-search-benchmark [--refresh] [--migrate-legacy-cache] [--validate-chunking] [--corpus PATH] [--cache PATH] [--report-dir PATH]"
    );
}

fn validate_corpus_chunking(corpus: &Corpus) {
    let mut file_count = 0_usize;
    let mut chunk_count = 0_usize;
    for folder in &corpus.folders {
        for content in folder.files.values() {
            file_count += 1;
            chunk_count += research_search::chunking::chunk_markdown(content).len();
        }
    }
    eprintln!(
        "Chunking validated for {} folders, {} files, {} chunks.",
        corpus.folders.len(),
        file_count,
        chunk_count
    );
}

fn load_or_empty_cache(path: &str) -> ProviderCache {
    if Path::new(path).exists() {
        let raw = std::fs::read_to_string(path).expect("Failed to read cache");
        let value: serde_json::Value =
            serde_json::from_str(&raw).expect("Failed to parse provider-cache.json");
        if cache_uses_legacy_reranker_scores(&value) {
            eprintln!(
                "provider-cache.json uses legacy reranker score tuples. Run `npm run benchmark:research-search:refresh` or `cargo run --manifest-path src-tauri/Cargo.toml --bin research-search-benchmark -- --migrate-legacy-cache` so scores are bound to chunk hashes."
            );
            std::process::exit(1);
        }
        serde_json::from_value(value).expect("Failed to parse provider-cache.json")
    } else {
        ProviderCache {
            meta: CacheMeta {
                corpus_version: String::new(),
                embedding_model: String::new(),
                embedding_dimensions: 0,
                reranker_model: String::new(),
                chunking_version: 0,
                indexing_version: 0,
                query_prefix: String::new(),
                provider: String::new(),
                created_at: None,
                description: None,
            },
            document_embeddings: HashMap::new(),
            query_embeddings: HashMap::new(),
            reranker_scores: HashMap::new(),
        }
    }
}

fn load_legacy_cache(path: &str) -> LegacyProviderCache {
    let raw = std::fs::read_to_string(path).expect("Failed to read cache");
    serde_json::from_str(&raw).expect("Failed to parse legacy provider-cache.json")
}

fn migrate_legacy_cache_entries(
    corpus: &Corpus,
    legacy_cache: LegacyProviderCache,
) -> ProviderCache {
    let LegacyProviderCache {
        meta,
        document_embeddings,
        query_embeddings,
        reranker_scores: legacy_reranker_scores,
    } = legacy_cache;

    let mut migrated_cache = ProviderCache {
        meta: CacheMeta {
            description: Some(
                "Migrated legacy tuple reranker scores to chunk-hash-bound score objects"
                    .to_string(),
            ),
            ..meta
        },
        document_embeddings,
        query_embeddings,
        reranker_scores: HashMap::new(),
    };

    research_search::register_sqlite_vec_extension();
    let db = research_search::init_database_memory(corpus.embedding_dimensions)
        .expect("Failed to init db for cache migration");

    for folder in &corpus.folders {
        index_folder(&db, folder, &migrated_cache);
    }

    for q in &corpus.queries {
        let q_hash = compute_hash(&q.query);
        let Some(legacy_scores) = legacy_reranker_scores.get(&q_hash) else {
            continue;
        };
        let query_emb = migrated_cache
            .query_embeddings
            .get(&q_hash)
            .unwrap_or_else(|| panic!("Missing cached embedding for query '{}'", q.id));
        let query_bytes = serialize_f32_vec(query_emb);
        let mut diag = SearchDiagnostics::new(&q.query);
        let (candidates, _) = research_search::search::collect_rerank_candidates(
            &db,
            &query_bytes,
            query_emb,
            &q.query,
            None,
            None,
            &mut diag,
        )
        .expect("Failed to collect reranker candidates for cache migration");

        let migrated_scores: Vec<CachedRerankScore> = legacy_scores
            .iter()
            .map(|(index, score)| {
                let candidate = candidates.get(*index).unwrap_or_else(|| {
                    panic!(
                        "Legacy reranker score index {} is out of range for query '{}'",
                        index, q.id
                    )
                });
                CachedRerankScore {
                    index: *index,
                    chunk_hash: candidate.content_hash.clone(),
                    score: *score,
                }
            })
            .collect();
        migrated_cache
            .reranker_scores
            .insert(q_hash, migrated_scores);
    }

    migrated_cache
}

fn cache_uses_legacy_reranker_scores(value: &serde_json::Value) -> bool {
    value
        .get("reranker_scores")
        .and_then(|scores| scores.as_object())
        .map(|scores| {
            scores.values().any(|query_scores| {
                query_scores.as_array().is_some_and(|items| {
                    items.iter().any(|item| {
                        item.as_array().is_some_and(|tuple| {
                            tuple.len() == 2
                                && tuple[0].as_u64().is_some()
                                && tuple[1].as_f64().is_some()
                        })
                    })
                })
            })
        })
        .unwrap_or(false)
}

fn validate_cache(corpus: &Corpus, cache: &ProviderCache, _cache_path: &str) {
    if cache.document_embeddings.is_empty() {
        return;
    }
    if cache.meta.corpus_version != corpus.version {
        eprintln!(
            "Cache corpus version '{}' does not match corpus version '{}'. Run refresh.",
            cache.meta.corpus_version, corpus.version
        );
        std::process::exit(1);
    }
    if cache.meta.embedding_model != corpus.embedding_model {
        eprintln!(
            "Cache embedding model '{}' does not match corpus '{}'. Run refresh.",
            cache.meta.embedding_model, corpus.embedding_model
        );
        std::process::exit(1);
    }
    if cache.meta.embedding_dimensions != corpus.embedding_dimensions {
        eprintln!(
            "Cache dimensions {} != corpus {}. Run refresh.",
            cache.meta.embedding_dimensions, corpus.embedding_dimensions
        );
        std::process::exit(1);
    }
    if cache.meta.reranker_model != corpus.reranker_model {
        eprintln!(
            "Cache reranker model '{}' does not match corpus '{}'. Run refresh.",
            cache.meta.reranker_model, corpus.reranker_model
        );
        std::process::exit(1);
    }
    if cache.meta.indexing_version != corpus.indexing_version {
        eprintln!(
            "Cache indexing version {} != corpus {}. Run refresh.",
            cache.meta.indexing_version, corpus.indexing_version
        );
        std::process::exit(1);
    }
    if cache.meta.query_prefix != corpus.query_prefix {
        eprintln!(
            "Cache query prefix '{}' does not match corpus '{}'. Run refresh.",
            cache.meta.query_prefix, corpus.query_prefix
        );
        std::process::exit(1);
    }
    if cache.meta.chunking_version != corpus.chunking_version {
        eprintln!("Cache chunking version mismatch. Run refresh.");
        std::process::exit(1);
    }
    for (query_hash, scores) in &cache.reranker_scores {
        for score in scores {
            if score.chunk_hash.len() != 64
                || !score.chunk_hash.chars().all(|c| c.is_ascii_hexdigit())
            {
                eprintln!(
                    "Cache reranker score for query hash {} has invalid chunk_hash '{}'. Run refresh.",
                    query_hash, score.chunk_hash
                );
                std::process::exit(1);
            }
        }
    }
    eprintln!(
        "Provider cache validated (version={}, model={}, {} doc embeddings, {} query embeddings).",
        cache.meta.corpus_version,
        cache.meta.embedding_model,
        cache.document_embeddings.len(),
        cache.query_embeddings.len(),
    );
}

fn build_cache(corpus: &Corpus) -> ProviderCache {
    let api_key = std::env::var("OPENROUTER_API_KEY")
        .expect("OPENROUTER_API_KEY environment variable not set");

    let embed_config = EmbeddingConfig {
        api_key: api_key.clone(),
        model: corpus.embedding_model.clone(),
        dimensions: corpus.embedding_dimensions,
        query_prefix: corpus.query_prefix.clone(),
        ..Default::default()
    };

    let reranker_config = RerankerConfig {
        api_key: api_key.clone(),
        model: corpus.reranker_model.clone(),
        ..Default::default()
    };

    eprintln!("Building document embeddings...");
    let mut document_embeddings: HashMap<String, Vec<f32>> = HashMap::new();
    let mut document_texts: Vec<(String, String)> = Vec::new();

    for folder in &corpus.folders {
        for (_filename, content) in &folder.files {
            let chunks = research_search::chunking::chunk_markdown(content);
            let folder_prefix = format!("[From: '{}']\n\n", folder.name);
            for chunk in &chunks {
                let text = format!("{}{}", folder_prefix, chunk.content);
                let hash = compute_hash(&text);
                if !document_embeddings.contains_key(&hash)
                    && !document_texts
                        .iter()
                        .any(|(existing_hash, _)| existing_hash == &hash)
                {
                    document_texts.push((hash, text));
                }
            }
        }
    }
    if !document_texts.is_empty() {
        let texts: Vec<String> = document_texts
            .iter()
            .map(|(_, text)| text.clone())
            .collect();
        let embeddings = research_search::embeddings::embed_texts(&embed_config, &texts, false)
            .expect("Failed to get document embeddings");
        for ((hash, _), emb) in document_texts.into_iter().zip(embeddings.into_iter()) {
            document_embeddings.insert(hash, emb);
        }
    }
    eprintln!("  {} document embeddings built.", document_embeddings.len());

    eprintln!("Building query embeddings...");
    let mut query_embeddings: HashMap<String, Vec<f32>> = HashMap::new();
    let mut query_texts: Vec<(String, String)> = Vec::new();

    for q in &corpus.queries {
        let hash = compute_hash(&q.query);
        if !query_embeddings.contains_key(&hash)
            && !query_texts
                .iter()
                .any(|(existing_hash, _)| existing_hash == &hash)
        {
            query_texts.push((hash, q.query.clone()));
        }
    }
    if !query_texts.is_empty() {
        let texts: Vec<String> = query_texts.iter().map(|(_, text)| text.clone()).collect();
        let embeddings = research_search::embeddings::embed_texts(&embed_config, &texts, true)
            .expect("Failed to get query embeddings");
        for ((hash, _), emb) in query_texts.into_iter().zip(embeddings.into_iter()) {
            query_embeddings.insert(hash, emb);
        }
    }
    eprintln!("  {} query embeddings built.", query_embeddings.len());

    eprintln!("Building reranker scores (requires indexed DB)...");
    let mut reranker_scores: HashMap<String, Vec<CachedRerankScore>> = HashMap::new();

    let db = research_search::init_database_memory(corpus.embedding_dimensions)
        .expect("Failed to init db for cache building");

    let temp_cache = ProviderCache {
        meta: CacheMeta {
            corpus_version: corpus.version.clone(),
            embedding_model: corpus.embedding_model.clone(),
            embedding_dimensions: corpus.embedding_dimensions,
            reranker_model: corpus.reranker_model.clone(),
            chunking_version: corpus.chunking_version,
            indexing_version: corpus.indexing_version,
            query_prefix: corpus.query_prefix.clone(),
            provider: "openrouter".to_string(),
            created_at: None,
            description: None,
        },
        document_embeddings: document_embeddings.clone(),
        query_embeddings: HashMap::new(),
        reranker_scores: HashMap::new(),
    };

    for folder in &corpus.folders {
        index_folder(&db, folder, &temp_cache);
    }

    for q in &corpus.queries {
        let q_hash = compute_hash(&q.query);
        let query_emb = query_embeddings
            .get(&q_hash)
            .expect("Query embedding not found");
        let query_bytes = serialize_f32_vec(query_emb);

        let mut diag = SearchDiagnostics::new(&q.query);
        let (candidates, _) = research_search::search::collect_rerank_candidates(
            &db,
            &query_bytes,
            query_emb,
            &q.query,
            None,
            None,
            &mut diag,
        )
        .expect("Failed to collect reranker candidates");

        if !candidates.is_empty() {
            let docs: Vec<String> = candidates
                .iter()
                .map(|candidate| candidate.content.clone())
                .collect();
            let reranked = research_search::reranker::rerank(&reranker_config, &q.query, &docs)
                .expect("Failed to get reranker scores");
            let scores: Vec<CachedRerankScore> = reranked
                .into_iter()
                .filter_map(|item| {
                    candidates
                        .get(item.index)
                        .map(|candidate| CachedRerankScore {
                            index: item.index,
                            chunk_hash: candidate.content_hash.clone(),
                            score: item.score,
                        })
                })
                .collect();
            reranker_scores.insert(q_hash, scores);
        }

        eprintln!("  reranker scores for query '{}' built.", q.id);
    }

    ProviderCache {
        meta: CacheMeta {
            corpus_version: corpus.version.clone(),
            embedding_model: corpus.embedding_model.clone(),
            embedding_dimensions: corpus.embedding_dimensions,
            reranker_model: corpus.reranker_model.clone(),
            chunking_version: corpus.chunking_version,
            indexing_version: corpus.indexing_version,
            query_prefix: corpus.query_prefix.clone(),
            provider: "openrouter".to_string(),
            created_at: Some(chrono_now()),
            description: Some("Generated by benchmark:research-search:refresh".to_string()),
        },
        document_embeddings,
        query_embeddings,
        reranker_scores,
    }
}

fn index_folder(db: &Database, folder: &CorpusFolder, cache: &ProviderCache) {
    let embedding_config = cache_embedding_config(cache);

    {
        let conn = db.conn.lock().unwrap();
        indexing::register_folder(&conn, &folder.name, &folder.original_query)
            .expect("Failed to register folder");
    }

    for (filename, content) in &folder.files {
        indexing::index_file_inner(
            db,
            &embedding_config,
            &folder.name,
            filename,
            content,
            Some(&cache.document_embeddings),
        )
        .unwrap_or_else(|e| panic!("Failed to index {}/{}: {}", folder.name, filename, e));
    }
}

fn cache_embedding_config(cache: &ProviderCache) -> EmbeddingConfig {
    EmbeddingConfig {
        model: cache.meta.embedding_model.clone(),
        dimensions: cache.meta.embedding_dimensions,
        query_prefix: cache.meta.query_prefix.clone(),
        ..Default::default()
    }
}

fn run_benchmark_query(db: &Database, q: &CorpusQuery, cache: &ProviderCache) -> QueryResult {
    let q_hash = compute_hash(&q.query);
    let query_embedding = cache
        .query_embeddings
        .get(&q_hash)
        .unwrap_or_else(|| panic!("Missing cached embedding for query '{}'", q.id));
    let query_bytes = serialize_f32_vec(query_embedding);
    let reranker_scores = cache.reranker_scores.get(&q_hash);

    let mut diag = SearchDiagnostics::new(&q.query);
    let results = research_search::search::search_inner(
        db,
        &query_bytes,
        query_embedding,
        &q.query,
        None,
        None,
        Some(8),
        reranker_scores.map(|v| v.as_slice()),
        None,
        &mut diag,
    )
    .unwrap_or_else(|e| {
        diag.error = Some(e.clone());
        eprintln!("  Error searching '{}': {}", q.id, e);
        Vec::new()
    });

    let returned_folders: Vec<String> = results.iter().map(|r| r.folder_name.clone()).collect();
    let returned_scores: Vec<f64> = results.iter().map(|r| r.score).collect();

    let scoring = score_folder_level(q, &results);

    let passed_by_recall = if q.expected_relevant.is_empty() {
        scoring.no_match_correct
    } else if q.expected_relevant.len() == 1 {
        scoring.recall_at_1 >= 1.0
    } else {
        scoring.recall_at_3 >= 1.0
    };
    let passed =
        diag.error.is_none() && passed_by_recall && scoring.irrelevant_appeared_top_3.is_empty();

    QueryResult {
        query_id: q.id.clone(),
        query_text: q.query.clone(),
        description: q.description.clone(),
        expected_relevant: q.expected_relevant.clone(),
        expected_irrelevant: q.expected_irrelevant.clone(),
        returned_folders,
        returned_scores,
        diagnostics: diag,
        scoring,
        passed,
    }
}

fn score_folder_level(q: &CorpusQuery, results: &[SearchResult]) -> FolderScore {
    let mut seen_folders: Vec<String> = Vec::new();
    let mut best_score_per_folder: HashMap<String, f64> = HashMap::new();
    let mut chunks_per_folder: HashMap<String, usize> = HashMap::new();

    for r in results {
        let entry = chunks_per_folder.entry(r.folder_name.clone()).or_insert(0);
        *entry += 1;
        let best = best_score_per_folder
            .entry(r.folder_name.clone())
            .or_insert(r.score);
        if r.score > *best {
            *best = r.score;
        }
        if !seen_folders.contains(&r.folder_name) {
            seen_folders.push(r.folder_name.clone());
        }
    }

    let is_no_match = q.expected_relevant.is_empty();
    let no_match_correct = is_no_match && seen_folders.is_empty();

    let mut rank_of_first_expected: Option<usize> = None;
    let mut reciprocal_rank = 0.0_f64;

    for (rank, folder) in seen_folders.iter().enumerate() {
        if q.expected_relevant.contains(folder) {
            if rank_of_first_expected.is_none() {
                rank_of_first_expected = Some(rank + 1);
                reciprocal_rank = 1.0 / (rank + 1) as f64;
            }
        }
    }

    let relevant_at_k = |k: usize| -> usize {
        seen_folders
            .iter()
            .take(k)
            .filter(|f| q.expected_relevant.contains(f))
            .count()
    };

    let total_relevant = q.expected_relevant.len();
    let recall_at_1 = if total_relevant > 0 {
        relevant_at_k(1) as f64 / total_relevant as f64
    } else if is_no_match && no_match_correct {
        1.0
    } else {
        0.0
    };
    let recall_at_3 = if total_relevant > 0 {
        relevant_at_k(3) as f64 / total_relevant as f64
    } else if is_no_match && no_match_correct {
        1.0
    } else {
        0.0
    };
    let recall_at_5 = if total_relevant > 0 {
        relevant_at_k(5) as f64 / total_relevant as f64
    } else if is_no_match && no_match_correct {
        1.0
    } else {
        0.0
    };
    let mrr = if !is_no_match {
        reciprocal_rank
    } else if no_match_correct {
        1.0
    } else {
        0.0
    };

    let irrelevant_appeared: Vec<String> = seen_folders
        .iter()
        .filter(|f| q.expected_irrelevant.contains(f))
        .cloned()
        .collect();
    let irrelevant_appeared_top_3: Vec<String> = seen_folders
        .iter()
        .take(3)
        .filter(|f| q.expected_irrelevant.contains(f))
        .cloned()
        .collect();

    FolderScore {
        recall_at_1,
        recall_at_3,
        recall_at_5,
        mrr,
        rank_of_first_expected,
        irrelevant_appeared,
        irrelevant_appeared_top_3,
        no_match_correct,
        best_score_per_folder,
        chunks_per_folder,
    }
}

fn compute_aggregate(results: &[QueryResult], cache_meta: &CacheMeta) -> AggregateReport {
    let total = results.len();
    let passed = results.iter().filter(|r| r.passed).count();

    let recall1_sum: f64 = results.iter().map(|r| r.scoring.recall_at_1).sum();
    let recall3_sum: f64 = results.iter().map(|r| r.scoring.recall_at_3).sum();
    let recall5_sum: f64 = results.iter().map(|r| r.scoring.recall_at_5).sum();
    let mrr_sum: f64 = results.iter().map(|r| r.scoring.mrr).sum();

    let no_match_queries = results
        .iter()
        .filter(|r| r.expected_relevant.is_empty())
        .count();
    let no_match_correct = results
        .iter()
        .filter(|r| r.expected_relevant.is_empty() && r.scoring.no_match_correct)
        .count();

    let false_positives: Vec<String> = results
        .iter()
        .filter(|r| !r.scoring.irrelevant_appeared.is_empty())
        .map(|r| {
            format!(
                "{}: {}",
                r.query_id,
                r.scoring.irrelevant_appeared.join(", ")
            )
        })
        .collect();
    let false_positives_top_3: Vec<String> = results
        .iter()
        .filter(|r| !r.scoring.irrelevant_appeared_top_3.is_empty())
        .map(|r| {
            format!(
                "{}: {}",
                r.query_id,
                r.scoring.irrelevant_appeared_top_3.join(", ")
            )
        })
        .collect();

    AggregateReport {
        recall_at_1: if total > 0 {
            recall1_sum / total as f64
        } else {
            0.0
        },
        recall_at_3: if total > 0 {
            recall3_sum / total as f64
        } else {
            0.0
        },
        recall_at_5: if total > 0 {
            recall5_sum / total as f64
        } else {
            0.0
        },
        mrr: if total > 0 {
            mrr_sum / total as f64
        } else {
            0.0
        },
        total_queries: total,
        passed_queries: passed,
        no_match_queries,
        no_match_correct,
        false_positives,
        false_positives_top_3,
        cache_metadata: cache_meta.clone(),
        query_results: results.to_vec(),
    }
}

fn generate_markdown_report(report: &BenchReport) -> String {
    let agg = &report.aggregate;
    let mut md = String::new();

    md.push_str("# Research Search Benchmark Report\n\n");
    md.push_str(&format!("**Timestamp:** {}\n\n", report.timestamp));
    md.push_str(&format!(
        "**Cache:** {} / {} ({} dims)\n\n",
        agg.cache_metadata.embedding_model,
        agg.cache_metadata.reranker_model,
        agg.cache_metadata.embedding_dimensions,
    ));

    md.push_str("## Aggregate Scores\n\n");
    md.push_str("| Metric | Value |\n");
    md.push_str("|--------|-------|\n");
    md.push_str(&format!("| Recall@1 | {:.3} |\n", agg.recall_at_1));
    md.push_str(&format!("| Recall@3 | {:.3} |\n", agg.recall_at_3));
    md.push_str(&format!("| Recall@5 | {:.3} |\n", agg.recall_at_5));
    md.push_str(&format!("| MRR | {:.3} |\n", agg.mrr));
    md.push_str(&format!(
        "| Passed | {}/{} |\n",
        agg.passed_queries, agg.total_queries
    ));
    md.push_str(&format!(
        "| No-match correct | {}/{} |\n\n",
        agg.no_match_correct, agg.no_match_queries
    ));

    if !agg.false_positives.is_empty() {
        md.push_str("## False Positives\n\n");
        for fp in &agg.false_positives {
            md.push_str(&format!("- {}\n", fp));
        }
        md.push('\n');
    }

    if !agg.false_positives_top_3.is_empty() {
        md.push_str("## Top-3 False Positives (Failing)\n\n");
        for fp in &agg.false_positives_top_3 {
            md.push_str(&format!("- {}\n", fp));
        }
        md.push('\n');
    }

    md.push_str("## Per-Query Results\n\n");

    for r in &agg.query_results {
        let status = if r.passed { "PASS" } else { "FAIL" };
        md.push_str(&format!("### {} [{}]\n\n", r.query_id, status));
        md.push_str(&format!("**Query:** {}\n\n", r.query_text));
        md.push_str(&format!("**Description:** {}\n\n", r.description));

        md.push_str("| Field | Value |\n");
        md.push_str("|-------|-------|\n");
        md.push_str(&format!(
            "| Expected relevant | {} |\n",
            r.expected_relevant.join(", ")
        ));
        let returned_str = if r.returned_folders.is_empty() {
            "(none)".to_string()
        } else {
            r.returned_folders
                .iter()
                .zip(r.returned_scores.iter())
                .map(|(f, s)| format!("{} ({:.3})", f, s))
                .collect::<Vec<_>>()
                .join(", ")
        };
        md.push_str(&format!("| Returned | {} |\n", returned_str));
        md.push_str(&format!("| Recall@1 | {:.3} |\n", r.scoring.recall_at_1));
        md.push_str(&format!("| Recall@3 | {:.3} |\n", r.scoring.recall_at_3));
        md.push_str(&format!("| Recall@5 | {:.3} |\n", r.scoring.recall_at_5));
        md.push_str(&format!("| MRR | {:.3} |\n", r.scoring.mrr));
        md.push_str(&format!(
            "| Rank of first expected | {} |\n",
            r.scoring
                .rank_of_first_expected
                .map(|v| v.to_string())
                .unwrap_or_else(|| "-".to_string())
        ));

        if !r.scoring.irrelevant_appeared.is_empty() {
            md.push_str(&format!(
                "| Irrelevant appeared | {} |\n",
                r.scoring.irrelevant_appeared.join(", ")
            ));
        }
        if !r.scoring.irrelevant_appeared_top_3.is_empty() {
            md.push_str(&format!(
                "| Irrelevant in top 3 | {} |\n",
                r.scoring.irrelevant_appeared_top_3.join(", ")
            ));
        }

        md.push_str("\n**Stage Diagnostics:**\n\n");
        md.push_str("| Stage | Count | Latency (ms) |\n");
        md.push_str("|-------|-------|-------------|\n");
        md.push_str(&format!(
            "| Embedding | - | {} |\n",
            r.diagnostics.latency_stage_ms.embedding_ms
        ));
        md.push_str(&format!(
            "| KNN | {} | {} |\n",
            r.diagnostics.knn_candidate_count, r.diagnostics.latency_stage_ms.knn_ms
        ));
        md.push_str(&format!(
            "| FTS | {} | {} |\n",
            r.diagnostics.fts_candidate_count, r.diagnostics.latency_stage_ms.fts_ms
        ));
        md.push_str(&format!(
            "| RRF | {} | {} |\n",
            r.diagnostics.fused_candidate_count, r.diagnostics.latency_stage_ms.rrf_ms
        ));
        md.push_str(&format!(
            "| MMR | {} | {} |\n",
            r.diagnostics.mmr_candidate_count, r.diagnostics.latency_stage_ms.mmr_ms
        ));
        md.push_str(&format!(
            "| Reranker | {} | {} |\n",
            r.diagnostics.reranked_candidate_count, r.diagnostics.latency_stage_ms.reranker_ms
        ));
        md.push_str(&format!(
            "| Metadata | {} | {} |\n",
            r.diagnostics.metadata_match_count, r.diagnostics.latency_stage_ms.metadata_ms
        ));
        md.push_str(&format!(
            "| Final | {} | {} (total) |\n",
            r.diagnostics.final_result_count, r.diagnostics.latency_stage_ms.total_ms
        ));

        if let Some(ref err) = r.diagnostics.error {
            md.push_str(&format!("\n**Error:** {}\n", err));
        }

        md.push('\n');
    }

    md
}

fn compute_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn chrono_now() -> String {
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    let days_since_epoch = secs / 86400;
    let mut y = 1970_i64;
    let mut remaining = days_since_epoch as i64;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let months = if is_leap(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut mo = 1;
    for &days in &months {
        if remaining < days {
            break;
        }
        remaining -= days;
        mo += 1;
    }
    let day = remaining + 1;
    let secs_of_day = secs % 86400;
    let h = secs_of_day / 3600;
    let m = (secs_of_day % 3600) / 60;
    let s = secs_of_day % 60;
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, day, h, m, s)
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}
