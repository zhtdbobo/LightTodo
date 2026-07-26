// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod credential_store;
mod crypto;
mod database;
mod models;
mod sync;
mod sync_manifest;
mod webdav;

use commands::AppState;
use database::Database;
use std::sync::{atomic::AtomicBool, Arc};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

fn main() {
    // 初始化数据库
    let app_dir = dirs::data_dir()
        .expect("Failed to get data directory")
        .join("lighttodo");

    std::fs::create_dir_all(&app_dir).expect("Failed to create app directory");

    let db_path = app_dir.join("notes.db");
    let db = Database::new(db_path).expect("Failed to initialize database");
    if let Err(error) = sync::migrate_webdav_credential(&db) {
        // A temporary credential-service failure must not make local notes
        // unusable.  Sync/config commands will keep returning the actionable
        // storage error until the migration can be retried successfully.
        eprintln!("Failed to migrate WebDAV credential: {error}");
    }
    if let Err(error) = crypto::migrate_legacy_password_notes(&db) {
        // Keep the database intact and let the UI mark affected password rows
        // as unavailable instead of aborting the entire application startup.
        eprintln!("Failed to encrypt legacy password notes: {error}");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState {
            db: Arc::new(db),
            sync_lock: Arc::new(tokio::sync::Mutex::new(())),
            vault_lock: Arc::new(tokio::sync::Mutex::new(())),
            sync_cancelled: Arc::new(AtomicBool::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_all_notes,
            commands::get_note_by_id,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
            commands::search_notes,
            commands::get_all_tags,
            commands::get_all_groups,
            commands::create_group,
            commands::update_group,
            commands::reorder_groups,
            commands::delete_group,
            sync::get_webdav_config,
            sync::save_webdav_config,
            sync::test_webdav_connection,
            sync::sync_notes,
            sync::push_notes,
            sync::pull_notes,
            sync::reset_sync_state,
            sync::cancel_sync,
        ])
        .setup(|app| {
            // 创建托盘菜单
            let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &settings_i, &quit_i])?;

            // 创建系统托盘图标
            let mut tray_builder = TrayIconBuilder::new().tooltip("LightTodo").menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _tray = tray_builder
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "settings" => {
                        use tauri::Manager;
                        use tauri::WebviewWindowBuilder;

                        if let Some(window) = app.get_webview_window("settings") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        } else {
                            let _ = WebviewWindowBuilder::new(
                                app,
                                "settings",
                                tauri::WebviewUrl::App("/#settings".into()),
                            )
                            .title("LightTodo 设置")
                            .inner_size(760.0, 640.0)
                            .min_inner_size(640.0, 520.0)
                            .resizable(true)
                            .center()
                            .build();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } = event
                    {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            // 左键点击：显示/隐藏窗口
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // 阻止窗口关闭
                    api.prevent_close();
                    // 隐藏窗口到任务栏
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
