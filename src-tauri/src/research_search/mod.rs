pub mod chunking;
pub mod embeddings;
pub mod indexing;
pub mod reranker;
pub mod schema;
pub mod search;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
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
    unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    }

    let db_path = app_data_dir.join("research.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;

    conn.execute_batch(schema::CREATE_TABLES)
        .map_err(|e| e.to_string())?;
    conn.execute(schema::REBUILD_CHUNKS_FTS, [])
        .map_err(|e| e.to_string())?;

    Ok(Database {
        conn: Mutex::new(conn),
    })
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
