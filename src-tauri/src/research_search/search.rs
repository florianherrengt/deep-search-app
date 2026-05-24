use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

use crate::research_search::embeddings;
use crate::research_search::reranker;
use crate::research_search::schema;
use crate::research_search::{serialize_f32_vec, AdjacentChunk, SearchResult};

const RRF_K: f64 = 60.0;
const MMR_SIMILARITY_THRESHOLD: f64 = 0.85;
const FOLDER_METADATA_FILENAME: &str = "folder-metadata";
const SEARCH_STOP_WORDS: &[&str] = &[
    "about", "after", "also", "and", "are", "but", "can", "did", "does", "for", "from", "had",
    "has", "have", "how", "into", "not", "off", "or", "out", "the", "their", "then", "there",
    "these", "this", "was", "what", "when", "where", "which", "who", "why", "with", "you", "your",
];

struct RankedItem {
    chunk_id: i64,
    rank: usize,
}

struct ChunkInfo {
    id: i64,
    content: String,
    filename: String,
    header_path: Option<String>,
    chunk_index: i32,
    folder_id: i64,
    folder_name: String,
}

pub fn search(
    conn: &Connection,
    api_key: &str,
    query: &str,
    folder: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<SearchResult>, String> {
    let limit = limit.unwrap_or(8) as usize;

    let query_embedding = embeddings::embed_query(api_key, query)?;
    let query_bytes = serialize_f32_vec(&query_embedding);

    let vec_results = knn_search(conn, &query_bytes)?;
    let fts_results = fts_search(conn, query)?;

    let fused = adaptive_rrf(&vec_results, &fts_results);

    let mut fused = fused;
    if let Some(folder_name) = folder {
        filter_by_folder(conn, &mut fused, folder_name)?;
    }

    let diverse = mmr_dedup(conn, &fused, &query_embedding)?;
    let candidates: Vec<(i64, String)> = diverse
        .iter()
        .take(15)
        .filter_map(|id| {
            let info = get_chunk_info(conn, *id).ok()?;
            Some((*id, info.content))
        })
        .collect();

    let mut chunk_results = Vec::new();
    if !candidates.is_empty() {
        let (ids, docs): (Vec<i64>, Vec<String>) = candidates.into_iter().unzip();

        let reranked = reranker::rerank(api_key, query, &docs)?;
        let scored: Vec<(i64, f64)> = reranked
            .into_iter()
            .filter(|item| item.score >= 0.5)
            .take(limit)
            .map(|item| (ids[item.index], item.score))
            .collect();

        chunk_results = Vec::with_capacity(scored.len());
        for (id, score) in scored {
            if let Ok(info) = get_chunk_info(conn, id) {
                let adjacent =
                    get_adjacent_chunks(conn, info.folder_id, &info.filename, info.chunk_index)
                        .ok();

                chunk_results.push(SearchResult {
                    chunk_id: info.id,
                    content: info.content,
                    filename: info.filename,
                    folder_name: info.folder_name,
                    header_path: info.header_path,
                    score,
                    adjacent_chunks: adjacent,
                });
            }
        }
    }

    let mut results = folder_metadata_search(conn, query, folder)?;
    results.extend(chunk_results);
    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(limit);

    Ok(results)
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
        let distance: f64 = row.get(1).map_err(|e| e.to_string())?;
        if distance > 1.2 {
            break;
        }
        results.push(RankedItem { chunk_id, rank });
        rank += 1;
    }
    Ok(results)
}

fn fts_search(conn: &Connection, query: &str) -> Result<Vec<RankedItem>, String> {
    let sanitized = sanitize_fts_query(query);
    if sanitized.is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare(schema::FTS_SEARCH)
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query([sanitized.as_str()])
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

fn adaptive_rrf(vec_results: &[RankedItem], fts_results: &[RankedItem]) -> Vec<(i64, f64)> {
    let mut scores: HashMap<i64, f64> = HashMap::new();

    for item in vec_results {
        let score = 1.0 / (RRF_K + item.rank as f64 + 1.0);
        *scores.entry(item.chunk_id).or_insert(0.0) += score;
    }

    for item in fts_results {
        let score = 1.0 / (RRF_K + item.rank as f64 + 1.0);
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

    let mut matches = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let name: String = row.get(1).map_err(|e| e.to_string())?;
        let saved_query: Option<String> = row.get(2).map_err(|e| e.to_string())?;

        let name_terms = metadata_term_set(&name);
        let saved_query_terms = metadata_term_set(saved_query.as_deref().unwrap_or(""));
        let name_matches = count_matching_terms(&query_terms, &name_terms);
        let query_matches = count_matching_terms(&query_terms, &saved_query_terms);

        if name_matches == 0 && query_matches == 0 {
            continue;
        }

        let matched_terms = (name_matches + query_matches).max(1) as f64;
        let weighted_ratio =
            ((name_matches as f64 * 1.25) + query_matches as f64) / query_terms.len() as f64;
        let name_boost = if name_matches > 0 { 0.08 } else { 0.0 };
        let score = (0.45 + weighted_ratio.min(1.0) * 0.45 + name_boost)
            .max(0.55 + (matched_terms.min(3.0) * 0.03))
            .min(0.98);

        let content = match saved_query
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty())
        {
            Some(saved_query) => format!("Folder: {}\nQuery: {}", name, saved_query),
            None => format!("Folder: {}", name),
        };

        matches.push(SearchResult {
            chunk_id: -id,
            content,
            filename: FOLDER_METADATA_FILENAME.to_string(),
            folder_name: name,
            header_path: None,
            score,
            adjacent_chunks: None,
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

fn count_matching_terms(query_terms: &[String], document_terms: &HashSet<String>) -> usize {
    query_terms
        .iter()
        .filter(|term| document_terms.contains(*term))
        .count()
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
    if SEARCH_STOP_WORDS.contains(&term.as_str()) {
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
            "\"hammock\" OR \"size\" OR \"11ft\" OR \"12ft\" OR \"tall\" OR \"person\"",
        );
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
            folder_metadata_search(&conn, "hammock size 11ft vs 12ft for tall person", None)
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

        let matches = folder_metadata_search(&conn, "hammock size", Some("hammock-sizing"))
            .expect("metadata search");

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].folder_name, "hammock-sizing");
    }
}
