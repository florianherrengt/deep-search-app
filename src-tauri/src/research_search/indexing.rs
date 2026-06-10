use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::path::Path;

use crate::research_search::chunking;
use crate::research_search::embeddings::{self, EmbeddingConfig};
use crate::research_search::schema;
use crate::research_search::{get_folder_id, serialize_f32_vec, Database, ResearchFolder};

pub fn register_folder(conn: &Connection, name: &str, query: &str) -> Result<i64, String> {
    if let Some(id) = get_folder_id(conn, name)? {
        conn.execute(
            schema::UPDATE_FOLDER_QUERY_IF_EMPTY,
            rusqlite::params![id, query],
        )
        .map_err(|e| e.to_string())?;
        return Ok(id);
    }

    let id: i64 = conn
        .query_row(
            schema::INSERT_FOLDER,
            rusqlite::params![name, query],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(id)
}

pub fn rename_folder(conn: &Connection, old_name: &str, new_name: &str) -> Result<(), String> {
    if old_name == new_name {
        return Ok(());
    }

    let Some(old_id) = get_folder_id(conn, old_name)? else {
        return Ok(());
    };

    if let Some(new_id) = get_folder_id(conn, new_name)? {
        if new_id != old_id {
            delete_folder(conn, new_name)?;
        }
    }

    conn.execute(
        schema::UPDATE_FOLDER_NAME,
        rusqlite::params![old_id, new_name],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn delete_folder(conn: &Connection, name: &str) -> Result<(), String> {
    let Some(folder_id) = get_folder_id(conn, name)? else {
        return Ok(());
    };

    let chunk_ids = get_folder_chunk_ids(conn, folder_id)?;
    conn.execute("BEGIN", []).map_err(|e| e.to_string())?;
    for id in &chunk_ids {
        let _ = conn.execute(schema::DELETE_EMBEDDING, rusqlite::params![id]);
    }
    conn.execute(schema::DELETE_FOLDER_CHUNKS, rusqlite::params![folder_id])
        .map_err(|e| e.to_string())?;
    conn.execute(schema::DELETE_FOLDER, rusqlite::params![folder_id])
        .map_err(|e| e.to_string())?;
    conn.execute("COMMIT", []).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn sync_folders_from_dir(conn: &Connection, search_results_dir: &Path) -> Result<(), String> {
    if !search_results_dir.exists() {
        return Ok(());
    }

    let entries = std::fs::read_dir(search_results_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let Some(folder_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };

        if folder_name.is_empty() {
            continue;
        }

        register_folder(conn, folder_name, "")?;
    }

    Ok(())
}

struct PendingChunk {
    chunk_index: usize,
    content: String,
    hash: String,
    header_path: Option<String>,
}

pub fn index_file(
    db: &Database,
    embedding_config: &EmbeddingConfig,
    folder: &str,
    filename: &str,
    content: &str,
) -> Result<(), String> {
    index_file_inner(db, embedding_config, folder, filename, content, None)
}

pub fn index_file_inner(
    db: &Database,
    embedding_config: &EmbeddingConfig,
    folder: &str,
    filename: &str,
    content: &str,
    cached_embeddings: Option<&std::collections::HashMap<String, Vec<f32>>>,
) -> Result<(), String> {
    let _index_guard = db.indexing.lock().map_err(|e| e.to_string())?;
    let (folder_id, new_or_changed, orphan_ids, new_chunk_count) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let folder_id = match get_folder_id(&conn, folder)? {
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

        let mut chunks = chunking::chunk_markdown(content);

        if chunks.is_empty() {
            delete_file_chunks(&conn, folder_id, filename)?;
            return Ok(());
        }

        let folder_metadata = format!("[From: '{}']", folder);
        for chunk in &mut chunks {
            chunk.content = format!("{}\n\n{}", folder_metadata, chunk.content);
        }

        let new_chunk_count = chunks.len() as i32;

        let mut new_or_changed: Vec<PendingChunk> = Vec::new();

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
                    new_or_changed.push(PendingChunk {
                        chunk_index: chunk.index,
                        content: chunk.content.clone(),
                        hash,
                        header_path: chunk.header_path.clone(),
                    });
                }
            }
        }

        let orphan_ids = get_chunk_ids_above_index(&conn, folder_id, filename, new_chunk_count)?;

        (folder_id, new_or_changed, orphan_ids, new_chunk_count)
    };

    if new_or_changed.is_empty() && orphan_ids.is_empty() {
        return Ok(());
    }

    let all_embeddings = if new_or_changed.is_empty() {
        Vec::new()
    } else if let Some(cache) = cached_embeddings {
        new_or_changed
            .iter()
            .map(|p| {
                cache
                    .get(&p.hash)
                    .cloned()
                    .ok_or_else(|| format!("Missing cached embedding for hash {}", &p.hash))
            })
            .collect::<Result<Vec<_>, _>>()?
    } else {
        let texts: Vec<String> = new_or_changed.iter().map(|p| p.content.clone()).collect();
        embeddings::embed_texts(embedding_config, &texts, false)?
    };

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let result = index_file_commit(
        &tx,
        folder_id,
        filename,
        &new_or_changed,
        &all_embeddings,
        &orphan_ids,
        new_chunk_count,
    );

    match result {
        Ok(()) => tx.commit().map_err(|e| e.to_string()),
        Err(e) => {
            let _ = tx.rollback();
            Err(e)
        }
    }
}

fn index_file_commit(
    conn: &Connection,
    folder_id: i64,
    filename: &str,
    new_or_changed: &[PendingChunk],
    all_embeddings: &[Vec<f32>],
    orphan_ids: &[i64],
    new_chunk_count: i32,
) -> Result<(), String> {
    for id in orphan_ids {
        let _ = conn.execute(schema::DELETE_EMBEDDING, rusqlite::params![id]);
    }
    if !orphan_ids.is_empty() {
        conn.execute(
            schema::DELETE_CHUNKS_ABOVE_INDEX,
            rusqlite::params![folder_id, filename, new_chunk_count],
        )
        .map_err(|e| e.to_string())?;
    }

    for (i, chunk) in new_or_changed.iter().enumerate() {
        let header_path = chunk.header_path.as_deref();

        conn.execute(
            schema::INSERT_CHUNK,
            rusqlite::params![
                folder_id,
                filename,
                header_path,
                chunk.chunk_index as i32,
                &chunk.content,
                &chunk.hash
            ],
        )
        .map_err(|e| e.to_string())?;

        let chunk_id: i64 = conn.last_insert_rowid();

        let old_id = find_existing_chunk_id(conn, folder_id, filename, chunk.chunk_index as i32)?;
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

pub fn delete_file_chunks(conn: &Connection, folder_id: i64, filename: &str) -> Result<(), String> {
    let ids = get_file_chunk_ids(conn, folder_id, filename)?;

    if ids.is_empty() {
        return Ok(());
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    for id in &ids {
        let _ = tx.execute(schema::DELETE_EMBEDDING, rusqlite::params![id]);
    }
    match tx.execute(
        schema::DELETE_FILE_CHUNKS,
        rusqlite::params![folder_id, filename],
    ) {
        Ok(_) => tx.commit().map_err(|e| e.to_string()),
        Err(e) => {
            let _ = tx.rollback();
            Err(e.to_string())
        }
    }
}

fn get_file_chunk_ids(
    conn: &Connection,
    folder_id: i64,
    filename: &str,
) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare(schema::GET_FILE_CHUNK_IDS)
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params![folder_id, filename])
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        ids.push(row.get(0).map_err(|e| e.to_string())?);
    }
    Ok(ids)
}

fn get_chunk_ids_above_index(
    conn: &Connection,
    folder_id: i64,
    filename: &str,
    max_index: i32,
) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare(schema::GET_CHUNK_IDS_ABOVE_INDEX)
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params![folder_id, filename, max_index])
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        ids.push(row.get(0).map_err(|e| e.to_string())?);
    }
    Ok(ids)
}

