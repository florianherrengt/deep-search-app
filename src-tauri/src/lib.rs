use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::str::FromStr;
use std::sync::Mutex;
use std::sync::{mpsc, Arc};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ipnet::IpNet;

use reqwest::header::{ACCEPT, CONTENT_TYPE, LOCATION, USER_AGENT};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl,
};

const TAB_BAR_HEIGHT: f64 = 40.0;
const PAGE_LOAD_TIMEOUT_SECS: u64 = 30;
const EVAL_RECV_TIMEOUT_SECS: u64 = 5;
const FETCH_TIMEOUT_SECS: u64 = 10;
const MAX_FETCH_REDIRECTS: usize = 5;
const MAX_HTML_BYTES: usize = 5 * 1024 * 1024;
const APP_LOG_DIR: &str = "logs";
const APP_LOG_FILENAME: &str = "deep-search.log";
const MAX_RENDERER_LOG_ENTRIES: usize = 200;
const MAX_LOG_MESSAGE_CHARS: usize = 32_000;
const MAX_APP_LOG_BYTES: u64 = 5 * 1024 * 1024;
const BROWSER_TAB_NOTIFICATION_ACTION_EVENT: &str = "deep-search:browser-tab-notification-action";
static APP_LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());

struct SidecarState {
    pid: Mutex<Option<u32>>,
}

#[derive(Clone)]
struct McpBridgeState {
    started: Arc<Mutex<Option<McpBridgeInfo>>>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<String>>>>,
}

impl McpBridgeState {
    fn new() -> Self {
        Self {
            started: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct McpBridgeInfo {
    port: u16,
    token: String,
    config_path: String,
    proxy_path: String,
}

#[derive(Clone, serde::Serialize)]
struct McpBridgeRequestPayload {
    id: String,
    body: serde_json::Value,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTabNotificationActionPayload {
    browser_tab_id: String,
}

const MCP_BRIDGE_CONFIG_FILENAME: &str = "mcp-bridge.json";
const MCP_BRIDGE_PROXY_FILENAME: &str = "deep-search-mcp.mjs";
const MCP_BRIDGE_REQUEST_EVENT: &str = "deep-search:mcp-request";
const MCP_BRIDGE_MAX_BODY_BYTES: usize = 1024 * 1024;
const MCP_BRIDGE_RENDERER_TIMEOUT_SECS: u64 = 120;
const MCP_BRIDGE_PROXY_SCRIPT: &str = include_str!("../../scripts/deep-search-mcp.mjs");

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
fn get_tab_url(app: AppHandle, id: String) -> Result<String, String> {
    let wv = app.get_webview(&id).ok_or("webview not found")?;
    wv.url()
        .map(|url| url.to_string())
        .map_err(|error| error.to_string())
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

/// Sends a browser-tab notification whose content click can recover the
/// relevant managed WebView. macOS supports click responses through the
/// already-bundled notification backend; other desktop platforms safely show
/// the notification without promising a click callback.
#[tauri::command]
fn send_browser_tab_notification(
    app: AppHandle,
    title: String,
    body: String,
    browser_tab_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let application_id = if tauri::is_dev() {
            "com.apple.Terminal".to_string()
        } else {
            app.config().identifier.clone()
        };
        std::thread::Builder::new()
            .name("browser-tab-notification".to_string())
            .spawn(move || {
                // The notification plugin uses the same crate and may have
                // already selected the application identity. Either identity
                // is valid, so AlreadySet is intentionally ignored.
                let _ = mac_notification_sys::set_application(&application_id);
                let response = mac_notification_sys::Notification::new()
                    .title(&title)
                    .message(&body)
                    .wait_for_click(true)
                    .send();

                match response {
                    Ok(mac_notification_sys::NotificationResponse::Click) => {
                        activate_browser_tab_notification(&app, browser_tab_id);
                    }
                    Ok(_) => {}
                    Err(error) => write_native_log(
                        &app,
                        "warn",
                        "notification",
                        &format!("Browser-tab notification failed: {error}"),
                    ),
                }
            })
            .map(|_| ())
            .map_err(|error| format!("Failed to start notification worker: {error}"))
    }

    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_notification::NotificationExt;

        let _ = browser_tab_id;
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "macos")]
fn activate_browser_tab_notification(app: &AppHandle, browser_tab_id: String) {
    let callback_app = app.clone();
    let log_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if let Some(window) = callback_app.get_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        let _ = callback_app.emit_to(
            "main",
            BROWSER_TAB_NOTIFICATION_ACTION_EVENT,
            BrowserTabNotificationActionPayload { browser_tab_id },
        );
    }) {
        write_native_log(
            &log_app,
            "warn",
            "notification",
            &format!("Failed to activate browser notification target: {error}"),
        );
    }
}

#[tauri::command]
async fn fetch_html(url: String) -> Result<Option<String>, String> {
    fetch_validated_text(&url, "text/html,application/xhtml+xml", MAX_HTML_BYTES).await
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeSubtitleTrack {
    language_code: String,
    language_name: String,
    is_auto_generated: bool,
    is_translatable: bool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeSubtitleCue {
    start_ms: u64,
    duration_ms: u64,
    text: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct YoutubeSubtitleDownload {
    video_id: String,
    language_code: String,
    language_name: String,
    is_auto_generated: bool,
    is_translatable: bool,
    cues: Vec<YoutubeSubtitleCue>,
    text: String,
    available_tracks: Vec<YoutubeSubtitleTrack>,
}

struct DownloadedSubtitles {
    result: YoutubeSubtitleDownload,
    temp_dir: PathBuf,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RendererLogEntry {
    level: String,
    target: String,
    message: String,
    timestamp: Option<String>,
}

#[tauri::command]
async fn download_youtube_subtitles_with_ytdlp(
    yt_dlp_path: String,
    url: String,
) -> Result<YoutubeSubtitleDownload, String> {
    let yt_dlp = validate_executable_file_path(&yt_dlp_path, "yt-dlp")?;
    let youtube_url = validate_youtube_video_url(&url)?;
    let parsed: url::Url = youtube_url
        .parse()
        .map_err(|e: url::ParseError| format!("Invalid YouTube URL: {}", e))?;
    let video_id = extract_youtube_video_id(&parsed)
        .ok_or_else(|| "Expected a YouTube video URL.".to_string())?;

    let download = tokio::task::spawn_blocking(move || {
        download_youtube_subtitles_blocking(&yt_dlp, &youtube_url, &video_id)
    })
    .await
    .map_err(|e| format!("yt-dlp task failed: {}", e))??;

    let _ = fs::remove_dir_all(&download.temp_dir);
    Ok(download.result)
}

fn validate_executable_file_path(raw: &str, label: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{} path is required.", label));
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!("{} path must be absolute.", label));
    }
    if !path.is_file() {
        return Err(format!("{} path does not point to a file.", label));
    }

    Ok(path)
}

fn validate_youtube_video_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let parsed: url::Url = trimmed
        .parse()
        .map_err(|e: url::ParseError| format!("Invalid YouTube URL: {}", e))?;

    if parsed.scheme() != "https" {
        return Err("Only https YouTube URLs are allowed.".to_string());
    }

    extract_youtube_video_id(&parsed)
        .map(|_| trimmed.to_string())
        .ok_or_else(|| "Expected a YouTube video URL.".to_string())
}

fn extract_youtube_video_id(parsed: &url::Url) -> Option<String> {
    let host = parsed.host_str()?.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);

    if host == "youtu.be" {
        let id = parsed.path_segments()?.next()?;
        return is_youtube_video_id(id).then(|| id.to_string());
    }

    if host == "youtube.com" || host == "m.youtube.com" {
        if let Some(id) = parsed.query_pairs().find_map(|(key, value)| {
            (key == "v" && is_youtube_video_id(&value)).then(|| value.to_string())
        }) {
            return Some(id);
        }

        let segments = parsed.path_segments()?.collect::<Vec<_>>();
        if matches!(segments.first().copied(), Some("embed" | "shorts" | "live")) {
            if let Some(id) = segments.get(1) {
                return is_youtube_video_id(id).then(|| (*id).to_string());
            }
        }
    }

    None
}

fn is_youtube_video_id(value: &str) -> bool {
    value.len() == 11
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn download_youtube_subtitles_blocking(
    yt_dlp_path: &Path,
    youtube_url: &str,
    video_id: &str,
) -> Result<DownloadedSubtitles, String> {
    let temp_dir = std::env::temp_dir().join(format!(
        "deep-search-youtube-subtitles-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temporary subtitle directory: {}", e))?;

    let output = Command::new(yt_dlp_path)
        .current_dir(&temp_dir)
        .args(youtube_subtitle_download_args(youtube_url))
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "yt-dlp failed: {}",
            process_output_summary(&output.stdout, &output.stderr)
        ));
    }

    let file_path = find_downloaded_subtitle_file(&temp_dir, &output).map_err(|error| {
        let _ = fs::remove_dir_all(&temp_dir);
        error
    })?;
    let result = parse_youtube_vtt_file(&file_path, video_id).map_err(|error| {
        let _ = fs::remove_dir_all(&temp_dir);
        error
    })?;

    Ok(DownloadedSubtitles { result, temp_dir })
}

