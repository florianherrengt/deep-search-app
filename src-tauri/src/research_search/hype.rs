use crate::research_search::embeddings::{self, EmbeddingConfig};
use crate::research_search::http_client::shared_client;
use crate::research_search::schema;
use crate::research_search::{serialize_f32_vec, Database};
use rusqlite::Connection;
use serde::Deserialize;

pub const DEFAULT_HYPE_MODEL: &str = "openai/gpt-4o-mini";
const MAX_QUESTIONS_PER_CHUNK: usize = 3;

#[derive(Debug, Clone, Deserialize)]
pub struct HypeConfig {
    pub api_key: String,
    #[serde(default = "default_hype_base_url")]
    pub base_url: String,
    #[serde(default = "default_hype_model")]
    pub model: String,
}

fn default_hype_base_url() -> String {
    "https://openrouter.ai/api/v1".to_string()
}

fn default_hype_model() -> String {
    DEFAULT_HYPE_MODEL.to_string()
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: String,
}

pub fn hype_table_exists(conn: &Connection) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(schema::HYPE_TABLE_EXISTS, [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

pub fn generate_hype_for_folder(
    db: &Database,
    hype_config: &HypeConfig,
    embedding_config: &EmbeddingConfig,
    folder_name: &str,
) -> Result<usize, String> {
    let chunks: Vec<(i64, String)> = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let folder_id: i64 = conn
            .query_row(
                "SELECT id FROM research_folders WHERE name = ?1",
                [folder_name],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare(schema::GET_CHUNKS_WITHOUT_HYPE)
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query([folder_id])
            .map_err(|e| e.to_string())?;
        let mut chunks = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let chunk_id: i64 = row.get(0).map_err(|e| e.to_string())?;
            let content: String = row.get(1).map_err(|e| e.to_string())?;
            chunks.push((chunk_id, content));
        }
        chunks
    };

    if chunks.is_empty() {
        return Ok(0);
    }

    let mut total_questions = 0usize;

    for (chunk_id, content) in &chunks {
        let questions = generate_questions(hype_config, content)?;
        if questions.is_empty() {
            continue;
        }

        let question_embeddings = embeddings::embed_texts(embedding_config, &questions, true)?;

        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

        for (question, embedding) in questions.iter().zip(question_embeddings.iter()) {
            tx.execute(
                schema::INSERT_HYPE_QUESTION,
                rusqlite::params![chunk_id, question],
            )
            .map_err(|e| e.to_string())?;

            let hype_id = tx.last_insert_rowid();
            let emb_bytes = serialize_f32_vec(embedding);

            tx.execute(
                schema::INSERT_HYPE_EMBEDDING,
                rusqlite::params![hype_id, emb_bytes],
            )
            .map_err(|e| e.to_string())?;

            total_questions += 1;
        }

        tx.commit().map_err(|e| e.to_string())?;
    }

    Ok(total_questions)
}

fn generate_questions(config: &HypeConfig, text: &str) -> Result<Vec<String>, String> {
    let client = shared_client()?;
    let base_url = config.base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base_url);

    let truncated = if text.len() > 3000 {
        format!("{}...", &text[..FloorCharBoundary::floor_char_boundary(text, 3000.min(text.len()))])
    } else {
        text.to_string()
    };

    let system_prompt = "\
You generate hypothetical search queries for a research knowledge base. \
Given a chunk of text from a user's past research, generate 1-3 specific, \
natural-language questions that someone might ask where this text would be \
the exact answer. Return ONLY the questions, one per line, no numbering or prefixes.";

    let body = serde_json::json!({
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": format!("Text:\n{}", truncated)}
        ],
        "max_tokens": 200,
        "temperature": 0.3,
    });

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Hype LLM request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("Hype LLM API error ({}): {}", status, body));
    }

    let parsed: ChatResponse = response
        .json()
        .map_err(|e| format!("Failed to parse Hype LLM response: {}", e))?;

    let content = parsed
        .choices
        .first()
        .map(|c| c.message.content.as_str())
        .unwrap_or("");

    let questions: Vec<String> = content
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| {
            l.trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c == '-' || c == ' ')
                .trim()
                .to_string()
        })
        .filter(|l| !l.is_empty())
        .take(MAX_QUESTIONS_PER_CHUNK)
        .collect();

    Ok(questions)
}

pub fn hype_search(conn: &Connection, query_bytes: &[u8]) -> Result<Vec<(i64, f64)>, String> {
    if !hype_table_exists(conn).unwrap_or(false) {
        return Ok(Vec::new());
    }

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM hype_questions", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if count == 0 {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare(schema::HYPE_KNN_SEARCH)
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([query_bytes]).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let chunk_id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let distance: f64 = row.get(1).map_err(|e| e.to_string())?;
        results.push((chunk_id, distance));
    }

    Ok(results)
}

trait FloorCharBoundary {
    fn floor_char_boundary(&self, idx: usize) -> usize;
}

impl FloorCharBoundary for str {
    fn floor_char_boundary(&self, idx: usize) -> usize {
        if idx >= self.len() {
            return self.len();
        }
        let mut end = idx;
        while end > 0 && !self.is_char_boundary(end) {
            end -= 1;
        }
        end
    }
}
