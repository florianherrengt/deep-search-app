mod research_search;

use std::sync::mpsc;
use std::time::Duration;

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl,
};
use research_search::{Database, SearchResult, ResearchFolder};

const TAB_BAR_HEIGHT: f64 = 40.0;
const PAGE_LOAD_TIMEOUT_SECS: u64 = 30;
const EVAL_RECV_TIMEOUT_SECS: u64 = 5;

#[tauri::command]
async fn open_tab(app: AppHandle, url: String, id: String) -> Result<(), String> {
    let window = app.get_window("main").ok_or("no main window")?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let physical = window.inner_size().map_err(|e| e.to_string())?;
    let logical = physical.to_logical::<f64>(scale);

    let parsed_url: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;
    let wv = WebviewBuilder::new(&id, WebviewUrl::External(parsed_url));

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
fn register_research_folder(
    app: AppHandle,
    name: String,
    query: String,
) -> Result<i64, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    research_search::indexing::register_folder(&conn, &name, &query)
}

#[tauri::command]
async fn index_research_file(
    app: AppHandle,
    api_key: String,
    folder: String,
    filename: String,
    content: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let db = app.state::<Database>();
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        research_search::indexing::index_file(&conn, &api_key, &folder, &filename, &content)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn search_research(
    app: AppHandle,
    api_key: String,
    query: String,
    folder: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<SearchResult>, String> {
    tokio::task::spawn_blocking(move || {
        let db = app.state::<Database>();
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        research_search::search::search(&conn, &api_key, &query, folder.as_deref(), limit)
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
    api_key: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let db = app.state::<Database>();
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let search_results_dir = app_data.join("search-results");

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

        let _ = research_search::indexing::register_folder(&conn, &folder_name, "");

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
                &conn, &api_key, &folder_name, &filename, &content,
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
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
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
            register_research_folder,
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
