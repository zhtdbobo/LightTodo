// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod database;
mod models;

use commands::AppState;
use database::Database;
use std::sync::Arc;

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
        .manage(AppState { db: Arc::new(db) })
        .invoke_handler(tauri::generate_handler![
            commands::get_all_notes,
            commands::get_note_by_id,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
            commands::search_notes,
            commands::get_all_tags,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
