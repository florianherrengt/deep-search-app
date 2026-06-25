use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::str::FromStr;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use ipnet::IpNet;

use reqwest::header::{ACCEPT, CONTENT_TYPE, LOCATION, USER_AGENT};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

const TAB_BAR_HEIGHT: f64 = 40.0;
const PAGE_LOAD_TIMEOUT_SECS: u64 = 30;
const EVAL_RECV_TIMEOUT_SECS: u64 = 5;
const FETCH_TIMEOUT_SECS: u64 = 10;
const MAX_FETCH_REDIRECTS: usize = 5;
const MAX_HTML_BYTES: usize = 5 * 1024 * 1024;

struct SidecarState {
    pid: Mutex<Option<u32>>,
}

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
fn register_sidecar_pid(state: tauri::State<SidecarState>, pid: u32) -> Result<(), String> {
    eprintln!("[sidecar] Registered sidecar PID {}", pid);
    *state.pid.lock().map_err(|e| e.to_string())? = Some(pid);
    Ok(())
}

#[tauri::command]
fn unregister_sidecar_pid(state: tauri::State<SidecarState>) -> Result<(), String> {
    eprintln!("[sidecar] Unregistered sidecar PID");
    *state.pid.lock().map_err(|e| e.to_string())? = None;
    Ok(())
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
    let output = std::process::Command::new(path).arg("--version").output().ok()?;
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
            candidates.push(std::path::PathBuf::from(&pf).join("nodejs").join("node.exe"));
        }
        if let Ok(pf) = std::env::var("ProgramFiles(x86)") {
            candidates.push(std::path::PathBuf::from(&pf).join("nodejs").join("node.exe"));
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
            app.manage(SidecarState { pid: Mutex::new(None) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_tab,
            switch_tab,
            close_tab,
            extract_content,
            fetch_html,
            register_sidecar_pid,
            unregister_sidecar_pid,
            resolve_node_path,
        ]);

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_webdriver::init());

    #[cfg(feature = "e2e-testing")]
    let builder = builder.plugin(tauri_plugin_playwright::init());

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<SidecarState>() {
                    let Ok(mut guard) = state.pid.lock() else {
                        eprintln!("[sidecar] Cannot lock sidecar PID on exit (mutex poisoned)");
                        return;
                    };
                    let pid = guard.take();
                    if let Some(pid) = pid {
                        eprintln!("[sidecar] App exiting — killing sidecar PID {}", pid);
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
        assert!(content_type_is_allowed(
            "text/html; charset=utf-8",
        ));
        assert!(content_type_is_allowed("application/xhtml+xml"));
        assert!(!content_type_is_allowed("text/plain"));
        assert!(!content_type_is_allowed("application/json"));
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
