use keyring::Entry;
use tauri_plugin_notification::NotificationExt;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::{Duration, SystemTime},
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{DownloadEvent, NewWindowResponse},
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

/// Keys are message ids + extension. Message ids contain `@`, `:` and other characters
/// that are not filesystem-safe; a lossy substitution would let two distinct ids collide
/// (`…@c.us_x` vs `…_c_us_x`), so hash the id and keep only the extension readable.
fn safe_key(key: &str) -> String {
    // FNV-1a 64-bit: tiny, dependency-free, plenty for a local cache namespace.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in key.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    let ext = key
        .rsplit_once('.')
        .map(|(_, e)| e)
        .filter(|e| !e.is_empty() && e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or("bin");
    format!("{h:016x}.{ext}")
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
    // (Needs a writable handle: on Windows `set_modified` fails on a read-only one.)
    let _ = fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .and_then(|f| f.set_modified(SystemTime::now()));
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

// ── WhatsApp Web (plain, un-modified web.whatsapp.com embedded as child webviews) ──
//
// Each "WhatsApp Web session" the user adds is its own child webview with its own
// cookie/storage jar, so several accounts can be logged in side by side.

/// WhatsApp Web refuses unknown user agents, so present as a mainstream browser.
#[cfg(target_os = "macos")]
const WA_WEB_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
#[cfg(not(target_os = "macos"))]
const WA_WEB_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// Append a line to `<app local data>/waweb.log` so problems with the embedded
/// WhatsApp Web (which has no devtools in release builds) can be reported.
fn wa_web_log(app: &AppHandle, msg: impl AsRef<str>) {
    use std::io::Write;
    let Ok(dir) = app.path().app_local_data_dir() else { return };
    let _ = fs::create_dir_all(&dir);
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(dir.join("waweb.log")) {
        let ts = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{ts} {}", msg.as_ref());
    }
}

/// Session ids are 32 hex chars (a dashless UUID) generated by the frontend.
fn wa_web_label(id: &str) -> Result<String, String> {
    if id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(format!("waweb-{id}"))
    } else {
        Err("invalid WhatsApp Web session id".into())
    }
}

/// Show a WhatsApp Web session inside the main window at the given logical rect (the area
/// the frontend reserves for it). Created lazily on first call; afterwards just moved/shown.
///
/// `viewport_height` is the main webview's `window.innerHeight`. Child webviews are laid
/// out relative to the window's content view, which on recent macOS extends under the
/// title bar while the main webview does not — so shift by the difference.
// `async`: on Windows a sync command runs on the main thread inside the main webview's IPC
// callback, and creating a WebView2 from there (wry pumps messages waiting for it) never
// completes — the app keeps running but the child webview is stuck forever.
/// Child webviews whose creation is still in progress, with the latest bounds requested
/// for them. `wa_web_set_bounds` is called several times in quick succession when a pane
/// mounts (initial sync, ResizeObserver, layout effect); without this guard each call sees
/// "no webview yet" and creates its own.
static WA_WEB_CREATING: LazyLock<Mutex<HashMap<String, (LogicalPosition<f64>, LogicalSize<f64>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Multi-account WhatsApp Web needs per-webview storage. On macOS that is
/// `data_store_identifier`, which WebKit only honours from macOS 14; below that every
/// session would share one login (and removing one would log out all of them).
#[tauri::command]
fn wa_web_isolation_supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        let major = std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|v| v.trim().split('.').next()?.parse::<u32>().ok());
        return major.map_or(true, |m| m >= 14);
    }
    #[cfg(not(target_os = "macos"))]
    true
}

