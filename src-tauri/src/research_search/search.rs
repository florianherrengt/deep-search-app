use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::time::Instant;

use crate::research_search::embeddings::{self, EmbeddingConfig};
use crate::research_search::hype;
use crate::research_search::reranker::{self, RerankerConfig};
use crate::research_search::schema;
use crate::research_search::{
    serialize_f32_vec, AdjacentChunk, Database, SearchDiagnostics, SearchResult, StageLatencies,
};

#[derive(Debug, Clone, PartialEq)]
pub enum QueryType {
    Keyword,
    Conceptual,
    ExactPhrase(String),
}

fn classify_query(query: &str) -> QueryType {
    let trimmed = query.trim();
    if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 4 {
        let phrase = &trimmed[1..trimmed.len() - 1];
        if !phrase.is_empty() {
            return QueryType::ExactPhrase(phrase.to_string());
        }
    }

    let words: Vec<&str> = trimmed.split_whitespace().collect();
    let lower = trimmed.to_lowercase();

    let is_conceptual = words.len() > 5
        || trimmed.contains('?')
        || lower.contains("what ")
        || lower.contains("how ")
        || lower.contains("explain")
        || lower.contains("describe")
        || lower.contains("compare")
        || lower.contains("difference")
        || lower.contains("tradeoff");

    if is_conceptual {
        QueryType::Conceptual
    } else {
        QueryType::Keyword
    }
}
const RRF_K: f64 = 20.0;
const MMR_SIMILARITY_THRESHOLD: f64 = 0.85;
const FOLDER_METADATA_FILENAME: &str = "folder-metadata";
const MIN_METADATA_OVERLAP_RATIO: f64 = 0.25;

#[derive(Debug, Clone)]
pub struct RankedItem {
    pub chunk_id: i64,
    pub rank: usize,
}

pub struct ChunkInfo {
    pub id: i64,
    pub content: String,
    pub filename: String,
    pub header_path: Option<String>,
    pub chunk_index: i32,
    pub folder_id: i64,
    pub folder_name: String,
}

