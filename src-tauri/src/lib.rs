mod media_cache;
mod secrets;
mod waweb;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// Bring the main window back (it is hidden, not closed, when the user closes it).
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

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
            secrets::save_api_key,
            secrets::get_api_key,
            secrets::delete_api_key,
            media_cache::media_cache_has,
            media_cache::media_cache_get,
            media_cache::media_cache_put,
            media_cache::media_cache_stats,
            media_cache::media_cache_clear,
            waweb::wa_web_isolation_supported,
            waweb::wa_web_set_bounds,
            waweb::wa_web_hide,
            waweb::wa_web_remove
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open Wahana", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Wahana", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/tray.png"
                ))?)
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
                            std::thread::sleep(std::time::Duration::from_secs(5));
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