fn youtube_subtitle_download_args(youtube_url: &str) -> Vec<String> {
    [
        "--skip-download",
        "--write-auto-subs",
        "--sub-langs",
        "en",
        "--sub-format",
        "vtt",
        "--no-playlist",
        "--no-progress",
        "--force-overwrites",
        "-o",
        "subtitle.%(ext)s",
        youtube_url,
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn find_downloaded_subtitle_file(
    temp_dir: &Path,
    output: &std::process::Output,
) -> Result<PathBuf, String> {
    let mut candidates = fs::read_dir(temp_dir)
        .map_err(|e| format!("Failed to read temporary subtitle directory: {}", e))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with("subtitle.")
                            && name.ends_with(".vtt")
                            && !name.ends_with(".part")
                    })
        })
        .collect::<Vec<_>>();

    candidates.sort();
    let file_path = candidates.into_iter().next().ok_or_else(|| {
        format!(
            "yt-dlp did not produce a subtitle file: {}",
            process_output_summary(&output.stdout, &output.stderr)
        )
    })?;

    let metadata = fs::metadata(&file_path)
        .map_err(|e| format!("Failed to inspect downloaded subtitle file: {}", e))?;
    if metadata.len() == 0 {
        return Err("yt-dlp produced an empty subtitle file.".to_string());
    }

    Ok(file_path)
}

fn parse_youtube_vtt_file(path: &Path, video_id: &str) -> Result<YoutubeSubtitleDownload, String> {
    let body =
        fs::read_to_string(path).map_err(|e| format!("Failed to read subtitle file: {}", e))?;
    let cues = parse_vtt_cues(&body)?;
    if cues.is_empty() {
        return Err("yt-dlp subtitle file did not contain transcript cues.".to_string());
    }

    let language_code = subtitle_language_code(path).unwrap_or_else(|| "en".to_string());
    let language_name = subtitle_language_name(&language_code);
    let text = cues
        .iter()
        .map(|cue| cue.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let track = YoutubeSubtitleTrack {
        language_code: language_code.clone(),
        language_name: language_name.clone(),
        is_auto_generated: true,
        is_translatable: false,
    };

    Ok(YoutubeSubtitleDownload {
        video_id: video_id.to_string(),
        language_code,
        language_name,
        is_auto_generated: true,
        is_translatable: false,
        cues,
        text,
        available_tracks: vec![track],
    })
}

fn parse_vtt_cues(body: &str) -> Result<Vec<YoutubeSubtitleCue>, String> {
    let mut cues = Vec::new();
    let mut current_start_ms: Option<u64> = None;
    let mut current_end_ms: Option<u64> = None;
    let mut current_lines: Vec<String> = Vec::new();
    let mut previous_full_text = String::new();

    for raw_line in body.lines() {
        let line = raw_line.trim_end_matches('\r');
        let trimmed = line.trim();
        if trimmed.is_empty() {
            push_vtt_cue(
                &mut cues,
                &mut previous_full_text,
                current_start_ms.take(),
                current_end_ms.take(),
                &current_lines,
            );
            current_lines.clear();
            continue;
        }

        if trimmed == "WEBVTT" || trimmed.starts_with("Kind:") || trimmed.starts_with("Language:") {
            continue;
        }

        if let Some((start_ms, end_ms)) = parse_vtt_timing(trimmed)? {
            push_vtt_cue(
                &mut cues,
                &mut previous_full_text,
                current_start_ms.take(),
                current_end_ms.take(),
                &current_lines,
            );
            current_lines.clear();
            current_start_ms = Some(start_ms);
            current_end_ms = Some(end_ms);
            continue;
        }

        if current_start_ms.is_some() {
            current_lines.push(trimmed.to_string());
        }
    }

    push_vtt_cue(
        &mut cues,
        &mut previous_full_text,
        current_start_ms.take(),
        current_end_ms.take(),
        &current_lines,
    );

    Ok(cues)
}

fn push_vtt_cue(
    cues: &mut Vec<YoutubeSubtitleCue>,
    previous_full_text: &mut String,
    start_ms: Option<u64>,
    end_ms: Option<u64>,
    lines: &[String],
) {
    let Some(start_ms) = start_ms else {
        return;
    };
    let Some(end_ms) = end_ms else {
        return;
    };
    let full_text = clean_vtt_text(lines);
    if full_text.is_empty() {
        return;
    }

    let text = incremental_vtt_text(previous_full_text, &full_text);
    *previous_full_text = full_text;
    if text.is_empty() {
        return;
    }

    cues.push(YoutubeSubtitleCue {
        start_ms,
        duration_ms: end_ms.saturating_sub(start_ms),
        text,
    });
}

fn parse_vtt_timing(line: &str) -> Result<Option<(u64, u64)>, String> {
    let Some((start, rest)) = line.split_once("-->") else {
        return Ok(None);
    };
    let end = rest.split_whitespace().next().unwrap_or("");
    let start_ms = parse_vtt_timestamp_ms(start.trim())
        .ok_or_else(|| format!("Invalid subtitle start timestamp: {}", start.trim()))?;
    let end_ms = parse_vtt_timestamp_ms(end.trim())
        .ok_or_else(|| format!("Invalid subtitle end timestamp: {}", end.trim()))?;
    Ok(Some((start_ms, end_ms)))
}

fn parse_vtt_timestamp_ms(value: &str) -> Option<u64> {
    let parts = value.split(':').collect::<Vec<_>>();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [minutes, seconds] => (0, minutes.parse::<u64>().ok()?, *seconds),
        [hours, minutes, seconds] => (
            hours.parse::<u64>().ok()?,
            minutes.parse::<u64>().ok()?,
            *seconds,
        ),
        _ => return None,
    };

    let (seconds, millis) = if let Some((seconds, millis)) = seconds.split_once('.') {
        (seconds, millis)
    } else if let Some((seconds, millis)) = seconds.split_once(',') {
        (seconds, millis)
    } else {
        (seconds, "0")
    };
    let seconds = seconds.parse::<u64>().ok()?;
    let mut millis = millis.chars().take(3).collect::<String>();
    while millis.len() < 3 {
        millis.push('0');
    }
    let millis = millis.parse::<u64>().unwrap_or(0);
    Some(((hours * 60 + minutes) * 60 + seconds) * 1000 + millis)
}

