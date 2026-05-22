use rusqlite::Connection;

use crate::research_search::embeddings;
use crate::research_search::reranker;
use crate::research_search::schema;
use crate::research_search::{serialize_f32_vec, AdjacentChunk, SearchResult};

const RRF_K: f64 = 60.0;
const MMR_SIMILARITY_THRESHOLD: f64 = 0.85;

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

    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let (ids, docs): (Vec<i64>, Vec<String>) = candidates.into_iter().unzip();

    let reranked = reranker::rerank(api_key, query, &docs)?;
    let scored: Vec<(i64, f64)> = reranked
        .into_iter()
        .filter(|item| item.score >= 0.5)
        .take(limit)
        .map(|item| (ids[item.index], item.score))
        .collect();

    let mut results = Vec::with_capacity(scored.len());
    for (id, score) in scored {
        if let Ok(info) = get_chunk_info(conn, id) {
            let adjacent = get_adjacent_chunks(
                conn,
                info.folder_id,
                &info.filename,
                info.chunk_index,
            )
            .ok();

            results.push(SearchResult {
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
    let escaped = query.replace('"', "\"\"");
    format!("\"{}\"", escaped)
}

fn adaptive_rrf(
    vec_results: &[RankedItem],
    fts_results: &[RankedItem],
) -> Vec<(i64, f64)> {
    let mut scores: std::collections::HashMap<i64, f64> = std::collections::HashMap::new();

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

    let mut valid_ids = std::collections::HashSet::new();
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