pub fn search_multi(
    db: &Database,
    embedding_config: &EmbeddingConfig,
    reranker_config: &RerankerConfig,
    queries: &[String],
    folder: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<SearchResult>, String> {
    let limit = limit.unwrap_or(8) as usize;

    let mut all_results: Vec<SearchResult> = Vec::new();
    let mut seen_chunk_ids: HashSet<i64> = HashSet::new();

    for query in queries {
        let results = search(db, embedding_config, reranker_config, query, folder, Some(limit as u32))?;
        for result in results {
            if seen_chunk_ids.insert(result.chunk_id) {
                all_results.push(result);
            }
        }
    }

    all_results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    all_results.truncate(limit);

    Ok(all_results)
}

pub fn search(
    db: &Database,
    embedding_config: &EmbeddingConfig,
    reranker_config: &RerankerConfig,
    query: &str,
    folder: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<SearchResult>, String> {
    let t0 = Instant::now();
    let query_embedding = embeddings::embed_query(embedding_config, query)?;
    let query_bytes = serialize_f32_vec(&query_embedding);
    let embedding_ms = t0.elapsed().as_millis() as u64;
    let mut diag = SearchDiagnostics::new(query);
    diag.latency_stage_ms.embedding_ms = embedding_ms;

    search_inner(db, &query_bytes, &query_embedding, query, folder, limit, None, Some(reranker_config), &mut diag)
}

pub fn search_inner(
    db: &Database,
    query_bytes: &[u8],
    query_embedding: &[f32],
    query: &str,
    folder: Option<&str>,
    limit: Option<u32>,
    reranker_scores: Option<&[(usize, f64)]>,
    fallback_reranker_config: Option<&RerankerConfig>,
    diag: &mut SearchDiagnostics,
) -> Result<Vec<SearchResult>, String> {
    let limit = limit.unwrap_or(8) as usize;
    let t_total = Instant::now();

    let query_type = classify_query(query);

    let (vec_weight, fts_weight) = match query_type {
        QueryType::Keyword => (0.7, 1.3),
        QueryType::Conceptual => (1.3, 0.7),
        QueryType::ExactPhrase(_) => (0.0, 2.0),
    };

    let (_fused, diverse_candidates, snippets) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;

        let t_knn = Instant::now();
        let mut vec_results = if matches!(query_type, QueryType::ExactPhrase(_)) {
            Vec::new()
        } else {
            knn_search(&conn, query_bytes)?
        };
        let hype_results = hype::hype_search(&conn, query_bytes)?;
        if !hype_results.is_empty() {
            let mut seen: HashSet<i64> = vec_results.iter().map(|r| r.chunk_id).collect();
            for (chunk_id, _distance) in &hype_results {
                if seen.insert(*chunk_id) {
                    vec_results.push(RankedItem {
                        chunk_id: *chunk_id,
                        rank: seen.len() - 1,
                    });
                }
            }
        }
        diag.knn_candidate_count = vec_results.len();
        diag.latency_stage_ms.knn_ms = t_knn.elapsed().as_millis() as u64;

        let t_fts = Instant::now();
        let fts_query = match &query_type {
            QueryType::ExactPhrase(phrase) => sanitize_fts_phrase_query(phrase),
            _ => sanitize_fts_query(query),
        };
        let fts_results = fts_search_with_query(&conn, &fts_query)?;
        diag.fts_candidate_count = fts_results.len();
        diag.latency_stage_ms.fts_ms = t_fts.elapsed().as_millis() as u64;

        let t_rrf = Instant::now();
        let mut fused = adaptive_rrf(&vec_results, &fts_results, vec_weight, fts_weight);
        diag.fused_candidate_count = fused.len();
        diag.latency_stage_ms.rrf_ms = t_rrf.elapsed().as_millis() as u64;

        if let Some(folder_name) = folder {
            filter_by_folder(&conn, &mut fused, folder_name)?;
            diag.fused_candidate_count = fused.len();
        }

        let t_mmr = Instant::now();
        let diverse = mmr_dedup(&conn, &fused, query_embedding)?;
        diag.mmr_candidate_count = diverse.len();
        diag.latency_stage_ms.mmr_ms = t_mmr.elapsed().as_millis() as u64;

        let snippets: HashMap<i64, String> = diverse
            .iter()
            .take(15)
            .filter_map(|id| get_fts_snippet(&conn, *id, &fts_query).ok().map(|s| (*id, s)))
            .collect();

        let candidates: Vec<(i64, String)> = diverse
            .iter()
            .take(15)
            .filter_map(|id| {
                let info = get_chunk_info(&conn, *id).ok()?;
                Some((*id, info.content))
            })
            .collect();

        (fused, candidates, snippets)
    };

    let mut chunk_results = Vec::new();
    if !diverse_candidates.is_empty() {
        let (ids, docs): (Vec<i64>, Vec<String>) = diverse_candidates.into_iter().unzip();

        let t_rerank = Instant::now();
        let scored: Vec<(i64, f64)> = if let Some(scores) = reranker_scores {
            scores
                .iter()
                .filter(|(_, s)| *s >= 0.5)
                .take(limit)
                .filter_map(|(idx, score)| ids.get(*idx).map(|id| (*id, *score)))
                .collect()
        } else if let Some(config) = fallback_reranker_config {
            let reranked = reranker::rerank(config, query, &docs)?;
            reranked
                .into_iter()
                .filter(|item| item.score >= 0.5)
                .take(limit)
                .map(|item| (ids[item.index], item.score))
                .collect()
        } else {
            let reranked = reranker::rerank(&RerankerConfig::default(), query, &docs)?;
            reranked
                .into_iter()
                .filter(|item| item.score >= 0.5)
                .take(limit)
                .map(|item| (ids[item.index], item.score))
                .collect()
        };
        diag.reranker_threshold = 0.5;
        diag.reranked_candidate_count = scored.len();
        diag.latency_stage_ms.reranker_ms = t_rerank.elapsed().as_millis() as u64;

        if scored.is_empty() {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;

            let t_meta = Instant::now();
            let mut meta = folder_metadata_search(&conn, query, folder, true)?;
            diag.metadata_match_count = meta.len();
            diag.latency_stage_ms.metadata_ms = t_meta.elapsed().as_millis() as u64;
            diag.final_result_count = meta.len();
            meta.truncate(limit);
            diag.latency_stage_ms.total_ms = t_total.elapsed().as_millis() as u64;
            return Ok(meta);
        }

        {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            chunk_results = Vec::with_capacity(scored.len());
            for (id, score) in scored {
                if let Ok(info) = get_chunk_info(&conn, id) {
                    let adjacent =
                        get_adjacent_chunks(&conn, info.folder_id, &info.filename, info.chunk_index)
                            .ok();

                    chunk_results.push(SearchResult {
                        chunk_id: info.id,
                        content: info.content,
                        filename: info.filename,
                        folder_name: info.folder_name,
                        header_path: info.header_path,
                        score,
                        adjacent_chunks: adjacent,
                        snippet: snippets.get(&id).cloned(),
                    });
                }
            }
        }
    }

    let results = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;

        let t_meta = Instant::now();
        let mut meta = folder_metadata_search(&conn, query, folder, false)?;
        diag.metadata_match_count = meta.len();
        diag.latency_stage_ms.metadata_ms = t_meta.elapsed().as_millis() as u64;

        meta.extend(chunk_results);
        meta.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        meta.truncate(limit);
        diag.final_result_count = meta.len();
        meta
    };

    diag.latency_stage_ms.total_ms = t_total.elapsed().as_millis() as u64;
    Ok(results)
}