fn clean_vtt_text(lines: &[String]) -> String {
    lines
        .iter()
        .map(|line| strip_vtt_markup(line))
        .map(|line| decode_basic_html_entities(&line))
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn strip_vtt_markup(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    output
}

fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn incremental_vtt_text(previous: &str, current: &str) -> String {
    if current == previous || previous.ends_with(current) {
        return String::new();
    }
    if let Some(rest) = current.strip_prefix(previous) {
        return rest.trim().to_string();
    }

    let mut current_lines = current.lines().collect::<Vec<_>>();
    while current_lines
        .first()
        .is_some_and(|line| previous.lines().any(|previous_line| previous_line == *line))
    {
        current_lines.remove(0);
    }
    current_lines.join("\n").trim().to_string()
}

fn subtitle_language_code(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let without_prefix = name.strip_prefix("subtitle.")?;
    let without_ext = without_prefix.strip_suffix(".vtt")?;
    let language = without_ext.trim();
    (!language.is_empty()).then(|| language.to_string())
}

fn subtitle_language_name(language_code: &str) -> String {
    match language_code
        .split(['-', '_'])
        .next()
        .unwrap_or(language_code)
    {
        "en" => "English".to_string(),
        _ => language_code.to_string(),
    }
}

fn process_output_summary(stdout: &[u8], stderr: &[u8]) -> String {
    let stderr_text = String::from_utf8_lossy(stderr);
    let stdout_text = String::from_utf8_lossy(stdout);
    let combined = if stderr_text.trim().is_empty() {
        stdout_text.trim().to_string()
    } else {
        stderr_text.trim().to_string()
    };
    trim_output(&combined)
}

fn trim_output(value: &str) -> String {
    const MAX_LEN: usize = 1200;
    let trimmed = value.trim();
    if trimmed.chars().count() <= MAX_LEN {
        return trimmed.to_string();
    }
    format!("{}...", trimmed.chars().take(MAX_LEN).collect::<String>())
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

/// CIDR blocks that are blocked for outbound HTTP fetches.
/// These mirror the TS-side validation in `src/lib/url-validation.ts`,
/// which uses `ipaddr.js` and blocks anything whose `range()` is not
/// `'unicast'`.
const BLOCKED_IPV4_NETS: &[&str] = &[
    "0.0.0.0/8",          // current network
    "10.0.0.0/8",         // RFC 1918 private
    "100.64.0.0/10",      // CGNAT
    "127.0.0.0/8",        // loopback
    "169.254.0.0/16",     // link-local
    "172.16.0.0/12",      // RFC 1918 private
    "192.0.0.0/24",       // IETF protocol assignments
    "192.0.2.0/24",       // documentation (TEST-NET-1)
    "192.168.0.0/16",     // RFC 1918 private
    "198.18.0.0/15",      // benchmark testing
    "198.51.100.0/24",    // documentation (TEST-NET-2)
    "203.0.113.0/24",     // documentation (TEST-NET-3)
    "224.0.0.0/4",        // multicast
    "240.0.0.0/4",        // reserved
    "255.255.255.255/32", // broadcast
];

const BLOCKED_IPV6_NETS: &[&str] = &[
    "::/128",        // unspecified
    "::1/128",       // loopback
    "::ffff:0:0/96", // IPv4-mapped (handled by unwrapping the IPv4 part)
    "fc00::/7",      // unique local addresses
    "fe80::/10",     // link-local
    "ff00::/8",      // multicast
];

fn blocked_ip_nets() -> &'static [IpNet] {
    use std::sync::OnceLock;
    static NETS: OnceLock<Vec<IpNet>> = OnceLock::new();
    NETS.get_or_init(|| {
        BLOCKED_IPV4_NETS
            .iter()
            .chain(BLOCKED_IPV6_NETS.iter())
            .map(|s| IpNet::from_str(s).expect("invalid CIDR in BLOCKED_*_NETS"))
            .collect()
    })
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    if let IpAddr::V6(v6) = ip {
        if let Some(v4) = v6.to_ipv4_mapped() {
            return is_blocked_ip(IpAddr::V4(v4));
        }
    }
    blocked_ip_nets().iter().any(|net| net.contains(&ip))
}

async fn fetch_validated_text(
    raw_url: &str,
    accept: &'static str,
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

        if !content_type_is_allowed(content_type) {
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

fn content_type_is_allowed(content_type: &str) -> bool {
    let normalized = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    matches!(normalized.as_str(), "text/html" | "application/xhtml+xml")
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
fn append_app_log(app: AppHandle, entries: Vec<RendererLogEntry>) -> Result<String, String> {
    let total_entries = entries.len();
    let mut lines: Vec<String> = entries
        .into_iter()
        .take(MAX_RENDERER_LOG_ENTRIES)
        .map(format_renderer_log_line)
        .collect();

    if total_entries > MAX_RENDERER_LOG_ENTRIES {
        lines.push(format_log_line(
            &current_log_timestamp(),
            "warn",
            "logger",
            &format!(
                "Dropped {} renderer log entries from an oversized IPC batch.",
                total_entries - MAX_RENDERER_LOG_ENTRIES
            ),
        ));
    }

    append_log_lines(&app, lines).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_app_log_path(app: AppHandle) -> Result<String, String> {
    ensure_app_log_file(&app).map(|path| path.to_string_lossy().into_owned())
}

fn app_log_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(APP_LOG_DIR)
        .join(APP_LOG_FILENAME))
}

fn ensure_app_log_file(app: &AppHandle) -> Result<PathBuf, String> {
    let log_path = app_log_file_path(app)?;
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create app log directory at {}: {}",
                parent.to_string_lossy(),
                e
            )
        })?;
    }
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| {
            format!(
                "Failed to open app log file at {}: {}",
                log_path.to_string_lossy(),
                e
            )
        })?;

    Ok(log_path)
}

