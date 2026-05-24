pub const CREATE_TABLES: &str = r#"
CREATE TABLE IF NOT EXISTS research_folders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  query TEXT,
  created_at TEXT DEFAULT (DATETIME('now'))
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  folder_id INTEGER NOT NULL REFERENCES research_folders(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  header_path TEXT,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (DATETIME('now')),
  UNIQUE(folder_id, filename, chunk_index)
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
  embedding float[1024]
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  content='chunks',
  content_rowid='id',
  tokenize='porter'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
END;
"#;

pub const REBUILD_CHUNKS_FTS: &str = "INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')";

pub const INSERT_CHUNK: &str = r#"
INSERT INTO chunks (folder_id, filename, header_path, chunk_index, content, content_hash)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)
ON CONFLICT(folder_id, filename, chunk_index) DO UPDATE SET
  header_path = excluded.header_path,
  content = excluded.content,
  content_hash = excluded.content_hash;
"#;

pub const INSERT_EMBEDDING: &str = "INSERT INTO chunk_embeddings(rowid, embedding) VALUES (?1, ?2)";

pub const DELETE_EMBEDDING: &str = "DELETE FROM chunk_embeddings WHERE rowid = ?1";

pub const GET_FOLDER_BY_NAME: &str =
    "SELECT id, name, query, created_at FROM research_folders WHERE name = ?1";

pub const INSERT_FOLDER: &str =
    "INSERT INTO research_folders (name, query) VALUES (?1, ?2) RETURNING id";

pub const UPDATE_FOLDER_QUERY_IF_EMPTY: &str = r#"
UPDATE research_folders
SET query = ?2
WHERE id = ?1
  AND TRIM(COALESCE(?2, '')) <> ''
  AND TRIM(COALESCE(query, '')) = ''
"#;

pub const LIST_FOLDERS: &str = r#"
SELECT f.id, f.name, f.query, f.created_at, COUNT(c.id) as chunk_count
FROM research_folders f
LEFT JOIN chunks c ON c.folder_id = f.id
GROUP BY f.id
ORDER BY f.created_at DESC
"#;

pub const KNN_SEARCH: &str = r#"
SELECT rowid, distance
FROM chunk_embeddings
WHERE embedding MATCH ?
ORDER BY distance
LIMIT 50
"#;

pub const FTS_SEARCH: &str = r#"
SELECT rowid, rank
FROM chunks_fts
WHERE chunks_fts MATCH ?
ORDER BY rank
LIMIT 50
"#;

pub const GET_CHUNK_BY_ID: &str = r#"
SELECT c.id, c.content, c.filename, c.header_path, c.chunk_index, c.folder_id, f.name as folder_name
FROM chunks c
JOIN research_folders f ON f.id = c.folder_id
WHERE c.id = ?1
"#;

pub const GET_CHUNK_HASH: &str =
    "SELECT content_hash FROM chunks WHERE folder_id = ?1 AND filename = ?2 AND chunk_index = ?3";

pub const _GET_ADJACENT_CHUNKS: &str = r#"
SELECT chunk_index, content
FROM chunks
WHERE folder_id = ?1 AND filename = ?2 AND chunk_index IN (?3, ?4)
"#;

pub const _GET_CHUNKS_FOR_FOLDER_FILE: &str =
    "SELECT id, chunk_index, content_hash FROM chunks WHERE folder_id = ?1 AND filename = ?2 ORDER BY chunk_index";
