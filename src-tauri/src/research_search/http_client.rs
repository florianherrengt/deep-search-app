use std::sync::OnceLock;
use std::time::Duration;

const REQUEST_TIMEOUT_SECS: u64 = 30;

static HTTP_CLIENT: OnceLock<Result<reqwest::blocking::Client, String>> = OnceLock::new();

/// Returns a process-wide shared reqwest::blocking::Client.
/// Reusing one client (with its connection pool) is significantly faster
/// than constructing a new one per request.
pub fn shared_client() -> Result<&'static reqwest::blocking::Client, String> {
    let result = HTTP_CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))
    });
    result.as_ref().map_err(|e| e.clone())
}