fn append_log_lines<I>(app: &AppHandle, lines: I) -> Result<PathBuf, String>
where
    I: IntoIterator<Item = String>,
{
    let lines: Vec<String> = lines.into_iter().collect();
    let _write_guard = APP_LOG_WRITE_LOCK
        .lock()
        .map_err(|_| "App log write lock is poisoned.".to_string())?;
    let log_path = ensure_app_log_file(app)?;
    append_lines_to_log_file(&log_path, lines, MAX_APP_LOG_BYTES)?;

    Ok(log_path)
}

fn append_lines_to_log_file<I>(log_path: &Path, lines: I, max_bytes: u64) -> Result<(), String>
where
    I: IntoIterator<Item = String>,
{
    let file_name = log_path
        .file_name()
        .ok_or_else(|| "App log path has no filename.".to_string())?
        .to_string_lossy();
    let backup_path = log_path.with_file_name(format!("{file_name}.1"));

    cap_log_file_to_bytes(log_path, max_bytes)?;
    cap_log_file_to_bytes(&backup_path, max_bytes)?;

    if max_bytes == 0 {
        return Ok(());
    }

    let max_line_bytes = usize::try_from(max_bytes.saturating_sub(1)).unwrap_or(usize::MAX);

    for line in lines {
        let mut end = line.len().min(max_line_bytes);
        while !line.is_char_boundary(end) {
            end -= 1;
        }
        let line = &line[..end];
        let incoming_bytes = line.len() as u64 + 1;

        rotate_log_file_if_needed(log_path, incoming_bytes, max_bytes)?;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .map_err(|e| {
                format!(
                    "Failed to open app log file at {}: {}",
                    log_path.to_string_lossy(),
                    e
                )
            })?;
        file.write_all(line.as_bytes()).map_err(|e| {
            format!(
                "Failed to write app log file at {}: {}",
                log_path.to_string_lossy(),
                e
            )
        })?;
        file.write_all(b"\n").map_err(|e| {
            format!(
                "Failed to write app log file at {}: {}",
                log_path.to_string_lossy(),
                e
            )
        })?;
    }

    Ok(())
}

fn cap_log_file_to_bytes(log_path: &Path, max_bytes: u64) -> Result<(), String> {
    let file_bytes = match fs::metadata(log_path) {
        Ok(metadata) if metadata.len() > max_bytes => metadata.len(),
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect app log file at {}: {}",
                log_path.to_string_lossy(),
                error
            ));
        }
    };

    if max_bytes == 0 {
        return fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(log_path)
            .map(|_| ())
            .map_err(|error| {
                format!(
                    "Failed to cap app log file at {}: {}",
                    log_path.to_string_lossy(),
                    error
                )
            });
    }

    // Historical versions did not cap this file. Read only a bounded suffix
    // so migrating a very large legacy log cannot allocate its full size.
    // The extra bytes are enough to recover if the suffix starts in the
    // middle of a UTF-8 code point.
    let read_bytes = file_bytes.min(max_bytes.saturating_add(3));
    let mut file = fs::File::open(log_path).map_err(|error| {
        format!(
            "Failed to open app log file at {}: {}",
            log_path.to_string_lossy(),
            error
        )
    })?;
    file.seek(SeekFrom::Start(file_bytes - read_bytes))
        .map_err(|error| {
            format!(
                "Failed to seek app log file at {}: {}",
                log_path.to_string_lossy(),
                error
            )
        })?;
    let mut bytes = Vec::with_capacity(usize::try_from(read_bytes).unwrap_or(0));
    file.take(read_bytes)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            format!(
                "Failed to read app log file at {}: {}",
                log_path.to_string_lossy(),
                error
            )
        })?;

    let contents = String::from_utf8_lossy(&bytes);
    let max_bytes = usize::try_from(max_bytes).unwrap_or(usize::MAX);
    let mut start = contents.len().saturating_sub(max_bytes);
    while !contents.is_char_boundary(start) {
        start += 1;
    }

    fs::write(log_path, &contents.as_bytes()[start..]).map_err(|error| {
        format!(
            "Failed to cap app log file at {}: {}",
            log_path.to_string_lossy(),
            error
        )
    })
}

fn rotate_log_file_if_needed(
    log_path: &Path,
    incoming_bytes: u64,
    max_bytes: u64,
) -> Result<(), String> {
    let current_bytes = match fs::metadata(log_path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => {
            return Err(format!(
                "Failed to inspect app log file at {}: {}",
                log_path.to_string_lossy(),
                error
            ));
        }
    };

    if current_bytes == 0 || current_bytes.saturating_add(incoming_bytes) <= max_bytes {
        return Ok(());
    }

    let file_name = log_path
        .file_name()
        .ok_or_else(|| "App log path has no filename.".to_string())?
        .to_string_lossy();
    let backup_path = log_path.with_file_name(format!("{file_name}.1"));

    match fs::remove_file(&backup_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Failed to replace rotated app log at {}: {}",
                backup_path.to_string_lossy(),
                error
            ));
        }
    }

    fs::rename(log_path, &backup_path).map_err(|error| {
        format!(
            "Failed to rotate app log from {} to {}: {}",
            log_path.to_string_lossy(),
            backup_path.to_string_lossy(),
            error
        )
    })
}

fn write_native_log(app: &AppHandle, level: &str, target: &str, message: &str) {
    eprintln!("[{}] {}", target, message);
    let line = format_log_line(&current_log_timestamp(), level, target, message);
    let _ = append_log_lines(app, std::iter::once(line));
}

fn format_renderer_log_line(entry: RendererLogEntry) -> String {
    let timestamp = entry.timestamp.unwrap_or_else(current_log_timestamp);
    format_log_line(&timestamp, &entry.level, &entry.target, &entry.message)
}

fn format_log_line(timestamp: &str, level: &str, target: &str, message: &str) -> String {
    format!(
        "[{}] [{}] [{}] {}",
        sanitize_log_component(timestamp, "unknown-time"),
        sanitize_log_component(level, "info"),
        sanitize_log_component(target, "app"),
        sanitize_log_message(message),
    )
}

fn sanitize_log_component(value: &str, fallback: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':') {
                ch
            } else {
                '_'
            }
        })
        .take(96)
        .collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn sanitize_log_message(value: &str) -> String {
    let escaped = value.replace('\r', "\\r").replace('\n', "\\n");
    truncate_log_message(&escaped)
}

fn truncate_log_message(value: &str) -> String {
    let mut chars = value.chars();
    let mut truncated: String = chars.by_ref().take(MAX_LOG_MESSAGE_CHARS).collect();
    if chars.next().is_some() {
        truncated.push_str("... [truncated]");
    }
    truncated
}

