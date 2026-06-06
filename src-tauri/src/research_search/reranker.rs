use crate::research_search::http_client::shared_client;
use serde::Deserialize;

const DEFAULT_BASE_URL: &str = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL: &str = "cohere/rerank-4-pro";
const MAX_RERANK_CANDIDATES: usize = 15;

#[derive(Debug, Clone, Deserialize)]
pub struct RerankerConfig {
    pub api_key: String,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
}

fn default_base_url() -> String {
    DEFAULT_BASE_URL.to_string()
}

fn default_model() -> String {
    DEFAULT_MODEL.to_string()
}

impl Default for RerankerConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: default_base_url(),
            model: default_model(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct RerankResponse {
    results: Vec<RerankResult>,
}

#[derive(Debug, Deserialize)]
struct RerankResult {
    index: usize,
    relevance_score: f64,
}

pub struct RerankedItem {
    pub index: usize,
    pub score: f64,
}

pub fn rerank(
    config: &RerankerConfig,
    query: &str,
    documents: &[String],
) -> Result<Vec<RerankedItem>, String> {
    if documents.is_empty() {
        return Ok(Vec::new());
    }

    let docs: Vec<&str> = documents
        .iter()
        .take(MAX_RERANK_CANDIDATES)
        .map(|s| s.as_str())
        .collect();

    let client = shared_client()?;
    let body = serde_json::json!({
        "model": config.model,
        "query": query,
        "documents": docs,
        "top_n": docs.len(),
    });

    let base_url = config.base_url.trim_end_matches('/');
    let url = format!("{}/rerank", base_url);
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Rerank request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("Rerank API error ({}): {}", status, body));
    }

    let parsed: RerankResponse = response
        .json()
        .map_err(|e| format!("Failed to parse rerank response: {}", e))?;

    let mut results: Vec<RerankedItem> = parsed
        .results
        .into_iter()
        .map(|r| RerankedItem {
            index: r.index,
            score: r.relevance_score,
        })
        .collect();

    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(results)
}
