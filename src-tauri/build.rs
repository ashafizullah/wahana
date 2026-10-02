use tauri_build::{AppManifest, Attributes};

/// Every `#[tauri::command]` in lib.rs. Listing them generates `allow-<cmd>` / `deny-<cmd>`
/// permissions; with an app manifest, the main webview needs an explicit grant for each
/// (see capabilities/default.json).
const COMMANDS: &[&str] = &[
    "save_api_key",
    "get_api_key",
    "delete_api_key",
    "media_cache_has",
    "media_cache_get",
    "media_cache_put",
    "media_cache_stats",
    "media_cache_clear",
    "wa_native_accounts",
    "wa_native_add",
    "wa_native_start",
    "wa_native_stop",
    "wa_native_logout",
    "wa_native_remove",
    "wa_native_send_text",
    "wa_native_chats",
    "wa_native_messages",
    "wa_native_mark_read",
    "wa_native_rename",
    "wa_native_picture",
    "wa_native_load_older",
    "wa_native_media",
    "wa_native_send_media",
    "wa_native_chat_info",
    "wa_native_chat_media",
    "wa_native_group_action",
    "wa_native_group_requests",
    "wa_native_send_receipt",
    "wa_native_set_typing",
    "wa_native_statuses",
    "wa_native_status_viewed",
    "wa_native_post_status_text",
    "wa_native_post_status_media",
    "wa_native_delete_status",
    "wa_native_labels",
    "wa_native_chat_labels",
    "wa_native_label_map",
    "wa_native_label_create",
    "wa_native_label_delete",
    "wa_native_label_link",
    "wa_native_pin_chat",
];

fn main() {
    tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}
