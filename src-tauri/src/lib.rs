mod research_search;

use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::mpsc;
use std::time::Duration;

use reqwest::header::{ACCEPT, CONTENT_TYPE, LOCATION, USER_AGENT};
use research_search::{Database, ResearchFolder, SearchResult};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

const TAB_BAR_HEIGHT: f64 = 40.0;
const PAGE_LOAD_TIMEOUT_SECS: u64 = 30;
const EVAL_RECV_TIMEOUT_SECS: u64 = 5;
const FETCH_TIMEOUT_SECS: u64 = 10;
const MAX_FETCH_REDIRECTS: usize = 5;
const MAX_HTML_BYTES: usize = 5 * 1024 * 1024;
const MAX_JSON_BYTES: usize = 1024 * 1024;

#[tauri::command]
async fn open_tab(app: AppHandle, url: String, id: String) -> Result<(), String> {
    let window = app.get_window("main").ok_or("no main window")?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let physical = window.inner_size().map_err(|e| e.to_string())?;
    let logical = physical.to_logical::<f64>(scale);

    let parsed_url = validate_external_url(&url).await?;
    let wv = WebviewBuilder::new(&id, WebviewUrl::External(parsed_url))
        .on_navigation(|url| validate_url_components(url).is_ok());

    window
        .add_child(
            wv,
            LogicalPosition::new(0.0, TAB_BAR_HEIGHT),
            LogicalSize::new(logical.width, logical.height - TAB_BAR_HEIGHT),
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn switch_tab(app: AppHandle, id: String) -> Result<(), String> {
    for (_label, wv) in app.webviews() {
        if wv.label() == "main" {
            continue;
        }
        if wv.label() == id {
            let _ = wv.show();
        } else {
            let _ = wv.hide();
        }
    }
    Ok(())
}

#[tauri::command]
fn close_tab(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&id) {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn extract_content(app: AppHandle, id: String) -> Result<String, String> {
    let wv = app.get_webview(&id).ok_or("webview not found")?;

    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(PAGE_LOAD_TIMEOUT_SECS);
    loop {
        let (tx, rx) = mpsc::channel::<String>();
        if let Ok(()) = wv.eval_with_callback(
            r##"(function(){
                var text = (document.body && document.body.innerText || "").toLowerCase();
                var hasOldRedditPost = location.hostname === "old.reddit.com" && !!document.querySelector(".thing.link p.title > a.title");
                var hasChallenge =
                    !!document.querySelector("#challenge-form, .g-recaptcha, .h-captcha, [class*='cf-challenge'], iframe[src*='recaptcha'], iframe[src*='hcaptcha']") ||
                    text.includes("captcha challenge") ||
                    text.includes("captcha required") ||
                    text.includes("verify you are human") ||
                    text.includes("checking if the site connection is secure") ||
                    text.includes("checking your browser") ||
                    text.includes("are you a robot") ||
                    text.includes("security check");
                return document.readyState + "|" + (hasOldRedditPost ? "old-reddit-post" : "") + "|" + (hasChallenge ? "challenge" : "");
            })()"##,
            move |result| {
                let _ = tx.send(result);
            },
        ) {
            if let Ok(status) = rx.recv_timeout(Duration::from_secs(EVAL_RECV_TIMEOUT_SECS)) {
                if status.contains("complete")
                    || status.contains("old-reddit-post")
                    || status.contains("challenge")
                {
                    break;
                }
            }
        }
        if start.elapsed() > timeout {
            return Err("page load timeout".to_string());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    tokio::time::sleep(Duration::from_secs(2)).await;

    let (tx, rx) = mpsc::channel::<String>();
    wv.eval_with_callback("document.documentElement.outerHTML", move |result| {
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;

    let result = rx
        .recv_timeout(Duration::from_secs(EVAL_RECV_TIMEOUT_SECS))
        .map_err(|e| e.to_string())?;

    Ok(serde_json::from_str::<String>(&result).unwrap_or(result))
}

#[tauri::command]
async fn fetch_html(url: String) -> Result<Option<String>, String> {
    fetch_validated_text(
        &url,
        "text/html,application/xhtml+xml",
        ContentKind::Html,
        MAX_HTML_BYTES,
    )
    .await
}

async fn validate_external_url(raw: &str) -> Result<url::Url, String> {
    let parsed: url::Url = raw
        .trim()
        .parse()
        .map_err(|e: url::ParseError| format!("Invalid URL: {}", e))?;

    validate_url_components(&parsed)?;
    let _ = resolve_public_socket_addrs(&parsed).await?;

    Ok(parsed)
}

#[tauri::command]
async fn fetch_searxng_json(base_url: String, query: String) -> Result<Option<String>, String> {
    let base = validate_service_base_url(&base_url)?;
    let mut url = base
        .join("/search")
        .map_err(|e| format!("Invalid SearXNG search URL: {}", e))?;
    url.query_pairs_mut()
        .append_pair("q", query.trim())
        .append_pair("format", "json");

    fetch_configured_service_text(&url, "application/json", ContentKind::Json, MAX_JSON_BYTES).await
}

fn validate_service_base_url(raw: &str) -> Result<url::Url, String> {
    let parsed: url::Url = raw
        .trim()
        .parse()
        .map_err(|e: url::ParseError| format!("Invalid service URL: {}", e))?;

    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Only http or https service URLs are allowed.".to_string());
    }

    parsed
        .host_str()
        .ok_or_else(|| "Service URL must include a hostname.".to_string())?;

    Ok(parsed)
}

fn validate_url_components(parsed: &url::Url) -> Result<(), String> {
    if parsed.scheme() != "https" {
        return Err("Only https URLs are allowed.".to_string());
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "URL must include a hostname.".to_string())?
        .to_ascii_lowercase();

    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return Err("Local hostnames are not allowed.".to_string());
    }

    if let Some(url::Host::Ipv4(ip)) = parsed.host() {
        if is_blocked_ip(IpAddr::V4(ip)) {
            return Err("Private or loopback IPv4 addresses are not allowed.".to_string());
        }
    }

    if let Some(url::Host::Ipv6(ip)) = parsed.host() {
        if is_blocked_ip(IpAddr::V6(ip)) {
            return Err("Private or loopback IPv6 addresses are not allowed.".to_string());
        }
    }

    Ok(())
}

async fn resolve_public_socket_addrs(parsed: &url::Url) -> Result<Vec<SocketAddr>, String> {
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addrs = match parsed.host() {
        Some(url::Host::Ipv4(ip)) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
        Some(url::Host::Ipv6(ip)) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
        Some(url::Host::Domain(host)) => {
            let host = host.to_string();
            tokio::task::spawn_blocking(move || {
                (host.as_str(), port)
                    .to_socket_addrs()
                    .map(|iter| iter.collect::<Vec<_>>())
            })
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("Could not resolve hostname: {}", e))?
        }
        None => return Err("URL must include a hostname.".to_string()),
    };

    if addrs.is_empty() {
        return Err("Hostname did not resolve to any addresses.".to_string());
    }

    if addrs.iter().any(|addr| is_blocked_ip(addr.ip())) {
        return Err("Hostname resolves to a private or loopback address.".to_string());
    }

    Ok(addrs)
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.octets()[0] == 0
                || (ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1]))
                || (ip.octets()[0] == 198 && ip.octets()[1] == 18)
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ((ip.segments()[0] & 0xfe00) == 0xfc00)
                || ((ip.segments()[0] & 0xffc0) == 0xfe80)
        }
    }
}