fn get_folder_chunk_ids(conn: &Connection, folder_id: i64) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare(schema::GET_FOLDER_CHUNK_IDS)
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params![folder_id])
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        ids.push(row.get(0).map_err(|e| e.to_string())?);
    }
    Ok(ids)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_search::schema;

    fn test_db() -> Connection {
        crate::research_search::register_sqlite_vec_extension();
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn.execute_batch(&schema::create_tables_sql(schema::DEFAULT_DIMENSIONS))
            .unwrap();
        conn
    }

    fn insert_test_folder(conn: &Connection, name: &str) -> i64 {
        conn.query_row(
            schema::INSERT_FOLDER,
            rusqlite::params![name, "test query"],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn insert_test_chunk(
        conn: &Connection,
        folder_id: i64,
        filename: &str,
        chunk_index: i32,
        content: &str,
    ) -> i64 {
        let hash = compute_hash(content);
        conn.execute(
            schema::INSERT_CHUNK,
            rusqlite::params![
                folder_id,
                filename,
                None::<String>,
                chunk_index,
                content,
                hash
            ],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn count_chunks(conn: &Connection, folder_id: i64, filename: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM chunks WHERE folder_id = ?1 AND filename = ?2",
            rusqlite::params![folder_id, filename],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn get_chunk_indices(conn: &Connection, folder_id: i64, filename: &str) -> Vec<i32> {
        let mut stmt = conn
            .prepare("SELECT chunk_index FROM chunks WHERE folder_id = ?1 AND filename = ?2 ORDER BY chunk_index")
            .unwrap();
        let mut rows = stmt.query(rusqlite::params![folder_id, filename]).unwrap();
        let mut indices = Vec::new();
        while let Some(row) = rows.next().unwrap() {
            indices.push(row.get(0).unwrap());
        }
        indices
    }

    #[test]
    fn rename_folder_updates_existing_index_row() {
        let conn = test_db();
        let folder_id = insert_test_folder(&conn, "2026-05-22_10-11-12");

        rename_folder(&conn, "2026-05-22_10-11-12", "market-map").unwrap();

        assert_eq!(get_folder_id(&conn, "2026-05-22_10-11-12").unwrap(), None);
        assert_eq!(get_folder_id(&conn, "market-map").unwrap(), Some(folder_id));
    }

    #[test]
    fn delete_folder_removes_folder_and_chunks() {
        let conn = test_db();
        let folder_id = insert_test_folder(&conn, "market-map");
        insert_test_chunk(&conn, folder_id, "notes.md", 0, "chunk 0");
        insert_test_chunk(&conn, folder_id, "notes.md", 1, "chunk 1");

        delete_folder(&conn, "market-map").unwrap();

        assert_eq!(get_folder_id(&conn, "market-map").unwrap(), None);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chunks WHERE folder_id = ?1",
                rusqlite::params![folder_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn empty_content_deletes_all_chunks() {
        let conn = test_db();
        let folder_id = insert_test_folder(&conn, "test-folder");

        let _id1 = insert_test_chunk(&conn, folder_id, "notes.md", 0, "chunk 0");
        let _id2 = insert_test_chunk(&conn, folder_id, "notes.md", 1, "chunk 1");
        let _id3 = insert_test_chunk(&conn, folder_id, "notes.md", 2, "chunk 2");

        assert_eq!(count_chunks(&conn, folder_id, "notes.md"), 3);

        delete_file_chunks(&conn, folder_id, "notes.md").unwrap();

        assert_eq!(count_chunks(&conn, folder_id, "notes.md"), 0);
    }

    #[test]
    fn shorter_file_deletes_orphaned_chunks() {
        let conn = test_db();
        let folder_id = insert_test_folder(&conn, "test-folder");

        insert_test_chunk(&conn, folder_id, "notes.md", 0, "chunk 0");
        insert_test_chunk(&conn, folder_id, "notes.md", 1, "chunk 1");
        insert_test_chunk(&conn, folder_id, "notes.md", 2, "chunk 2");
        insert_test_chunk(&conn, folder_id, "notes.md", 3, "chunk 3");

        assert_eq!(count_chunks(&conn, folder_id, "notes.md"), 4);

        let orphan_ids = get_chunk_ids_above_index(&conn, folder_id, "notes.md", 3).unwrap();
        assert_eq!(orphan_ids.len(), 1);

        conn.execute("BEGIN", []).unwrap();
        for id in &orphan_ids {
            let _ = conn.execute(schema::DELETE_EMBEDDING, rusqlite::params![id]);
        }
        conn.execute(
            schema::DELETE_CHUNKS_ABOVE_INDEX,
            rusqlite::params![folder_id, "notes.md", 3],
        )
        .unwrap();
        conn.execute("COMMIT", []).unwrap();

        assert_eq!(count_chunks(&conn, folder_id, "notes.md"), 3);
        assert_eq!(
            get_chunk_indices(&conn, folder_id, "notes.md"),
            vec![0, 1, 2]
        );
    }

    #[test]
    fn same_length_file_preserves_all_chunks() {
        let conn = test_db();
        let folder_id = insert_test_folder(&conn, "test-folder");

        insert_test_chunk(&conn, folder_id, "notes.md", 0, "chunk 0");
        insert_test_chunk(&conn, folder_id, "notes.md", 1, "chunk 1");
        insert_test_chunk(&conn, folder_id, "notes.md", 2, "chunk 2");

        let orphan_ids = get_chunk_ids_above_index(&conn, folder_id, "notes.md", 3).unwrap();
        assert!(orphan_ids.is_empty());

        assert_eq!(count_chunks(&conn, folder_id, "notes.md"), 3);
    }

    #[test]
    fn delete_only_affects_target_file() {
        let conn = test_db();
        let folder_id = insert_test_folder(&conn, "test-folder");

        insert_test_chunk(&conn, folder_id, "notes.md", 0, "notes 0");
        insert_test_chunk(&conn, folder_id, "notes.md", 1, "notes 1");
        insert_test_chunk(&conn, folder_id, "other.md", 0, "other 0");
        insert_test_chunk(&conn, folder_id, "other.md", 1, "other 1");

        delete_file_chunks(&conn, folder_id, "notes.md").unwrap();

        assert_eq!(count_chunks(&conn, folder_id, "notes.md"), 0);
        assert_eq!(count_chunks(&conn, folder_id, "other.md"), 2);
    }

    #[test]
    fn delete_empty_file_is_noop() {
        let conn = test_db();
        let folder_id = insert_test_folder(&conn, "test-folder");

        insert_test_chunk(&conn, folder_id, "notes.md", 0, "chunk 0");

        let result = delete_file_chunks(&conn, folder_id, "nonexistent.md");
        assert!(result.is_ok());
        assert_eq!(count_chunks(&conn, folder_id, "notes.md"), 1);
    }

    #[test]
    fn reindex_from_many_to_one() {
        let conn = test_db();
        let folder_id = insert_test_folder(&conn, "test-folder");

        for i in 0..5 {
            insert_test_chunk(&conn, folder_id, "doc.md", i, &format!("chunk {}", i));
        }
        assert_eq!(count_chunks(&conn, folder_id, "doc.md"), 5);

        let orphan_ids = get_chunk_ids_above_index(&conn, folder_id, "doc.md", 1).unwrap();
        assert_eq!(orphan_ids.len(), 4);

        conn.execute("BEGIN", []).unwrap();
        for id in &orphan_ids {
            let _ = conn.execute(schema::DELETE_EMBEDDING, rusqlite::params![id]);
        }
        conn.execute(
            schema::DELETE_CHUNKS_ABOVE_INDEX,
            rusqlite::params![folder_id, "doc.md", 1],
        )
        .unwrap();
        conn.execute("COMMIT", []).unwrap();

        assert_eq!(count_chunks(&conn, folder_id, "doc.md"), 1);
        assert_eq!(get_chunk_indices(&conn, folder_id, "doc.md"), vec![0]);
    }

    #[test]
    fn register_folder_with_empty_name() {
        let conn = test_db();
        let id = register_folder(&conn, "", "some query").unwrap();

        assert!(id > 0);
        assert_eq!(get_folder_id(&conn, "").unwrap(), Some(id));
    }

    #[test]
    fn register_folder_idempotent() {
        let conn = test_db();
        let id1 = register_folder(&conn, "idem-folder", "query v1").unwrap();
        let id2 = register_folder(&conn, "idem-folder", "query v2").unwrap();

        assert_eq!(id1, id2);
        assert!(get_folder_id(&conn, "idem-folder").unwrap().is_some());
    }
}