impl SearchDiagnostics {
    pub fn new(query: &str) -> Self {
        Self {
            query: query.to_string(),
            knn_candidate_count: 0,
            fts_candidate_count: 0,
            fused_candidate_count: 0,
            mmr_candidate_count: 0,
            reranked_candidate_count: 0,
            metadata_match_count: 0,
            final_result_count: 0,
            reranker_threshold: 0.0,
            latency_stage_ms: StageLatencies {
                total_ms: 0,
                embedding_ms: 0,
                knn_ms: 0,
                fts_ms: 0,
                rrf_ms: 0,
                mmr_ms: 0,
                reranker_ms: 0,
                metadata_ms: 0,
            },
            error: None,
        }
    }
}

pub fn knn_search_pub(conn: &Connection, query_bytes: &[u8]) -> Result<Vec<RankedItem>, String> {
    knn_search(conn, query_bytes)
}

pub fn fts_search_pub(conn: &Connection, query: &str) -> Result<Vec<RankedItem>, String> {
    fts_search(conn, query)
}

pub fn adaptive_rrf_pub(vec_results: &[RankedItem], fts_results: &[RankedItem]) -> Vec<(i64, f64)> {
    adaptive_rrf(vec_results, fts_results, 1.0, 1.0)
}

pub fn adaptive_rrf_weighted(
    vec_results: &[RankedItem],
    fts_results: &[RankedItem],
    vec_weight: f64,
    fts_weight: f64,
) -> Vec<(i64, f64)> {
    adaptive_rrf(vec_results, fts_results, vec_weight, fts_weight)
}

pub fn classify_query_pub(query: &str) -> QueryType {
    classify_query(query)
}

pub fn mmr_dedup_pub(
    conn: &Connection,
    fused: &[(i64, f64)],
    query_embedding: &[f32],
) -> Result<Vec<i64>, String> {
    mmr_dedup(conn, fused, query_embedding)
}

pub fn get_chunk_info_pub(conn: &Connection, chunk_id: i64) -> Result<ChunkInfo, String> {
    get_chunk_info(conn, chunk_id)
}

fn knn_search(conn: &Connection, query_bytes: &[u8]) -> Result<Vec<RankedItem>, String> {
    let mut stmt = conn
        .prepare(schema::KNN_SEARCH)
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([query_bytes]).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    let mut rank = 0;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let chunk_id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let _distance: f64 = row.get(1).map_err(|e| e.to_string())?;
        results.push(RankedItem { chunk_id, rank });
        rank += 1;
    }
    Ok(results)
}

fn fts_search(conn: &Connection, query: &str) -> Result<Vec<RankedItem>, String> {
    let sanitized = sanitize_fts_query(query);
    fts_search_with_query(conn, &sanitized)
}

fn fts_search_with_query(conn: &Connection, query: &str) -> Result<Vec<RankedItem>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare(schema::FTS_SEARCH)
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query([query])
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    let mut rank = 0;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let chunk_id: i64 = row.get(0).map_err(|e| e.to_string())?;
        results.push(RankedItem { chunk_id, rank });
        rank += 1;
    }
    Ok(results)
}