#[derive(Clone, Copy)]
enum ContentKind {
    Html,
    Json,
}

async fn fetch_validated_text(
    raw_url: &str,
    accept: &'static str,
    content_kind: ContentKind,
    max_bytes: usize,
) -> Result<Option<String>, String> {
    let mut current = validate_external_url(raw_url).await?;

    for _ in 0..=MAX_FETCH_REDIRECTS {
        let response = send_validated_get(&current, accept).await?;
        let status = response.status();

        if status.is_redirection() {
            let Some(location) = response.headers().get(LOCATION) else {
                return Ok(None);
            };
            let location = location
                .to_str()
                .map_err(|_| "Redirect location is not valid UTF-8.".to_string())?;
            current = validated_redirect_url(&current, location).await?;
            continue;
        }

        if !status.is_success() {
            return Ok(None);
        }

        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");

        if !content_type_is_allowed(content_type, content_kind) {
            return Ok(None);
        }

        return read_limited_response(response, max_bytes).await.map(Some);
    }

    Err("Too many redirects while fetching URL.".to_string())
}

async fn send_validated_get(
    url: &url::Url,
    accept: &'static str,
) -> Result<reqwest::Response, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "URL must include a hostname.".to_string())?
        .to_ascii_lowercase();
    let addrs = resolve_public_socket_addrs(url).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(&host, &addrs)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    client
        .get(url.as_str())
        .header(ACCEPT, accept)
        .header(
            USER_AGENT,
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .send()
        .await
        .map_err(|e| format!("Fetch failed: {}", e))
}

