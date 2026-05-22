use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::research_search::chunking;
use crate::research_search::embeddings;
use crate::research_search::{get_folder_id, serialize_f32_vec, ResearchFolder};
use crate::research_search::schema;

pub fn register_folder(
    conn: &Connection,
    name: &str,
    query: &str,
) -> Result<i64, String> {
    if let Some(id) = get_folder_id(conn, name)? {
        return Ok(id);
    }

    let id: i64 = conn
        .query_row(schema::INSERT_FOLDER, rusqlite::params![name, query], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;

    Ok(id)
}

pub fn index_file(
    conn: &Connection,
    api_key: &str,
    folder: &str,
    filename: &str,
    content: &str,
) -> Result<(), String> {
    let folder_id = match get_folder_id(conn, folder)? {
        Some(id) => id,
        None => {
            let id: i64 = conn
                .query_row(
                    schema::INSERT_FOLDER,
                    rusqlite::params![folder, ""],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            id
        }
    };

    let chunks = chunking::chunk_markdown(content);
    if chunks.is_empty() {
        return Ok(());
    }

    let mut new_or_changed: Vec<(usize, String, String)> = Vec::new();

    for chunk in &chunks {
        let hash = compute_hash(&chunk.content);
        let existing_hash: Option<String> = conn
            .query_row(
                schema::GET_CHUNK_HASH,
                rusqlite::params![folder_id, filename, chunk.index as i32],
                |row| row.get(0),
            )
            .ok()
            .flatten();

        match existing_hash {
            Some(h) if h == hash => continue,
            _ => {
                new_or_changed.push((chunk.index, chunk.content.clone(), hash));
            }
        }
    }

    if new_or_changed.is_empty() {
        return Ok(());
    }

    let texts: Vec<String> = new_or_changed.iter().map(|(_, content, _)| content.clone()).collect();
    let all_embeddings = embeddings::embed_texts(api_key, &texts, false)?;

    for (i, (chunk_index, content, hash)) in new_or_changed.iter().enumerate() {
        let chunk = &chunks[*chunk_index];
        let header_path = chunk.header_path.as_deref();

        conn.execute(
            schema::INSERT_CHUNK,
            rusqlite::params![folder_id, filename, header_path, *chunk_index as i32, content, hash],
        )
        .map_err(|e| e.to_string())?;

        let chunk_id: i64 = conn.last_insert_rowid();

        let old_id = find_existing_chunk_id(conn, folder_id, filename, *chunk_index as i32)?;
        let actual_id = old_id.unwrap_or(chunk_id);

        if let Some(emb) = all_embeddings.get(i) {
            let emb_bytes = serialize_f32_vec(emb);

            let _ = conn.execute(schema::DELETE_EMBEDDING, rusqlite::params![actual_id]);
            conn.execute(
                schema::INSERT_EMBEDDING,
                rusqlite::params![actual_id, emb_bytes],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn find_existing_chunk_id(
    conn: &Connection,
    folder_id: i64,
    filename: &str,
    chunk_index: i32,
) -> Result<Option<i64>, String> {
    let result = conn.query_row(
        "SELECT id FROM chunks WHERE folder_id = ?1 AND filename = ?2 AND chunk_index = ?3",
        rusqlite::params![folder_id, filename, chunk_index],
        |row| row.get::<_, i64>(0),
    );
    match result {
        Ok(id) => Ok(Some(id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn list_folders(conn: &Connection) -> Result<Vec<ResearchFolder>, String> {
    let mut stmt = conn
        .prepare(schema::LIST_FOLDERS)
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

    let mut folders = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        folders.push(ResearchFolder {
            id: row.get(0).map_err(|e| e.to_string())?,
            name: row.get(1).map_err(|e| e.to_string())?,
            query: row.get(2).map_err(|e| e.to_string())?,
            created_at: row.get(3).map_err(|e| e.to_string())?,
            chunk_count: row.get(4).map_err(|e| e.to_string())?,
        });
    }
    Ok(folders)
}

fn compute_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}
