use tauri_build::{AppManifest, Attributes};

/// Every `#[tauri::command]` in lib.rs. Listing them generates `allow-<cmd>` / `deny-<cmd>`
/// permissions so the capabilities can grant the WhatsApp Web child webview (a remote
/// origin) exactly one command; once an app manifest exists, the main webview also needs
/// explicit grants (see capabilities/default.json).
const COMMANDS: &[&str] = &[
    "save_api_key",
    "get_api_key",
    "delete_api_key",
    "media_cache_has",
    "media_cache_get",
    "media_cache_put",
    "media_cache_stats",
    "media_cache_clear",
    "wa_web_isolation_supported",
    "wa_web_set_bounds",
    "wa_web_hide",
    "wa_web_remove",
    "wa_web_report_unread",
];

fn main() {
    tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}
