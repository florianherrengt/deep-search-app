use std::sync::mpsc;
use std::time::Duration;

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl,
};

const TAB_BAR_HEIGHT: f64 = 40.0;
const PAGE_LOAD_TIMEOUT_SECS: u64 = 30;
const EVAL_RECV_TIMEOUT_SECS: u64 = 5;

fn content_size(window: &tauri::Window) -> Result<(f64, f64), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let logical = size.to_logical::<f64>(scale);
    Ok((logical.width, logical.height))
}

fn resize_all_webviews(app: &AppHandle) -> Result<(), String> {
    let window = app.get_window("main").ok_or("no main window")?;
    let (w, h) = content_size(&window)?;
    for (_label, wv) in app.webviews() {
        if wv.label() == "main" {
            continue;
        }
        let _ = wv.set_position(LogicalPosition::new(0.0, TAB_BAR_HEIGHT));
        let _ = wv.set_size(LogicalSize::new(w, h - TAB_BAR_HEIGHT));
    }
    Ok(())
}

#[tauri::command]
async fn open_tab(app: AppHandle, url: String, id: String) -> Result<(), String> {
    let window = app.get_window("main").ok_or("no main window")?;
    let (w, h) = content_size(&window)?;

    let parsed_url: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;
    let wv = WebviewBuilder::new(&id, WebviewUrl::External(parsed_url));

    window
        .add_child(
            wv,
            LogicalPosition::new(0.0, TAB_BAR_HEIGHT),
            LogicalSize::new(w, h - TAB_BAR_HEIGHT),
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
        match wv.eval_with_callback(
            "(function(){return document.readyState})()",
            move |result| {
                let _ = tx.send(result);
            },
        ) {
            Ok(_) => {
                if let Ok(ready) = rx.recv_timeout(Duration::from_secs(EVAL_RECV_TIMEOUT_SECS)) {
                    if ready.contains("complete") {
                        break;
                    }
                }
            }
            Err(_) => {}
        }
        if start.elapsed() > timeout {
            return Err("page load timeout".to_string());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    tokio::time::sleep(Duration::from_secs(2)).await;

    let (tx, rx) = mpsc::channel::<String>();
    wv.eval_with_callback(
        "document.documentElement.innerHTML",
        move |result| {
            let _ = tx.send(result);
        },
    )
    .map_err(|e| e.to_string())?;

    rx.recv_timeout(Duration::from_secs(EVAL_RECV_TIMEOUT_SECS))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_tabs(app: AppHandle) -> Result<(), String> {
    resize_all_webviews(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            open_tab,
            switch_tab,
            close_tab,
            extract_content,
            resize_tabs,
        ]);

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_webdriver::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