#[tauri::command]
async fn wa_web_set_bounds(
    app: AppHandle,
    id: String,
    name: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_height: f64,
) -> Result<(), String> {
    let label = wa_web_label(&id)?;
    let window = app.get_window("main").ok_or("main window not found")?;
    let inner_h = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?)
        .height;
    // Only macOS lays children out under the title bar; elsewhere the delta is scrollbar
    // or rounding noise that would push the child down.
    let title_offset = if cfg!(target_os = "macos") { (inner_h - viewport_height).max(0.0) } else { 0.0 };
    let pos = LogicalPosition::new(x, y + title_offset);
    let size = LogicalSize::new(width, height);
    if let Some(wv) = app.get_webview(&label) {
        wv.set_position(pos).map_err(|e| e.to_string())?;
        wv.set_size(size).map_err(|e| e.to_string())?;
        // Keep the notification suffix in step with renames.
        if let Ok(json) = serde_json::to_string(&name) {
            let _ = wv.eval(&format!("window.__wahanaSessionName = {json};"));
        }
        return wv.show().map_err(|e| e.to_string());
    }
    {
        let mut creating = WA_WEB_CREATING.lock().map_err(|e| e.to_string())?;
        if let Some(latest) = creating.get_mut(&label) {
            // Another call is creating it; it applies our bounds when done.
            *latest = (pos, size);
            return Ok(());
        }
        creating.insert(label.clone(), (pos, size));
    }
    let result = wa_web_create(&app, &window, &label, &id, &name, pos, size, x, y, width, height, title_offset, inner_h, viewport_height);
    let latest = WA_WEB_CREATING.lock().map_err(|e| e.to_string())?.remove(&label);
    if result.is_ok() {
        if let (Some((p, s)), Some(wv)) = (latest, app.get_webview(&label)) {
            if p.x != pos.x || p.y != pos.y || s.width != size.width || s.height != size.height {
                let _ = wv.set_position(p);
                let _ = wv.set_size(s);
            }
        }
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn wa_web_create(
    app: &AppHandle,
    window: &tauri::Window,
    label: &str,
    id: &str,
    name: &str,
    pos: LogicalPosition<f64>,
    size: LogicalSize<f64>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    title_offset: f64,
    inner_h: f64,
    viewport_height: f64,
) -> Result<(), String> {
    let url = tauri::Url::parse("https://web.whatsapp.com").map_err(|e| e.to_string())?;
    let shim = WA_WEB_NOTIFICATION_SHIM.replace(
        "__WA_SESSION_NAME__",
        &serde_json::to_string(&name).map_err(|e| e.to_string())?,
    );
    #[allow(unused_mut)]
    let mut builder = WebviewBuilder::new(label, WebviewUrl::External(url))
        .user_agent(WA_WEB_UA)
        .initialization_script(shim)
        // target=_blank links (e.g. URLs in chats) go to the system browser.
        .on_new_window(|url, _| {
            let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            NewWindowResponse::Deny
        })
        // wry already picks ~/Downloads/<suggested name> and de-duplicates; just allow it
        // and tell the user when it lands.
        .on_download(|webview, event| {
            if let DownloadEvent::Finished { path: Some(path), success: true, .. } = event {
                let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let _ = webview
                    .notification()
                    .builder()
                    .title("Download complete")
                    .body(format!("{name} saved to Downloads"))
                    .show();
            }
            true
        });
    // Separate storage per session so each can hold a different WhatsApp login.
    #[cfg(target_os = "macos")]
    {
        let mut ident = [0u8; 16];
        for (i, chunk) in id.as_bytes().chunks(2).enumerate() {
            ident[i] = u8::from_str_radix(std::str::from_utf8(chunk).unwrap_or("0"), 16).unwrap_or(0);
        }
        builder = builder.data_store_identifier(ident);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let dir = wa_web_data_dir(app, id)?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        wa_web_log(app, format!("data dir {}", dir.display()));
        builder = builder.data_directory(dir);
    }
    wa_web_log(app, format!("create {label} at ({x},{y}) {width}x{height} title_offset={title_offset} inner_h={inner_h} viewport_h={viewport_height}"));
    match window.add_child(builder, pos, size) {
        Ok(wv) => {
            wa_web_log(app, format!("created {label} url={:?}", wv.url().map(|u| u.to_string())));
            Ok(())
        }
        Err(e) => {
            wa_web_log(app, format!("create {label} FAILED: {e}"));
            Err(e.to_string())
        }
    }
}

/// Hide (not destroy) a session's webview when it is not on screen.
#[tauri::command]
fn wa_web_hide(app: AppHandle, id: String) -> Result<(), String> {
    match app.get_webview(&wa_web_label(&id)?) {
        Some(wv) => {
            let r = wv.hide().map_err(|e| e.to_string());
            wa_web_log(&app, format!("hide {id}: {r:?}"));
            r
        }
        None => {
            wa_web_log(&app, format!("hide {id}: no such webview"));
            Ok(())
        }
    }
}

/// Remove a session: wipe its cookies/storage (logs the account out locally) and destroy
/// the webview.
#[tauri::command]
async fn wa_web_remove(app: AppHandle, id: String) -> Result<(), String> {
    let label = wa_web_label(&id)?;
    let wv = app.get_webview(&label);
    if let Some(wv) = &wv {
        // Dispatched to the event loop, not done when this returns: closing right away can
        // destroy the webview first and leave the account logged in.
        wv.clear_all_browsing_data().map_err(|e| e.to_string())?;
        let _ = wv.hide();
    }
    #[cfg(not(target_os = "macos"))]
    let dir = wa_web_data_dir(&app, &id).ok();
    let log_app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        if let Some(wv) = wv {
            let r = wv.close();
            wa_web_log(&log_app, format!("remove {id}: close {r:?}"));
        }
        #[cfg(not(target_os = "macos"))]
        if let Some(dir) = dir {
            // Give the (now closed) browser process a moment to release its files.
            std::thread::sleep(Duration::from_millis(1500));
            let r = fs::remove_dir_all(&dir);
            wa_web_log(&log_app, format!("remove {id}: data dir {r:?}"));
        }
        #[cfg(target_os = "macos")]
        let _ = &log_app;
    });
    Ok(())
}

