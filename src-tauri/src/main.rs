// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod database;
mod models;
mod webdav;
mod sync;

use commands::AppState;
use database::Database;
use std::sync::Arc;
use tauri::{Manager, WindowEvent};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{Menu, MenuItem};

fn main() {
    // 初始化数据库
    let app_dir = dirs::data_dir()
        .expect("Failed to get data directory")
        .join("lighttodo");

    std::fs::create_dir_all(&app_dir).expect("Failed to create app directory");

    let db_path = app_dir.join("notes.db");
    let db = Database::new(db_path).expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState { db: Arc::new(db) })
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
            commands::delete_group,
            sync::get_webdav_config,
            sync::save_webdav_config,
            sync::test_webdav_connection,
            sync::sync_notes,
            sync::push_notes,
            sync::pull_notes,
            sync::reset_sync_state,
        ])
        .setup(|app| {
            // 创建托盘菜单
            let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &settings_i, &quit_i])?;

            // 创建系统托盘图标
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("LightTodo")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
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
                                    tauri::WebviewUrl::App("/#settings".into())
                                )
                                .title("WebDAV 同步设置")
                                .inner_size(700.0, 600.0)
                                .resizable(true)
                                .center()
                                .build();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button, button_state, .. } = event {
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
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 阻止窗口关闭
                api.prevent_close();
                // 隐藏窗口到任务栏
                window.hide().unwrap();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