fn current_log_timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("unix-ms:{}", millis)
}

#[tauri::command]
fn register_sidecar_pid(
    app: AppHandle,
    state: tauri::State<SidecarState>,
    pid: u32,
) -> Result<(), String> {
    write_native_log(
        &app,
        "info",
        "sidecar",
        &format!("Registered sidecar PID {}", pid),
    );
    *state.pid.lock().map_err(|e| e.to_string())? = Some(pid);
    Ok(())
}

#[tauri::command]
fn unregister_sidecar_pid(app: AppHandle, state: tauri::State<SidecarState>) -> Result<(), String> {
    write_native_log(&app, "info", "sidecar", "Unregistered sidecar PID");
    *state.pid.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
fn start_mcp_bridge(
    app: AppHandle,
    state: tauri::State<McpBridgeState>,
) -> Result<McpBridgeInfo, String> {
    if let Some(info) = state.started.lock().map_err(|e| e.to_string())?.clone() {
        return Ok(info);
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("Failed to bind MCP bridge: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read MCP bridge address: {}", e))?
        .port();
    let token = uuid::Uuid::new_v4().to_string();
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    let config_path = app_data.join(MCP_BRIDGE_CONFIG_FILENAME);
    let proxy_path = app_data.join(MCP_BRIDGE_PROXY_FILENAME);
    write_mcp_bridge_proxy_script(&proxy_path)?;

    let info = McpBridgeInfo {
        port,
        token: token.clone(),
        config_path: config_path.to_string_lossy().into_owned(),
        proxy_path: proxy_path.to_string_lossy().into_owned(),
    };
    let config = serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, config).map_err(|e| {
        format!(
            "Failed to write MCP bridge config at {}: {}",
            config_path.to_string_lossy(),
            e
        )
    })?;

    let app_handle = app.clone();
    let pending = state.pending.clone();
    std::thread::Builder::new()
        .name("deep-search-mcp-bridge".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let app_handle = app_handle.clone();
                        let pending = pending.clone();
                        let token = token.clone();
                        std::thread::spawn(move || {
                            if let Err(error) =
                                handle_mcp_bridge_stream(stream, app_handle.clone(), pending, token)
                            {
                                write_native_log(
                                    &app_handle,
                                    "error",
                                    "mcp-bridge",
                                    &format!("request failed: {}", error),
                                );
                            }
                        });
                    }
                    Err(error) => {
                        write_native_log(
                            &app_handle,
                            "error",
                            "mcp-bridge",
                            &format!("accept failed: {}", error),
                        );
                    }
                }
            }
        })
        .map_err(|e| format!("Failed to start MCP bridge thread: {}", e))?;

    *state.started.lock().map_err(|e| e.to_string())? = Some(info.clone());
    Ok(info)
}

#[tauri::command]
fn respond_mcp_bridge_request(
    state: tauri::State<McpBridgeState>,
    id: String,
    response: serde_json::Value,
) -> Result<(), String> {
    let sender = state
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
        .ok_or_else(|| format!("No pending MCP bridge request for id {}", id))?;

    sender
        .send(response.to_string())
        .map_err(|e| format!("Failed to send MCP bridge response: {}", e))
}

fn write_mcp_bridge_proxy_script(path: &std::path::Path) -> Result<(), String> {
    std::fs::write(path, MCP_BRIDGE_PROXY_SCRIPT).map_err(|e| {
        format!(
            "Failed to write MCP proxy script at {}: {}",
            path.to_string_lossy(),
            e
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path)
            .map_err(|e| format!("Failed to read MCP proxy script metadata: {}", e))?
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions)
            .map_err(|e| format!("Failed to mark MCP proxy script executable: {}", e))?;
    }

    Ok(())
}

fn handle_mcp_bridge_stream(
    mut stream: TcpStream,
    app: AppHandle,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<String>>>>,
    token: String,
) -> Result<(), String> {
    let request = read_mcp_bridge_request(&mut stream)?;

    if request.method != "POST" || request.path != "/deep-search" {
        write_http_response(&mut stream, 404, r#"{"error":"not found"}"#)?;
        return Ok(());
    }

    if !request_has_valid_token(&request.headers, &token) {
        write_http_response(&mut stream, 401, r#"{"error":"unauthorized"}"#)?;
        return Ok(());
    }

    let body: serde_json::Value = serde_json::from_str(&request.body)
        .map_err(|e| format!("Invalid MCP bridge JSON body: {}", e))?;
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel::<String>();
    pending
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), tx);

    let payload = McpBridgeRequestPayload {
        id: id.clone(),
        body,
    };
    if let Err(error) = app.emit(MCP_BRIDGE_REQUEST_EVENT, payload) {
        let _ = pending.lock().map(|mut guard| guard.remove(&id));
        write_http_response(
            &mut stream,
            500,
            &format_json_error(&format!("Failed to emit bridge request: {}", error)),
        )?;
        return Ok(());
    }

    match rx.recv_timeout(Duration::from_secs(MCP_BRIDGE_RENDERER_TIMEOUT_SECS)) {
        Ok(response) => write_http_response(&mut stream, 200, &response)?,
        Err(_) => {
            let _ = pending.lock().map(|mut guard| guard.remove(&id));
            write_http_response(
                &mut stream,
                504,
                r#"{"status":"failed","error":"MCP bridge request timed out."}"#,
            )?;
        }
    }

    Ok(())
}

struct McpBridgeHttpRequest {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: String,
}

fn read_mcp_bridge_request(stream: &mut TcpStream) -> Result<McpBridgeHttpRequest, String> {
    let mut buffer = Vec::new();
    let mut temp = [0_u8; 1024];
    let header_end;

    loop {
        let read = stream
            .read(&mut temp)
            .map_err(|e| format!("Failed to read MCP bridge request: {}", e))?;
        if read == 0 {
            return Err("MCP bridge client closed the connection.".to_string());
        }
        buffer.extend_from_slice(&temp[..read]);
        if buffer.len() > MCP_BRIDGE_MAX_BODY_BYTES {
            return Err("MCP bridge request is too large.".to_string());
        }
        if let Some(index) = find_header_end(&buffer) {
            header_end = index;
            break;
        }
    }

    let header_text = String::from_utf8(buffer[..header_end].to_vec())
        .map_err(|_| "MCP bridge headers are not valid UTF-8.".to_string())?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "MCP bridge request line is missing.".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "MCP bridge request method is missing.".to_string())?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| "MCP bridge request path is missing.".to_string())?
        .to_string();

    let headers: Vec<(String, String)> = lines
        .flat_map(|line| {
            let (name, value) = line.split_once(':')?;
            Some((name.trim().to_ascii_lowercase(), value.trim().to_string()))
        })
        .collect();
    let content_length = headers
        .iter()
        .find(|(name, _)| name == "content-length")
        .and_then(|(_, value)| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MCP_BRIDGE_MAX_BODY_BYTES {
        return Err("MCP bridge request body is too large.".to_string());
    }

    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        let read = stream
            .read(&mut temp)
            .map_err(|e| format!("Failed to read MCP bridge body: {}", e))?;
        if read == 0 {
            return Err("MCP bridge client closed before sending the body.".to_string());
        }
        buffer.extend_from_slice(&temp[..read]);
    }

    let body = String::from_utf8(buffer[body_start..body_start + content_length].to_vec())
        .map_err(|_| "MCP bridge body is not valid UTF-8.".to_string())?;

    Ok(McpBridgeHttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn request_has_valid_token(headers: &[(String, String)], token: &str) -> bool {
    headers
        .iter()
        .any(|(name, value)| name == "authorization" && value == &format!("Bearer {}", token))
}

fn write_http_response(stream: &mut TcpStream, status: u16, body: &str) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
        404 => "Not Found",
        500 => "Internal Server Error",
        504 => "Gateway Timeout",
        _ => "OK",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        reason,
        body.as_bytes().len(),
        body,
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|e| format!("Failed to write MCP bridge response: {}", e))
}