fn sanitize_fts_query(query: &str) -> String {
    tokenize_search_terms(query)
        .into_iter()
        .map(|term| format!("\"{}\"", term))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn sanitize_fts_phrase_query(phrase: &str) -> String {
    format!("\"{}\"", phrase)
}

fn get_fts_snippet(
    conn: &Connection,
    chunk_id: i64,
    fts_query: &str,
) -> Result<String, String> {
    if fts_query.is_empty() {
        let content: String = conn
            .query_row(
                "SELECT content FROM chunks WHERE id = ?1",
                [chunk_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        return Ok(truncate_snippet(&content, 200));
    }

    let sql = format!(
        "SELECT snippet(chunks_fts, 0, '<mark>', '</mark>', '...', 32) \
         FROM chunks_fts WHERE chunks_fts MATCH '{}' AND rowid = {}",
        fts_query.replace('\'', "''"),
        chunk_id
    );

    match conn.query_row(&sql, [], |row| row.get::<_, String>(0)) {
        Ok(snippet) if !snippet.is_empty() => Ok(snippet),
        _ => {
            let content: String = conn
                .query_row(
                    "SELECT content FROM chunks WHERE id = ?1",
                    [chunk_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            Ok(truncate_snippet(&content, 200))
        }
    }
}

fn truncate_snippet(content: &str, max_len: usize) -> String {
    if content.len() <= max_len {
        content.to_string()
    } else {
        let mut end = max_len;
        while end > 0 && !content.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &content[..end])
    }
}

fn adaptive_rrf(
    vec_results: &[RankedItem],
    fts_results: &[RankedItem],
    vec_weight: f64,
    fts_weight: f64,
) -> Vec<(i64, f64)> {
    let mut scores: HashMap<i64, f64> = HashMap::new();

    for item in vec_results {
        let score = vec_weight / (RRF_K + item.rank as f64 + 1.0);
        *scores.entry(item.chunk_id).or_insert(0.0) += score;
    }

    for item in fts_results {
        let score = fts_weight / (RRF_K + item.rank as f64 + 1.0);
        *scores.entry(item.chunk_id).or_insert(0.0) += score;
    }

    let mut fused: Vec<(i64, f64)> = scores.into_iter().collect();
    fused.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    fused
}

fn filter_by_folder(
    conn: &Connection,
    fused: &mut Vec<(i64, f64)>,
    folder_name: &str,
) -> Result<(), String> {
    let folder_id = {
        let mut stmt = conn
            .prepare("SELECT id FROM research_folders WHERE name = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([folder_name]).map_err(|e| e.to_string())?;
        match rows.next().map_err(|e| e.to_string())? {
            Some(row) => row.get::<_, i64>(0).map_err(|e| e.to_string())?,
            None => {
                fused.clear();
                return Ok(());
            }
        }
    };

    let mut valid_ids = HashSet::new();
    for (chunk_id, _) in fused.iter() {
        if let Ok(info) = get_chunk_info(conn, *chunk_id) {
            if info.folder_id == folder_id {
                valid_ids.insert(*chunk_id);
            }
        }
    }

    fused.retain(|(id, _)| valid_ids.contains(id));
    Ok(())
}

fn folder_metadata_search(
    conn: &Connection,
    query: &str,
    folder: Option<&str>,
    strict: bool,
) -> Result<Vec<SearchResult>, String> {
    let query_terms = tokenize_search_terms(query);
    if query_terms.is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare("SELECT id, name, query FROM research_folders WHERE (?1 IS NULL OR name = ?1)")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params![folder])
        .map_err(|e| e.to_string())?;

    struct FolderMeta {
        id: i64,
        name: String,
        saved_query: Option<String>,
        name_terms: HashSet<String>,
        saved_query_terms: HashSet<String>,
    }

    let mut folders: Vec<FolderMeta> = Vec::new();
    let mut term_df: HashMap<String, usize> = HashMap::new();

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let name: String = row.get(1).map_err(|e| e.to_string())?;
        let saved_query: Option<String> = row.get(2).map_err(|e| e.to_string())?;

        let name_terms = metadata_term_set(&name);
        let saved_query_terms = metadata_term_set(saved_query.as_deref().unwrap_or(""));

        for qt in &query_terms {
            if name_terms.contains(qt.as_str()) || saved_query_terms.contains(qt.as_str()) {
                *term_df.entry(qt.clone()).or_insert(0) += 1;
            }
        }

        folders.push(FolderMeta {
            id,
            name,
            saved_query,
            name_terms,
            saved_query_terms,
        });
    }

    let total_folders = folders.len() as f64;

    let term_idf: HashMap<String, f64> = query_terms
        .iter()
        .map(|qt| {
            let df = *term_df.get(qt).unwrap_or(&0) as f64;
            let idf = (1.0 + total_folders / (1.0 + df)).ln();
            (qt.clone(), idf)
        })
        .collect();

    let total_idf: f64 = query_terms
        .iter()
        .map(|qt| term_idf.get(qt).unwrap_or(&0.0))
        .sum();

    let mut matches = Vec::new();
    for fm in &folders {
        let mut matched_idf = 0.0;

        for qt in &query_terms {
            if fm.name_terms.contains(qt.as_str()) || fm.saved_query_terms.contains(qt.as_str()) {
                matched_idf += term_idf.get(qt).unwrap_or(&0.0);
            }
        }

        if total_idf == 0.0 || matched_idf == 0.0 {
            continue;
        }

        let ratio = matched_idf / total_idf;

        if strict && ratio < MIN_METADATA_OVERLAP_RATIO {
            continue;
        }

        let score = (0.55 + ratio * 0.43).min(0.98);

        let content = match fm
            .saved_query
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty())
        {
            Some(saved_query) => format!("Folder: {}\nQuery: {}", fm.name, saved_query),
            None => format!("Folder: {}", fm.name),
        };

        matches.push(SearchResult {
            chunk_id: -fm.id,
            content,
            filename: FOLDER_METADATA_FILENAME.to_string(),
            folder_name: fm.name.clone(),
            header_path: None,
            score,
            adjacent_chunks: None,
            snippet: None,
        });
    }

    matches.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(matches)
}

fn metadata_term_set(text: &str) -> HashSet<String> {
    tokenize_search_terms(text).into_iter().collect()
}

fn tokenize_search_terms(text: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut seen = HashSet::new();
    let mut current = String::new();

    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch.to_ascii_lowercase());
        } else {
            push_search_term(&mut terms, &mut seen, &mut current);
        }
    }
    push_search_term(&mut terms, &mut seen, &mut current);

    terms
}

