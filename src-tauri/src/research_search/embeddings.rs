use serde::Deserialize;
use std::time::Duration;

const OPENROUTER_EMBEDDINGS_URL: &str = "https://openrouter.ai/api/v1/embeddings";
const EMBEDDING_MODEL: &str = "qwen/qwen3-embedding-4b";
const EMBEDDING_DIMENSIONS: usize = 1024;
const QUERY_INSTRUCTION_PREFIX: &str = "Represent this sentence for searching relevant passages: ";
const MAX_BATCH_SIZE: usize = 64;
const REQUEST_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

pub fn embed_texts(
    api_key: &str,
    texts: &[String],
    is_query: bool,
) -> Result<Vec<Vec<f32>>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let mut all_embeddings = Vec::with_capacity(texts.len());

    for batch in texts.chunks(MAX_BATCH_SIZE) {
        let inputs: Vec<String> = if is_query {
            batch
                .iter()
                .map(|t| format!("{}{}", QUERY_INSTRUCTION_PREFIX, t))
                .collect()
        } else {
            batch.to_vec()
        };

        let body = serde_json::json!({
            "model": EMBEDDING_MODEL,
            "input": inputs,
            "dimensions": EMBEDDING_DIMENSIONS,
        });

        let response = client
            .post(OPENROUTER_EMBEDDINGS_URL)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| format!("Embedding request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            return Err(format!("Embedding API error ({}): {}", status, body));
        }

        let parsed: EmbeddingResponse = response
            .json()
            .map_err(|e| format!("Failed to parse embedding response: {}", e))?;

        let batch_embeddings: Vec<Vec<f32>> =
            parsed.data.into_iter().map(|d| d.embedding).collect();

        all_embeddings.extend(batch_embeddings);
    }

    Ok(all_embeddings)
}

pub fn embed_query(api_key: &str, query: &str) -> Result<Vec<f32>, String> {
    let results = embed_texts(api_key, &[query.to_string()], true)?;
    results
        .into_iter()
        .next()
        .ok_or_else(|| "No embedding returned for query".to_string())
}