fn format_json_error(message: &str) -> String {
    serde_json::json!({ "status": "failed", "error": message }).to_string()
}

/// Required Node version range for chrome-devtools-mcp.
/// Mirrors `chrome-devtools-mcp`'s `engines.node` and the TS-side check in
/// `src/lib/mcp/chrome-devtools-sidecar.ts`.
const REQUIRED_NODE_RANGE: &str = "^20.19.0 || ^22.12.0 || >=23";
const NODE_RESOLVE_TIMEOUT_SECS: u64 = 8;

#[derive(serde::Serialize)]
struct NodeResolution {
    path: String,
    dir: String,
    version: String,
    env_path: String,
}

/// Parses a Node version string like "v22.12.0" into (major, minor, patch).
fn parse_node_version(raw: &str) -> Option<(u32, u32, u32)> {
    let raw = raw.trim().trim_start_matches('v');
    let mut parts = raw.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    let patch_raw = parts.next()?;
    let patch = patch_raw
        .split(|c: char| !c.is_ascii_digit())
        .next()?
        .parse::<u32>()
        .ok()?;
    Some((major, minor, patch))
}

/// Matches the engines.node range required by chrome-devtools-mcp:
/// ^20.19.0 (20.x >=20.19), ^22.12.0 (22.x >=22.12), or >=23.
fn node_version_satisfies(major: u32, minor: u32) -> bool {
    (major == 20 && minor >= 19) || (major == 22 && minor >= 12) || major >= 23
}

/// Runs `<node> --version` for an absolute path and returns the version when
/// the binary exists and satisfies the required range.
fn validate_node_at(path: &std::path::Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    let output = std::process::Command::new(path)
        .arg("--version")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let (major, minor, _patch) = parse_node_version(&version)?;
    if !node_version_satisfies(major, minor) {
        return None;
    }
    Some(version)
}

fn node_resolution_for(path: &std::path::Path, version: &str) -> NodeResolution {
    let dir = path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let existing_path = std::env::var("PATH").unwrap_or_default();
    let separator = if cfg!(windows) { ";" } else { ":" };
    let env_path = if existing_path.is_empty() {
        dir.clone()
    } else {
        format!("{}{}{}", dir, separator, existing_path)
    };
    NodeResolution {
        path: path.to_string_lossy().into_owned(),
        dir,
        version: version.to_string(),
        env_path,
    }
}

/// Tries to locate `node` through the user's login shell, which sources the
/// profile that version managers (nvm, fnm, asdf, volta) and Homebrew rely on.
/// zsh uses `-lic` so `~/.zshrc` is sourced; bash uses `-lc` to avoid
/// interactive hangs (it will not source `.bashrc`, which is acceptable given
/// macOS defaults to zsh).
fn detect_node_via_login_shell() -> Option<std::path::PathBuf> {
    let user_shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty());
    let mut attempts: Vec<(&str, Vec<&str>)> = Vec::new();
    if cfg!(target_os = "macos") {
        attempts.push(("/bin/zsh", vec!["-lic", "command -v node"]));
    }
    attempts.push(("/bin/bash", vec!["-lc", "command -v node"]));
    if let Some(ref shell) = user_shell {
        let args: Vec<&str> = if cfg!(target_os = "macos") {
            vec!["-lic", "command -v node"]
        } else {
            vec!["-lc", "command -v node"]
        };
        attempts.push((shell.as_str(), args));
    }

    for (shell, args) in &attempts {
        if let Ok(out) = std::process::Command::new(shell).args(args).output() {
            if out.status.success() {
                let line = String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !line.is_empty() && !line.contains(char::is_whitespace) {
                    let candidate = std::path::PathBuf::from(&line);
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
        }
    }
    None
}

fn common_node_candidates() -> Vec<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if cfg!(target_os = "macos") {
        candidates.push(std::path::PathBuf::from("/opt/homebrew/bin/node"));
        candidates.push(std::path::PathBuf::from("/usr/local/bin/node"));
        candidates.push(std::path::PathBuf::from("/usr/bin/node"));
    } else if cfg!(target_os = "linux") {
        candidates.push(std::path::PathBuf::from("/usr/local/bin/node"));
        candidates.push(std::path::PathBuf::from("/usr/bin/node"));
    } else if cfg!(windows) {
        if let Ok(pf) = std::env::var("ProgramFiles") {
            candidates.push(
                std::path::PathBuf::from(&pf)
                    .join("nodejs")
                    .join("node.exe"),
            );
        }
        if let Ok(pf) = std::env::var("ProgramFiles(x86)") {
            candidates.push(
                std::path::PathBuf::from(&pf)
                    .join("nodejs")
                    .join("node.exe"),
            );
        }
    }
    candidates
}

/// Resolves a usable Node binary. A user-supplied override is validated
/// strictly; otherwise we probe the login shell, then well-known locations.
fn resolve_node_blocking(override_path: Option<&str>) -> Result<NodeResolution, String> {
    if let Some(raw_override) = override_path {
        let trimmed = raw_override.trim();
        let path = std::path::Path::new(trimmed);
        return match validate_node_at(path) {
            Some(version) => Ok(node_resolution_for(path, &version)),
            None => Err(format!(
                "The Node.js path set in settings (\"{}\") is not usable. Point it at a Node.js {} binary.",
                trimmed, REQUIRED_NODE_RANGE
            )),
        };
    }

    if let Some(found) = detect_node_via_login_shell() {
        if let Some(version) = validate_node_at(&found) {
            return Ok(node_resolution_for(&found, &version));
        }
    }

    for candidate in common_node_candidates() {
        if let Some(version) = validate_node_at(&candidate) {
            return Ok(node_resolution_for(&candidate, &version));
        }
    }

    Err(format!(
        "Node.js {} was not found. Install it from https://nodejs.org, or set the Node.js path in Chrome DevTools MCP settings.",
        REQUIRED_NODE_RANGE
    ))
}