fn push_search_term(terms: &mut Vec<String>, seen: &mut HashSet<String>, current: &mut String) {
    if current.is_empty() {
        return;
    }

    let term = std::mem::take(current);
    if term.len() < 3 && !term.chars().any(|ch| ch.is_ascii_digit()) {
        return;
    }
    if seen.insert(term.clone()) {
        terms.push(term);
    }
}

fn mmr_dedup(
    conn: &Connection,
    fused: &[(i64, f64)],
    _query_embedding: &[f32],
) -> Result<Vec<i64>, String> {
    let mut selected: Vec<i64> = Vec::new();
    let mut selected_embeddings: Vec<Vec<f32>> = Vec::new();

    for (chunk_id, _) in fused {
        let embedding = match get_chunk_embedding(conn, *chunk_id) {
            Ok(e) => e,
            Err(_) => continue,
        };

        let mut too_similar = false;
        for sel_emb in &selected_embeddings {
            let sim = cosine_similarity(&embedding, sel_emb);
            if sim > MMR_SIMILARITY_THRESHOLD {
                too_similar = true;
                break;
            }
        }

        if !too_similar {
            selected.push(*chunk_id);
            selected_embeddings.push(embedding);
        }

        if selected.len() >= 15 {
            break;
        }
    }

    Ok(selected)
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    let mut dot = 0.0_f64;
    let mut norm_a = 0.0_f64;
    let mut norm_b = 0.0_f64;
    for (va, vb) in a.iter().zip(b.iter()) {
        dot += (*va as f64) * (*vb as f64);
        norm_a += (*va as f64) * (*va as f64);
        norm_b += (*vb as f64) * (*vb as f64);
    }
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a.sqrt() * norm_b.sqrt())
}

