mod backup;
mod commands;
mod credential_store;
mod crypto;
mod database;
#[cfg(target_os = "android")]
mod mobile_secure_storage;
mod models;
mod sync;
mod sync_manifest;
mod webdav;

use commands::AppState;
use database::Database;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Manager, State};

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, WindowEvent,
};

struct UiPreferences {
    expand_today_on_open: AtomicBool,
}

#[tauri::command]
fn get_expand_today_on_open(preferences: State<'_, UiPreferences>) -> bool {
    preferences.expand_today_on_open.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_expand_today_on_open(enabled: bool, preferences: State<'_, UiPreferences>) {
    preferences
        .expand_today_on_open
        .store(enabled, Ordering::Relaxed);
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("main-window-opened", ());
    }
}

fn app_data_directory(app: &tauri::App) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    #[cfg(desktop)]
    {
        let _ = app;
        return dirs::data_dir()
            .map(|path| path.join("lighttodo"))
            .ok_or_else(|| "Failed to get data directory".into());
    }

    #[cfg(mobile)]
    {
        Ok(app.path().app_data_dir()?)
    }
}

fn initialize_state(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_dir = app_data_directory(app)?;
    std::fs::create_dir_all(&app_dir)?;

    let db = Database::new(app_dir.join("notes.db"))?;
    if let Err(error) = sync::migrate_webdav_credential(&db) {
        eprintln!("Failed to migrate WebDAV credential: {error}");
    }
    if let Err(error) = crypto::migrate_legacy_password_notes(&db) {
        eprintln!("Failed to encrypt legacy password notes: {error}");
    }

    app.manage(AppState {
        db: Arc::new(db),
        sync_lock: Arc::new(tokio::sync::Mutex::new(())),
        vault_lock: Arc::new(tokio::sync::Mutex::new(())),
        sync_cancelled: Arc::new(AtomicBool::new(false)),
    });
    app.manage(UiPreferences {
        expand_today_on_open: AtomicBool::new(true),
    });

    Ok(())
}

#[cfg(desktop)]
fn initialize_desktop(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &settings_item, &quit_item])?;

    let mut tray_builder = TrayIconBuilder::new().tooltip("LightTodo").menu(&menu);
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "settings" => {
                if let Some(window) = app.get_webview_window("settings") {
                    let _ = window.show();
                    let _ = window.set_focus();
                } else {
                    let _ = tauri::WebviewWindowBuilder::new(
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
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        show_main_window(app);
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(mobile_secure_storage::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build());

    let app = builder
        .invoke_handler(tauri::generate_handler![
            get_expand_today_on_open,
            set_expand_today_on_open,
            backup::export_backup,
            backup::import_backup,
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
            initialize_state(app)?;
            #[cfg(desktop)]
            initialize_desktop(app)?;
            Ok(())
        });

    #[cfg(desktop)]
    let app = app.on_window_event(|window, event| {
        if window.label() == "main" {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        }
    });

    app.run(tauri::generate_context!())
        .expect("error while running tauri application");
}