/// Resolves the Node binary to use for the chrome-devtools-mcp sidecar.
/// `nodeOverride` (an absolute path from settings) takes precedence; otherwise
/// the login shell and common install locations are probed. The returned
/// `env_path` is meant to be passed as the `PATH` env var when spawning the
/// sidecar, so a bare `node` command resolves regardless of the GUI app PATH.
#[tauri::command]
async fn resolve_node_path(node_override: Option<String>) -> Result<NodeResolution, String> {
    let override_path = node_override
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string());
    let timeout = Duration::from_secs(NODE_RESOLVE_TIMEOUT_SECS);
    match tokio::time::timeout(
        timeout,
        tokio::task::spawn_blocking(move || resolve_node_blocking(override_path.as_deref())),
    )
    .await
    {
        // timeout(..).await is Result<Result<Result<NodeResolution, String>, JoinError>, Elapsed>:
        // outer Ok = not timed out, middle Ok = spawn_blocking joined, inner is resolve_node_blocking's Result.
        Ok(Ok(inner)) => inner,
        Ok(Err(join_err)) => Err(format!("Node.js resolution failed: {}", join_err)),
        Err(_elapsed) => Err(format!(
            "Node.js resolution timed out after {}s. Set the Node.js path in Chrome DevTools MCP settings.",
            NODE_RESOLVE_TIMEOUT_SECS
        )),
    }
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
            app.manage(SidecarState {
                pid: Mutex::new(None),
            });
            app.manage(McpBridgeState::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_tab,
            switch_tab,
            close_tab,
            get_tab_url,
            extract_content,
            send_browser_tab_notification,
            fetch_html,
            download_youtube_subtitles_with_ytdlp,
            append_app_log,
            get_app_log_path,
            register_sidecar_pid,
            unregister_sidecar_pid,
            resolve_node_path,
            start_mcp_bridge,
            respond_mcp_bridge_request,
        ]);

    #[cfg(feature = "e2e-testing")]
    let builder = builder.plugin(tauri_plugin_playwright::init());

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<SidecarState>() {
                    let Ok(mut guard) = state.pid.lock() else {
                        write_native_log(
                            app_handle,
                            "error",
                            "sidecar",
                            "Cannot lock sidecar PID on exit (mutex poisoned)",
                        );
                        return;
                    };
                    let pid = guard.take();
                    if let Some(pid) = pid {
                        write_native_log(
                            app_handle,
                            "info",
                            "sidecar",
                            &format!("App exiting - killing sidecar PID {}", pid),
                        );
                        #[cfg(unix)]
                        {
                            let _ = std::process::Command::new("kill")
                                .args(["-TERM", &pid.to_string()])
                                .output();
                        }
                        #[cfg(windows)]
                        {
                            let _ = std::process::Command::new("taskkill")
                                .args(["/PID", &pid.to_string(), "/F"])
                                .output();
                        }
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_tab_notification_payload_uses_frontend_field_name() {
        let value = serde_json::to_value(BrowserTabNotificationActionPayload {
            browser_tab_id: "tab-7".to_string(),
        })
        .unwrap();

        assert_eq!(value, serde_json::json!({ "browserTabId": "tab-7" }));
    }

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
        for raw in [
            "https://example.com",
            "https://example.com/path/to/page",
            "https://example.com/search?q=rust&lang=en",
            "https://example.com/page#section",
            "https://docs.rs/tauri/latest/tauri/",
            "https://en.wikipedia.org/wiki/Rust_(programming_language)",
            "https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.0.0",
        ] {
            let parsed: url::Url = raw.parse().unwrap();
            assert!(validate_url_components(&parsed).is_ok(), "{raw}");
        }
    }

    #[test]
    fn node_version_parser_and_range() {
        assert_eq!(parse_node_version("v22.12.0"), Some((22, 12, 0)));
        assert_eq!(parse_node_version("20.19.0\n"), Some((20, 19, 0)));
        assert_eq!(parse_node_version("v23.1.0-beta"), Some((23, 1, 0)));
        assert_eq!(parse_node_version("garbage"), None);
        assert_eq!(parse_node_version("v22"), None);

        assert!(node_version_satisfies(20, 19));
        assert!(node_version_satisfies(22, 12));
        assert!(node_version_satisfies(23, 0));
        assert!(node_version_satisfies(24, 0));
        assert!(!node_version_satisfies(20, 18));
        assert!(!node_version_satisfies(22, 11));
        assert!(!node_version_satisfies(18, 20));
    }

    #[test]
    fn content_type_matching_is_strict() {
        assert!(content_type_is_allowed("text/html; charset=utf-8",));
        assert!(content_type_is_allowed("application/xhtml+xml"));
        assert!(!content_type_is_allowed("text/plain"));
        assert!(!content_type_is_allowed("application/json"));
    }

    #[test]
    fn renderer_log_line_is_single_line_and_sanitized() {
        let line = format_renderer_log_line(RendererLogEntry {
            timestamp: Some("2026-07-05T01:02:03.004Z".to_string()),
            level: "warn\nbad".to_string(),
            target: "console.error".to_string(),
            message: "first line\nsecond line\rthird line".to_string(),
        });

        assert_eq!(
            line,
            "[2026-07-05T01:02:03.004Z] [warn_bad] [console.error] first line\\nsecond line\\rthird line",
        );
        assert!(!line.contains('\n'));
        assert!(!line.contains('\r'));
    }

    #[test]
    fn log_message_truncates_long_values() {
        let long = "x".repeat(MAX_LOG_MESSAGE_CHARS + 1);
        let sanitized = sanitize_log_message(&long);

        assert!(sanitized.ends_with("... [truncated]"));
        assert!(sanitized.len() < long.len() + "... [truncated]".len());
    }

    #[test]
    fn log_rotation_replaces_the_single_backup_before_size_limit() {
        let unique = uuid::Uuid::new_v4();
        let test_dir = std::env::temp_dir().join(format!("deep-search-log-{unique}"));
        let log_path = test_dir.join(APP_LOG_FILENAME);
        let backup_path = test_dir.join(format!("{APP_LOG_FILENAME}.1"));
        fs::create_dir_all(&test_dir).unwrap();
        fs::write(&log_path, b"current").unwrap();
        fs::write(&backup_path, b"stale-backup").unwrap();

        rotate_log_file_if_needed(&log_path, 4, 10).unwrap();

        assert!(!log_path.exists());
        assert_eq!(fs::read(&backup_path).unwrap(), b"current");
        fs::remove_dir_all(test_dir).unwrap();
    }

    #[test]
    fn log_rotation_keeps_current_file_within_size_limit() {
        let unique = uuid::Uuid::new_v4();
        let test_dir = std::env::temp_dir().join(format!("deep-search-log-{unique}"));
        let log_path = test_dir.join(APP_LOG_FILENAME);
        fs::create_dir_all(&test_dir).unwrap();
        fs::write(&log_path, b"current").unwrap();

        rotate_log_file_if_needed(&log_path, 3, 10).unwrap();

        assert_eq!(fs::read(&log_path).unwrap(), b"current");
        assert!(!test_dir.join(format!("{APP_LOG_FILENAME}.1")).exists());
        fs::remove_dir_all(test_dir).unwrap();
    }

    #[test]
    fn log_append_caps_oversized_batches_by_bytes() {
        let unique = uuid::Uuid::new_v4();
        let test_dir = std::env::temp_dir().join(format!("deep-search-log-{unique}"));
        let log_path = test_dir.join(APP_LOG_FILENAME);
        fs::create_dir_all(&test_dir).unwrap();

        append_lines_to_log_file(
            &log_path,
            vec!["é".repeat(20), "x".repeat(30), "latest".to_string()],
            16,
        )
        .unwrap();

        assert!(fs::metadata(&log_path).unwrap().len() <= 16);
        let backup_path = test_dir.join(format!("{APP_LOG_FILENAME}.1"));
        assert!(fs::metadata(backup_path).unwrap().len() <= 16);
        fs::remove_dir_all(test_dir).unwrap();
    }

    #[test]
    fn log_append_caps_an_oversized_legacy_file_to_a_utf8_tail() {
        let unique = uuid::Uuid::new_v4();
        let test_dir = std::env::temp_dir().join(format!("deep-search-log-{unique}"));
        let log_path = test_dir.join(APP_LOG_FILENAME);
        fs::create_dir_all(&test_dir).unwrap();
        fs::write(&log_path, format!("{}é-tail", "prefix".repeat(100))).unwrap();

        append_lines_to_log_file(&log_path, Vec::<String>::new(), 16).unwrap();

        let capped = fs::read(&log_path).unwrap();
        assert!(capped.len() <= 16);
        assert!(std::str::from_utf8(&capped).is_ok());
        assert!(String::from_utf8(capped).unwrap().ends_with("é-tail"));
        fs::remove_dir_all(test_dir).unwrap();
    }

    #[test]
    fn youtube_video_url_validation_accepts_video_urls() {
        for raw in [
            "https://www.youtube.com/watch?v=abc123DEF45",
            "https://youtu.be/abc123DEF45",
            "https://www.youtube.com/shorts/abc123DEF45",
            "https://www.youtube.com/embed/abc123DEF45",
        ] {
            assert!(validate_youtube_video_url(raw).is_ok(), "{raw}");
        }
    }

    #[test]
    fn youtube_video_url_validation_rejects_non_video_urls() {
        for raw in [
            "http://www.youtube.com/watch?v=abc123DEF45",
            "https://www.youtube.com/@openai",
            "https://example.com/watch?v=abc123DEF45",
            "https://www.youtube.com/watch?v=bad",
        ] {
            assert!(validate_youtube_video_url(raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn youtube_subtitle_download_args_download_auto_vtt_without_video() {
        let args = youtube_subtitle_download_args("https://www.youtube.com/watch?v=abc123DEF45");
        assert!(args.iter().any(|arg| arg == "--skip-download"));
        assert!(args.iter().any(|arg| arg == "--write-auto-subs"));
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--sub-langs" && pair[1] == "en"));
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--sub-format" && pair[1] == "vtt"));
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "-o" && pair[1] == "subtitle.%(ext)s"));
    }

    #[test]
    fn downloaded_subtitle_lookup_reports_ytdlp_output_when_only_partial_file_exists() {
        let temp_dir = std::env::temp_dir().join(format!(
            "deep-search-ytdlp-partial-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(temp_dir.join("subtitle.en.vtt.part"), b"partial").unwrap();

        let output = Command::new("sh")
            .args([
                "-c",
                "printf 'There are no subtitles for the requested languages'",
            ])
            .output()
            .unwrap();
        let error = find_downloaded_subtitle_file(&temp_dir, &output).unwrap_err();
        let _ = fs::remove_dir_all(&temp_dir);

        assert!(error.contains("yt-dlp did not produce a subtitle file"));
        assert!(error.contains("There are no subtitles"));
    }

    #[test]
    fn parses_youtube_auto_caption_vtt_without_rolling_duplicates() {
        let vtt = r#"WEBVTT
Kind: captions
Language: en

00:00:14.639 --> 00:00:18.950 align:start position:0%
[Music]
Hi<00:00:14.880><c> there</c><00:00:15.200><c> guys.</c>

00:00:18.950 --> 00:00:18.960 align:start position:0%
Hi there guys.

00:00:18.960 --> 00:00:24.390 align:start position:0%
Hi there guys.
So<00:00:19.199><c> this</c><00:00:19.359><c> is</c><00:00:19.520><c> not</c><00:00:19.680><c> the</c><00:00:19.840><c> Caribbean</c><00:00:21.119><c>.</c>
"#;
        let cues = parse_vtt_cues(vtt).unwrap();

        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].start_ms, 14_639);
        assert_eq!(cues[0].duration_ms, 4_311);
        assert_eq!(cues[0].text, "[Music]\nHi there guys.");
        assert_eq!(cues[1].text, "So this is not the Caribbean.");
    }

    #[test]
    fn is_blocked_ip_blocks_private_ipv4() {
        use std::net::Ipv4Addr;
        let blocked: &[&str] = &[
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "198.18.0.1",
            "224.0.0.1",
            "240.0.0.1",
            "127.0.0.1",
            "0.0.0.0",
        ];
        for s in blocked {
            let ip: Ipv4Addr = s.parse().unwrap();
            assert!(is_blocked_ip(IpAddr::V4(ip)), "should block {}", s);
        }
    }

    #[test]
    fn is_blocked_ip_allows_public_ipv4() {
        use std::net::Ipv4Addr;
        let allowed: &[&str] = &["8.8.8.8", "1.1.1.1", "93.184.216.34"];
        for s in allowed {
            let ip: Ipv4Addr = s.parse().unwrap();
            assert!(!is_blocked_ip(IpAddr::V4(ip)), "should allow {}", s);
        }
    }

    #[test]
    fn is_blocked_ip_blocks_private_ipv6() {
        use std::net::Ipv6Addr;
        let blocked: &[&str] = &["::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1", "::"];
        for s in blocked {
            let ip: Ipv6Addr = s.parse().unwrap();
            assert!(is_blocked_ip(IpAddr::V6(ip)), "should block {}", s);
        }
    }

    #[test]
    fn is_blocked_ip_handles_ipv4_mapped_ipv6() {
        use std::net::Ipv6Addr;
        let ip: Ipv6Addr = "::ffff:127.0.0.1".parse().unwrap();
        assert!(is_blocked_ip(IpAddr::V6(ip)));
        let ip: Ipv6Addr = "::ffff:192.168.1.1".parse().unwrap();
        assert!(is_blocked_ip(IpAddr::V6(ip)));
        let ip: Ipv6Addr = "::ffff:8.8.8.8".parse().unwrap();
        assert!(!is_blocked_ip(IpAddr::V6(ip)));
    }
}