fn get_chunk_embedding(conn: &Connection, chunk_id: i64) -> Result<Vec<f32>, String> {
    let mut stmt = conn
        .prepare("SELECT embedding FROM chunk_embeddings WHERE rowid = ?1")
        .map_err(|e| e.to_string())?;
    let blob: Vec<u8> = stmt
        .query_row([chunk_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut vec = Vec::with_capacity(blob.len() / 4);
    for chunk in blob.chunks_exact(4) {
        vec.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(vec)
}

fn get_chunk_info(conn: &Connection, chunk_id: i64) -> Result<ChunkInfo, String> {
    conn.query_row(schema::GET_CHUNK_BY_ID, [chunk_id], |row| {
        Ok(ChunkInfo {
            id: row.get(0)?,
            content: row.get(1)?,
            filename: row.get(2)?,
            header_path: row.get(3)?,
            chunk_index: row.get(4)?,
            folder_id: row.get(5)?,
            folder_name: row.get(6)?,
        })
    })
    .map_err(|e| e.to_string())
}

fn get_adjacent_chunks(
    conn: &Connection,
    folder_id: i64,
    filename: &str,
    chunk_index: i32,
) -> Result<Vec<AdjacentChunk>, String> {
    let prev_idx = chunk_index - 1;
    let next_idx = chunk_index + 1;
    let mut results = Vec::new();

    for idx in [prev_idx, next_idx] {
        if idx < 0 {
            continue;
        }
        let result = conn.query_row(
            "SELECT chunk_index, content FROM chunks WHERE folder_id = ?1 AND filename = ?2 AND chunk_index = ?3",
            rusqlite::params![folder_id, filename, idx],
            |row| {
                Ok(AdjacentChunk {
                    chunk_index: row.get(0)?,
                    content: row.get(1)?,
                })
            },
        );
        if let Ok(adj) = result {
            results.push(adj);
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder_metadata_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE research_folders (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              query TEXT,
              created_at TEXT DEFAULT (DATETIME('now'))
            );
            "#,
        )
        .expect("schema");
        conn
    }

    #[test]
    fn fts_query_uses_search_terms_instead_of_an_exact_phrase() {
        assert_eq!(
            sanitize_fts_query("hammock size 11ft vs 12ft for tall person"),
            "\"hammock\" OR \"size\" OR \"11ft\" OR \"12ft\" OR \"for\" OR \"tall\" OR \"person\"",
        );
    }

    #[test]
    fn tokenize_keeps_terms_with_digits_under_3_chars() {
        let terms = tokenize_search_terms("v2 rocket");
        assert!(terms.contains(&"v2".to_string()));
    }

    #[test]
    fn tokenize_keeps_terms_exactly_3_chars() {
        let terms = tokenize_search_terms("the cat sat");
        assert!(terms.contains(&"the".to_string()));
        assert!(terms.contains(&"cat".to_string()));
        assert!(terms.contains(&"sat".to_string()));
    }

    #[test]
    fn tokenize_does_not_require_stop_word_list() {
        let terms = tokenize_search_terms("the and or but from with");
        assert_eq!(terms.len(), 5);
        assert!(terms.contains(&"the".to_string()));
        assert!(terms.contains(&"and".to_string()));
    }

    #[test]
    fn tokenize_filters_short_terms_no_digits() {
        let terms = tokenize_search_terms("a bc de fg hi");
        assert!(terms.is_empty());
    }

    #[test]
    fn tokenize_handles_special_characters() {
        let terms = tokenize_search_terms("hello! world? foo-bar; baz:qux");
        assert_eq!(terms, vec!["hello", "world", "foo", "bar", "baz", "qux"]);
    }

    #[test]
    fn tokenize_lowercases_input() {
        let terms = tokenize_search_terms("Hello WORLD FooBar");
        assert!(terms.contains(&"hello".to_string()));
        assert!(terms.contains(&"world".to_string()));
        assert!(terms.contains(&"foobar".to_string()));
    }

    #[test]
    fn tokenize_empty_input() {
        let terms = tokenize_search_terms("");
        assert!(terms.is_empty());
    }

    #[test]
    fn cosine_identical_vectors() {
        let v = vec![1.0_f32, 2.0_f32, 3.0_f32];
        let result = cosine_similarity(&v, &v);
        assert!((result - 1.0).abs() < 1e-10);
    }

    #[test]
    fn cosine_orthogonal_vectors() {
        let a = vec![1.0_f32, 0.0_f32];
        let b = vec![0.0_f32, 1.0_f32];
        let result = cosine_similarity(&a, &b);
        assert!((result - 0.0).abs() < 1e-10);
    }

    #[test]
    fn cosine_opposite_vectors() {
        let a = vec![1.0_f32, 2.0_f32];
        let b = vec![-1.0_f32, -2.0_f32];
        let result = cosine_similarity(&a, &b);
        assert!((result - (-1.0)).abs() < 1e-10);
    }

    #[test]
    fn cosine_zero_vector() {
        let a = vec![0.0_f32, 0.0_f32];
        let b = vec![1.0_f32, 2.0_f32];
        let result = cosine_similarity(&a, &b);
        assert!((result - 0.0).abs() < 1e-10);
    }

    #[test]
    fn adaptive_rrf_empty_inputs() {
        let result = adaptive_rrf(&[], &[], 1.0, 1.0);
        assert!(result.is_empty());
    }

    #[test]
    fn adaptive_rrf_only_vector_results() {
        let items = vec![RankedItem { chunk_id: 1, rank: 0 }];
        let result = adaptive_rrf(&items, &[], 1.0, 1.0);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, 1);
    }

    #[test]
    fn adaptive_rrf_only_fts_results() {
        let items = vec![RankedItem { chunk_id: 2, rank: 0 }];
        let result = adaptive_rrf(&[], &items, 1.0, 1.0);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, 2);
    }

    #[test]
    fn adaptive_rrf_both_sources_overlapping() {
        let vec_items = vec![RankedItem { chunk_id: 1, rank: 0 }];
        let fts_items = vec![RankedItem { chunk_id: 1, rank: 0 }];
        let result = adaptive_rrf(&vec_items, &fts_items, 1.0, 1.0);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, 1);
    }

    #[test]
    fn adaptive_rrf_higher_rank_gets_lower_score() {
        let items = vec![
            RankedItem { chunk_id: 10, rank: 0 },
            RankedItem { chunk_id: 20, rank: 5 },
        ];
        let result = adaptive_rrf(&items, &[], 1.0, 1.0);
        assert_eq!(result.len(), 2);
        assert!(result[0].1 > result[1].1);
    }

    #[test]
    fn adaptive_rrf_respects_weights() {
        let vec_items = vec![RankedItem { chunk_id: 1, rank: 0 }];
        let fts_items = vec![RankedItem { chunk_id: 1, rank: 0 }];
        let result_weighted = adaptive_rrf(&vec_items, &fts_items, 2.0, 1.0);
        let result_unweighted = adaptive_rrf(&vec_items, &fts_items, 1.0, 1.0);
        assert!(result_weighted[0].1 > result_unweighted[0].1);
    }

    #[test]
    fn folder_metadata_matches_related_folder_names() {
        let conn = folder_metadata_conn();
        conn.execute(
            "INSERT INTO research_folders (name, query) VALUES (?1, ?2)",
            rusqlite::params![
                "fulltime-hammock-sleep-health-impact",
                "health impact of sleeping in a hammock full time",
            ],
        )
        .expect("insert folder");

        let matches =
            folder_metadata_search(&conn, "hammock size 11ft vs 12ft for tall person", None, false)
                .expect("metadata search");

        assert_eq!(
            matches[0].folder_name,
            "fulltime-hammock-sleep-health-impact"
        );
        assert_eq!(matches[0].filename, FOLDER_METADATA_FILENAME);
    }

    #[test]
    fn folder_metadata_respects_folder_scope() {
        let conn = folder_metadata_conn();
        conn.execute(
            "INSERT INTO research_folders (name, query) VALUES (?1, ?2)",
            rusqlite::params!["hammock-health", "hammock sleep"],
        )
        .expect("insert first folder");
        conn.execute(
            "INSERT INTO research_folders (name, query) VALUES (?1, ?2)",
            rusqlite::params!["hammock-sizing", "hammock length"],
        )
        .expect("insert second folder");

        let matches = folder_metadata_search(&conn, "hammock size", Some("hammock-sizing"), false)
            .expect("metadata search");

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].folder_name, "hammock-sizing");
    }
}