async fn validated_redirect_url(base: &url::Url, location: &str) -> Result<url::Url, String> {
    let next = base
        .join(location)
        .map_err(|e| format!("Invalid redirect location: {}", e))?;

    validate_url_components(&next)?;
    let _ = resolve_public_socket_addrs(&next).await?;

    Ok(next)
}

async fn fetch_configured_service_text(
    initial_url: &url::Url,
    accept: &'static str,
    content_kind: ContentKind,
    max_bytes: usize,
) -> Result<Option<String>, String> {
    let mut current = initial_url.clone();

    for _ in 0..=MAX_FETCH_REDIRECTS {
        let response = send_configured_service_get(&current, accept).await?;
        let status = response.status();

        if status.is_redirection() {
            let Some(location) = response.headers().get(LOCATION) else {
                return Ok(None);
            };
            let location = location
                .to_str()
                .map_err(|_| "Redirect location is not valid UTF-8.".to_string())?;
            current = current
                .join(location)
                .map_err(|e| format!("Invalid redirect location: {}", e))?;
            validate_service_base_url(current.as_str())?;
            continue;
        }

        if !status.is_success() {
            return Ok(None);
        }

        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");

        if !content_type_is_allowed(content_type, content_kind) {
            return Ok(None);
        }

        return read_limited_response(response, max_bytes).await.map(Some);
    }

    Err("Too many redirects while fetching service URL.".to_string())
}

async fn send_configured_service_get(
    url: &url::Url,
    accept: &'static str,
) -> Result<reqwest::Response, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    client
        .get(url.as_str())
        .header(ACCEPT, accept)
        .header(
            USER_AGENT,
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .send()
        .await
        .map_err(|e| format!("Service fetch failed: {}", e))
}

fn content_type_is_allowed(content_type: &str, content_kind: ContentKind) -> bool {
    let normalized = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    match content_kind {
        ContentKind::Html => matches!(normalized.as_str(), "text/html" | "application/xhtml+xml"),
        ContentKind::Json => normalized == "application/json" || normalized.ends_with("+json"),
    }
}

async fn read_limited_response(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<String, String> {
    if response
        .content_length()
        .is_some_and(|len| len > max_bytes as u64)
    {
        return Err("Response is too large.".to_string());
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?
    {
        if body.len() + chunk.len() > max_bytes {
            return Err("Response is too large.".to_string());
        }
        body.extend_from_slice(&chunk);
    }

    String::from_utf8(body).map_err(|_| "Response body is not valid UTF-8.".to_string())
}

#[tauri::command]
fn register_research_folder(app: AppHandle, name: String, query: String) -> Result<i64, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    research_search::indexing::register_folder(&conn, &name, &query)
}

#[tauri::command]
fn rename_research_folder_index(
    app: AppHandle,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    research_search::indexing::rename_folder(&conn, &old_name, &new_name)
}

#[tauri::command]
fn delete_research_folder_index(app: AppHandle, name: String) -> Result<(), String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    research_search::indexing::delete_folder(&conn, &name)
}

#[tauri::command]
fn delete_research_file_index(
    app: AppHandle,
    folder: String,
    filename: String,
) -> Result<(), String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let folder_id = research_search::get_folder_id(&conn, &folder)?
        .ok_or_else(|| format!("Folder not found: {}", folder))?;
    research_search::indexing::delete_file_chunks(&conn, folder_id, &filename)
}

