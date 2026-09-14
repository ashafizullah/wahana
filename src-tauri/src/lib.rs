use keyring::Entry;
use serde::Serialize;
use std::{fs, path::PathBuf, time::SystemTime};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl,
};

const SERVICE: &str = "com.ashafizullah.wahana";

fn entry(profile: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, profile).map_err(|e| e.to_string())
}

/// Store the WAHA API key in the OS keychain (macOS Keychain / Windows Credential Manager).
#[tauri::command]
fn save_api_key(profile: String, api_key: String) -> Result<(), String> {
    entry(&profile)?.set_password(&api_key).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_api_key(profile: String) -> Result<Option<String>, String> {
    match entry(&profile)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_api_key(profile: String) -> Result<(), String> {
    match entry(&profile)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ── Media cache (downloaded media kept on disk so it is not fetched twice) ──

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("media");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Keys are message ids + extension; keep them filesystem-safe.
fn safe_key(key: &str) -> String {
    key.chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' })
        .collect()
}

#[derive(Serialize)]
struct CacheStats {
    bytes: u64,
    files: u64,
    path: String,
}

fn scan(dir: &PathBuf) -> Vec<(PathBuf, u64, SystemTime)> {
    fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| {
                    let md = e.metadata().ok()?;
                    if !md.is_file() {
                        return None;
                    }
                    Some((e.path(), md.len(), md.modified().unwrap_or(SystemTime::UNIX_EPOCH)))
                })
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
fn media_cache_has(app: AppHandle, key: String) -> Result<bool, String> {
    Ok(cache_dir(&app)?.join(safe_key(&key)).is_file())
}

/// Returns the cached bytes as a raw ArrayBuffer (no JSON overhead).
#[tauri::command]
fn media_cache_get(app: AppHandle, key: String) -> Result<Response, String> {
    let path = cache_dir(&app)?.join(safe_key(&key));
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    // Touch mtime so eviction is LRU-ish.
    let _ = fs::File::open(&path).and_then(|f| f.set_modified(SystemTime::now()));
    Ok(Response::new(bytes))
}

/// Body is the raw file; `x-key` header names it, `x-limit` (bytes) caps the cache size.
#[tauri::command]
fn media_cache_put(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    };
    let key = header("x-key").ok_or("missing x-key")?;
    let limit: u64 = header("x-limit").and_then(|s| s.parse().ok()).unwrap_or(0);
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        InvokeBody::Json(_) => return Err("expected raw body".into()),
    };
    let dir = cache_dir(&app)?;
    fs::write(dir.join(safe_key(&key)), &bytes).map_err(|e| e.to_string())?;

    if limit > 0 {
        let mut files = scan(&dir);
        let mut total: u64 = files.iter().map(|f| f.1).sum();
        if total > limit {
            files.sort_by_key(|f| f.2); // oldest first
            for (path, size, _) in files {
                if total <= limit {
                    break;
                }
                if fs::remove_file(&path).is_ok() {
                    total -= size;
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn media_cache_stats(app: AppHandle) -> Result<CacheStats, String> {
    let dir = cache_dir(&app)?;
    let files = scan(&dir);
    Ok(CacheStats {
        bytes: files.iter().map(|f| f.1).sum(),
        files: files.len() as u64,
        path: dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn media_cache_clear(app: AppHandle) -> Result<(), String> {
    let dir = cache_dir(&app)?;
    fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())
}

/// Bring the main window back (it is hidden, not closed, when the user closes it).
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// ── WhatsApp Web (plain, un-modified web.whatsapp.com embedded as a child webview) ──

const WA_WEB_LABEL: &str = "whatsapp-web";

/// WhatsApp Web refuses unknown user agents, so present as a mainstream browser.
#[cfg(target_os = "macos")]
const WA_WEB_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
#[cfg(not(target_os = "macos"))]
const WA_WEB_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// Show WhatsApp Web inside the main window at the given logical rect (the area the
/// frontend reserves for it). Created lazily on first call; afterwards just moved/shown.
/// Session cookies persist in the app's webview data dir, so QR login happens once.
///
/// `viewport_height` is the main webview's `window.innerHeight`. Child webviews are laid
/// out relative to the window's content view, which on recent macOS extends under the
/// title bar while the main webview does not — so shift by the difference.
#[tauri::command]
fn wa_web_set_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_height: f64,
) -> Result<(), String> {
    let window = app.get_window("main").ok_or("main window not found")?;
    let inner_h = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?)
        .height;
    let title_offset = (inner_h - viewport_height).max(0.0);
    let pos = LogicalPosition::new(x, y + title_offset);
    let size = LogicalSize::new(width, height);
    if let Some(wv) = app.get_webview(WA_WEB_LABEL) {
        wv.set_position(pos).map_err(|e| e.to_string())?;
        wv.set_size(size).map_err(|e| e.to_string())?;
        return wv.show().map_err(|e| e.to_string());
    }
    let url = tauri::Url::parse("https://web.whatsapp.com").map_err(|e| e.to_string())?;
    let builder = WebviewBuilder::new(WA_WEB_LABEL, WebviewUrl::External(url)).user_agent(WA_WEB_UA);
    window.add_child(builder, pos, size).map(|_| ()).map_err(|e| e.to_string())
}

/// Hide (not destroy) the WhatsApp Web webview when its tab is not active.
#[tauri::command]
fn wa_web_hide(app: AppHandle) -> Result<(), String> {
    match app.get_webview(WA_WEB_LABEL) {
        Some(wv) => wv.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:wahana.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "scheduler tables",
                            sql: include_str!("../migrations/001_scheduler.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "quick replies and broadcasts",
                            sql: include_str!("../migrations/002_quick_replies_broadcasts.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            save_api_key,
            get_api_key,
            delete_api_key,
            media_cache_has,
            media_cache_get,
            media_cache_put,
            media_cache_stats,
            media_cache_clear,
            wa_web_set_bounds,
            wa_web_hide
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open Wahana", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Wahana", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .icon_as_template(false)
                .tooltip("Wahana")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close = hide to tray; the app keeps receiving realtime events.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app, event);
            }
        });
}
