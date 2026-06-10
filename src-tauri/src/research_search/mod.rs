pub mod chunking;
pub mod embeddings;
pub mod http_client;
pub mod hype;
pub mod indexing;
pub mod reranker;
pub mod schema;
pub mod search;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::os::raw::{c_char, c_int};
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
    pub indexing: Mutex<()>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub chunk_id: i64,
    pub content: String,
    pub filename: String,
    pub folder_name: String,
    pub header_path: Option<String>,
    pub score: f64,
    pub adjacent_chunks: Option<Vec<AdjacentChunk>>,
    #[serde(default)]
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SearchDiagnostics {
    pub query: String,
    pub knn_candidate_count: usize,
    pub fts_candidate_count: usize,
    pub fused_candidate_count: usize,
    pub mmr_candidate_count: usize,
    pub reranked_candidate_count: usize,
    pub metadata_match_count: usize,
    pub final_result_count: usize,
    pub reranker_threshold: f64,
    pub latency_stage_ms: StageLatencies,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchWithDiagnostics {
    pub results: Vec<SearchResult>,
    pub diagnostics: Vec<SearchDiagnostics>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StageLatencies {
    pub total_ms: u64,
    pub embedding_ms: u64,
    pub knn_ms: u64,
    pub fts_ms: u64,
    pub rrf_ms: u64,
    pub mmr_ms: u64,
    pub reranker_ms: u64,
    pub metadata_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AdjacentChunk {
    pub chunk_index: i32,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResearchFolder {
    pub id: i64,
    pub name: String,
    pub query: Option<String>,
    pub created_at: String,
    pub chunk_count: i64,
}

pub fn init_database(app_data_dir: &std::path::Path) -> Result<Database, String> {
    init_database_with_dimensions(app_data_dir, schema::DEFAULT_DIMENSIONS)
}

pub fn init_database_memory(dimensions: usize) -> Result<Database, String> {
    register_sqlite_vec_extension();

    let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;

    conn.execute_batch(&schema::create_tables_sql(dimensions))
        .map_err(|e| e.to_string())?;
    conn.execute(schema::REBUILD_CHUNKS_FTS, [])
        .map_err(|e| e.to_string())?;

    Ok(Database {
        conn: Mutex::new(conn),
        indexing: Mutex::new(()),
    })
}

pub fn init_database_with_dimensions(
    app_data_dir: &std::path::Path,
    dimensions: usize,
) -> Result<Database, String> {
    register_sqlite_vec_extension();

    let db_path = app_data_dir.join("research.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;

    conn.execute_batch(&schema::create_tables_sql(dimensions))
        .map_err(|e| e.to_string())?;
    conn.execute(schema::REBUILD_CHUNKS_FTS, [])
        .map_err(|e| e.to_string())?;

    Ok(Database {
        conn: Mutex::new(conn),
        indexing: Mutex::new(()),
    })
}

pub fn register_sqlite_vec_extension() {
    type SqliteExtensionInit = unsafe extern "C" fn(
        *mut rusqlite::ffi::sqlite3,
        *mut *const c_char,
        *const rusqlite::ffi::sqlite3_api_routines,
    ) -> c_int;

    unsafe {
        let init = std::mem::transmute::<*const (), SqliteExtensionInit>(
            sqlite_vec::sqlite3_vec_init as *const (),
        );
        rusqlite::ffi::sqlite3_auto_extension(Some(init));
    }
}

pub fn get_folder_id(conn: &Connection, name: &str) -> Result<Option<i64>, String> {
    let mut stmt = conn
        .prepare(schema::GET_FOLDER_BY_NAME)
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([name]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(Some(row.get(0).map_err(|e| e.to_string())?))
    } else {
        Ok(None)
    }
}

pub fn serialize_f32_vec(vec: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vec.len() * 4);
    for &f in vec {
        bytes.extend_from_slice(&f.to_le_bytes());
    }
    bytes
}