#[tauri::command]
async fn index_research_file(
    app: AppHandle,
    embedding_config: research_search::embeddings::EmbeddingConfig,
    folder: String,
    filename: String,
    content: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let db = app.state::<Database>();
        research_search::indexing::index_file(&db, &embedding_config, &folder, &filename, &content)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn search_research(
    app: AppHandle,
    embedding_config: research_search::embeddings::EmbeddingConfig,
    reranker_config: research_search::reranker::RerankerConfig,
    queries: Vec<String>,
    folder: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<SearchResult>, String> {
    tokio::task::spawn_blocking(move || {
        let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let search_results_dir = app_data.join("search-results");
        let db = app.state::<Database>();
        {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            research_search::indexing::sync_folders_from_dir(&conn, &search_results_dir)?;
        }
        research_search::search::search_multi(&db, &embedding_config, &reranker_config, &queries, folder.as_deref(), limit)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_research_folders_db(app: AppHandle) -> Result<Vec<ResearchFolder>, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    research_search::indexing::list_folders(&conn)
}

#[tauri::command]
async fn backfill_index(
    app: AppHandle,
    embedding_config: research_search::embeddings::EmbeddingConfig,
    dimensions: Option<usize>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let db = app.state::<Database>();
        let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let search_results_dir = app_data.join("search-results");

        if let Some(dims) = dimensions {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            research_search::schema::rebuild_vector_table(&conn, dims)?;
        }

        if !search_results_dir.exists() {
            return Ok(());
        }

        let entries = std::fs::read_dir(&search_results_dir).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let folder_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if folder_name.is_empty() {
                continue;
            }

            {
                let conn = db.conn.lock().map_err(|e| e.to_string())?;
                let _ = research_search::indexing::register_folder(&conn, &folder_name, "");
            }

            let md_files = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
            for file_entry in md_files {
                let file_entry = file_entry.map_err(|e| e.to_string())?;
                let file_path = file_entry.path();
                if !file_path.is_file() {
                    continue;
                }
                let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if ext != "md" && ext != "txt" && ext != "json" {
                    continue;
                }

                let filename = file_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                let content = std::fs::read_to_string(&file_path).unwrap_or_default();
                if content.is_empty() {
                    continue;
                }

                let _ = research_search::indexing::index_file(
                    &db,
                    &embedding_config,
                    &folder_name,
                    &filename,
                    &content,
                );
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
            let db = research_search::init_database(&app_data)?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_tab,
            switch_tab,
            close_tab,
            extract_content,
            fetch_html,
            fetch_searxng_json,
            register_research_folder,
            rename_research_folder_index,
            delete_research_folder_index,
            delete_research_file_index,
            index_research_file,
            search_research,
            list_research_folders_db,
            backfill_index,
        ]);

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_webdriver::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webview_url_validation_rejects_non_https_urls() {
        let parsed: url::Url = "http://example.com".parse().unwrap();
        assert!(validate_url_components(&parsed).is_err());
    }

    #[test]
    fn webview_url_validation_rejects_private_targets() {
        for raw in [
            "https://localhost",
            "https://127.0.0.1",
            "https://192.168.1.10",
            "https://[::1]",
            "https://example.local",
        ] {
            let parsed: url::Url = raw.parse().unwrap();
            assert!(validate_url_components(&parsed).is_err(), "{raw}");
        }
    }

    #[test]
    fn webview_url_validation_accepts_public_https_urls() {
        let parsed: url::Url = "https://example.com".parse().unwrap();
        assert!(validate_url_components(&parsed).is_ok());
    }

    #[test]
    fn content_type_matching_is_strict() {
        assert!(content_type_is_allowed(
            "text/html; charset=utf-8",
            ContentKind::Html
        ));
        assert!(content_type_is_allowed(
            "application/vnd.api+json",
            ContentKind::Json
        ));
        assert!(!content_type_is_allowed("text/plain", ContentKind::Html));
        assert!(!content_type_is_allowed("text/html", ContentKind::Json));
    }

    #[test]
    fn configured_service_url_allows_local_http() {
        assert!(validate_service_base_url("http://localhost:8080").is_ok());
        assert!(validate_service_base_url("https://search.example.com").is_ok());
        assert!(validate_service_base_url("file:///tmp/search").is_err());
    }
}