/// Per-session browser profile for WhatsApp Web on Windows/Linux. Lives *next to* the
/// app's data dir (`<identifier>.waweb/<id>`), not inside it: on Windows the app dir is
/// the main webview's WebView2 user data folder, and one profile nested inside another
/// is asking for trouble (clearing/deleting the outer one takes the sessions with it).
#[cfg(not(target_os = "macos"))]
fn wa_web_data_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let base = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let name = base
        .file_name()
        .map(|n| format!("{}.waweb", n.to_string_lossy()))
        .unwrap_or_else(|| "waweb".into());
    Ok(base.parent().unwrap_or(&base).join(name).join(id))
}

/// WKWebView/WebView2 have no native `Notification` UI, so WhatsApp Web's notifications
/// would silently vanish. Replace the API with a thin shim that forwards to the OS
/// notification center through Tauri's notification plugin. Only the `Notification`
/// global is touched; the page itself is left as is.
const WA_WEB_NOTIFICATION_SHIM: &str = r#"
(() => {
  window.__wahanaSessionName = __WA_SESSION_NAME__;
  const send = (title, body) => {
    const t = window.__TAURI_INTERNALS__;
    if (!t) return;
    t.invoke("plugin:notification|notify", { options: { title: `${title} · ${window.__wahanaSessionName}`, body } }).catch(() => {});
  };
  class WahanaNotification extends EventTarget {
    static permission = "granted";
    static maxActions = 0;
    static requestPermission(cb) {
      if (typeof cb === "function") cb("granted");
      return Promise.resolve("granted");
    }
    constructor(title, opts = {}) {
      super();
      this.title = String(title ?? "");
      this.body = String(opts.body ?? "");
      this.tag = opts.tag;
      this.icon = opts.icon;
      this.data = opts.data;
      this.onclick = this.onclose = this.onerror = this.onshow = null;
      send(this.title, this.body);
    }
    close() {}
  }
  Object.defineProperty(window, "Notification", { value: WahanaNotification, writable: true, configurable: true });
})();
"#;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
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
                        tauri_plugin_sql::Migration {
                            version: 3,
                            description: "auto-reply rules and log",
                            sql: include_str!("../migrations/003_auto_reply.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 4,
                            description: "quick replies per session",
                            sql: include_str!("../migrations/004_quick_replies_session.sql"),
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 5,
                            description: "schedule anchor time, auto-reply log index",
                            sql: include_str!("../migrations/005_schedule_anchor.sql"),
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
            wa_web_isolation_supported,
            wa_web_set_bounds,
            wa_web_hide,
            wa_web_remove
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
                    "quit" => {
                        app.exit(0);
                        // If the event loop is stuck (e.g. a webview creation still pumping
                        // messages on the main thread), it never reaches the exit; don't
                        // leave the user with a zombie tray icon.
                        std::thread::spawn(|| {
                            std::thread::sleep(Duration::from_secs(5));
                            std::process::exit(0);
                        });
                    }
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
