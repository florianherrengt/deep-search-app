use serde::Deserialize;
use std::time::Duration;

const DEFAULT_BASE_URL: &str = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL: &str = "qwen/qwen3-embedding-4b";
const DEFAULT_DIMENSIONS: usize = 1024;
const DEFAULT_QUERY_PREFIX: &str = "Represent this sentence for searching relevant passages: ";
const MAX_BATCH_SIZE: usize = 64;
const REQUEST_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Deserialize)]
pub struct EmbeddingConfig {
    pub api_key: String,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_dimensions")]
    pub dimensions: usize,
    #[serde(default = "default_query_prefix")]
    pub query_prefix: String,
}

fn default_base_url() -> String {
    DEFAULT_BASE_URL.to_string()
}

fn default_model() -> String {
    DEFAULT_MODEL.to_string()
}

fn default_dimensions() -> usize {
    DEFAULT_DIMENSIONS
}

fn default_query_prefix() -> String {
    DEFAULT_QUERY_PREFIX.to_string()
}

impl Default for EmbeddingConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: default_base_url(),
            model: default_model(),
            dimensions: default_dimensions(),
            query_prefix: default_query_prefix(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

pub fn embed_texts(
    config: &EmbeddingConfig,
    texts: &[String],
    is_query: bool,
) -> Result<Vec<Vec<f32>>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let mut all_embeddings = Vec::with_capacity(texts.len());

    let base_url = config.base_url.trim_end_matches('/');
    let url = format!("{}/embeddings", base_url);

    for batch in texts.chunks(MAX_BATCH_SIZE) {
        let inputs: Vec<String> = if is_query {
            batch
                .iter()
                .map(|t| format!("{}{}", config.query_prefix, t))
                .collect()
        } else {
            batch.to_vec()
        };

        let body = serde_json::json!({
            "model": config.model,
            "input": inputs,
            "dimensions": config.dimensions,
        });

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key))
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

pub fn embed_query(config: &EmbeddingConfig, query: &str) -> Result<Vec<f32>, String> {
    let results = embed_texts(config, &[query.to_string()], true)?;
    results
        .into_iter()
        .next()
        .ok_or_else(|| "No embedding returned for query".to_string())
}
