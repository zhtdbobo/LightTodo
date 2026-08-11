use crate::commands::AppState;
use crate::credential_store;
use crate::sync_manifest::{self, SyncMode};
use crate::webdav::{WebDAVClient, WebDAVConfig};
use parking_lot::Mutex;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::{atomic::Ordering, OnceLock};
use tauri::{AppHandle, State};

const WEBDAV_CREDENTIAL_TARGET: &str = "LightTodo/WebDAV";
static CREDENTIAL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn credential_lock() -> &'static Mutex<()> {
    CREDENTIAL_LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDAVSettings {
    pub url: String,
    pub username: String,
    /// Accepted only when saving/testing. Public reads always return an empty
    /// string so a webview compromise cannot extract the stored credential.
    pub password: String,
    #[serde(default)]
    pub has_password: bool,
    #[serde(default)]
    pub clear_password: bool,
    pub enabled: bool,
    pub auto_sync: bool,
    pub last_sync: Option<i64>,
    pub directory: String,
}

pub fn migrate_webdav_credential(db: &crate::database::Database) -> Result<(), String> {
    let _credential_guard = credential_lock().lock();
    let row = {
        let conn = db.get_connection();
        let conn = conn.lock();
        conn.query_row(
            "SELECT username, password FROM webdav_config WHERE id = 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
    };
    let Some((username, password)) = row else {
        return Ok(());
    };
    if password.is_empty() {
        return Ok(());
    }

    credential_store::write(WEBDAV_CREDENTIAL_TARGET, &username, password.as_bytes())?;
    let conn = db.get_connection();
    let conn = conn.lock();
    conn.execute("UPDATE webdav_config SET password = '' WHERE id = 1", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn validate_directory(directory: &str) -> Result<String, String> {
    let directory = directory.trim().trim_matches('/');
    if directory.is_empty() || directory.len() > 512 {
        return Err("同步目录不能为空且不能超过 512 字节".to_string());
    }
    if directory.split('/').any(|segment| {
        segment.is_empty() || segment == "." || segment == ".." || segment.contains('\\')
    }) {
        return Err("同步目录包含非法路径段".to_string());
    }
    Ok(directory.to_string())
}

fn load_webdav_config(
    state: &State<'_, AppState>,
    include_secret: bool,
) -> Result<Option<WebDAVSettings>, String> {
    migrate_webdav_credential(state.db.as_ref())?;
    let _credential_guard = credential_lock().lock();
    let row = {
        let conn = state.db.get_connection();
        let conn = conn.lock();
        conn.query_row(
            "SELECT url, username, enabled, auto_sync, directory, last_sync
             FROM webdav_config WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)? != 0,
                    row.get::<_, i32>(3)? != 0,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
    };
    let Some((url, username, enabled, auto_sync, directory, last_sync)) = row else {
        return Ok(None);
    };

    let secret = credential_store::read(WEBDAV_CREDENTIAL_TARGET)?;
    let password = secret
        .as_deref()
        .map(std::str::from_utf8)
        .transpose()
        .map_err(|_| "Stored WebDAV credential is not valid UTF-8".to_string())?
        .unwrap_or("")
        .to_string();
    let has_password = !password.is_empty();

    Ok(Some(WebDAVSettings {
        url,
        username,
        password: if include_secret {
            password
        } else {
            String::new()
        },
        has_password,
        clear_password: false,
        enabled,
        auto_sync,
        last_sync,
        directory,
    }))
}

pub(crate) fn load_webdav_config_for_sync(
    state: &State<'_, AppState>,
) -> Result<Option<WebDAVSettings>, String> {
    load_webdav_config(state, true)
}

#[tauri::command]
pub async fn get_webdav_config(
    state: State<'_, AppState>,
) -> Result<Option<WebDAVSettings>, String> {
    load_webdav_config(&state, false)
}

#[tauri::command]
pub async fn save_webdav_config(
    state: State<'_, AppState>,
    mut config: WebDAVSettings,
) -> Result<(), String> {
    // Do not rotate credentials or toggle automatic sync while a manifest
    // transaction is in flight.  The guard is held only for local validation
    // and persistence; network requests are never made by this command.
    let _sync_guard = state.sync_lock.lock().await;
    let _credential_guard = credential_lock().lock();
    config.url = config.url.trim().to_string();
    config.username = config.username.trim().to_string();
    config.directory = validate_directory(&config.directory)?;
    if !config.enabled {
        config.auto_sync = false;
    }
    if config.url.contains('\0') || config.username.contains('\0') || config.password.contains('\0')
    {
        return Err("WebDAV 配置不能包含 NUL 字符".to_string());
    }
    if config.url.len() > 2048 || config.username.len() > 512 || config.password.len() > 4096 {
        return Err("WebDAV 配置字段过长".to_string());
    }

    let existing_secret = credential_store::read(WEBDAV_CREDENTIAL_TARGET)?;
    let candidate_secret = if config.clear_password {
        None
    } else if !config.password.is_empty() {
        Some(config.password.as_bytes().to_vec())
    } else {
        existing_secret.clone()
    };
    let has_password = candidate_secret
        .as_ref()
        .is_some_and(|value| !value.is_empty());
    if config.enabled && (config.url.is_empty() || config.username.is_empty() || !has_password) {
        return Err("启用同步前必须填写 WebDAV 地址、用户名和密码".to_string());
    }
    if has_password {
        let password = String::from_utf8(candidate_secret.clone().unwrap_or_default())
            .map_err(|_| "Stored WebDAV credential is not valid UTF-8".to_string())?;
        WebDAVClient::new(WebDAVConfig {
            url: config.url.clone(),
            username: config.username.clone(),
            password,
        })
        .map_err(|error| error.to_string())?;
    }

    // Validate the database write before changing Credential Manager. The
    // transaction is committed only after every value is accepted by SQLite.
    {
        let conn = state.db.get_connection();
        let mut conn = conn.lock();
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO webdav_config
             (id, url, username, password, enabled, auto_sync, directory, last_sync)
             VALUES (1, ?1, ?2, '', ?3, ?4, ?5, NULL)
             ON CONFLICT(id) DO UPDATE SET
               url = excluded.url,
               username = excluded.username,
               password = '',
               enabled = excluded.enabled,
               auto_sync = excluded.auto_sync,
               directory = excluded.directory,
               last_sync = webdav_config.last_sync",
            params![
                config.url,
                config.username,
                if config.enabled { 1 } else { 0 },
                if config.auto_sync { 1 } else { 0 },
                config.directory,
            ],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|error| error.to_string())?;
    }

    let credential_result = if config.clear_password {
        credential_store::delete(WEBDAV_CREDENTIAL_TARGET)
    } else if !config.password.is_empty() {
        credential_store::write(
            WEBDAV_CREDENTIAL_TARGET,
            &config.username,
            config.password.as_bytes(),
        )
    } else {
        Ok(())
    };
    if let Err(error) = credential_result {
        // Never leave automatic sync enabled when its credential could not be
        // persisted. The non-secret fields remain available for correction.
        let conn = state.db.get_connection();
        let conn = conn.lock();
        let _ = conn.execute(
            "UPDATE webdav_config SET enabled = 0, auto_sync = 0 WHERE id = 1",
            [],
        );
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn test_webdav_connection(
    url: String,
    username: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    if url.len() > 2048 || username.len() > 512 || password.len() > 4096 {
        return Err("WebDAV 配置字段过长".to_string());
    }
    if url.contains('\0') || username.contains('\0') || password.contains('\0') {
        return Err("WebDAV 配置不能包含 NUL 字符".to_string());
    }
    let password = if password.is_empty() {
        load_webdav_config(&state, true)?
            .map(|config| config.password)
            .unwrap_or_default()
    } else {
        password
    };
    if password.is_empty() {
        return Err("请先输入或保存 WebDAV 密码".to_string());
    }
    let client = WebDAVClient::new(WebDAVConfig {
        url: url.trim().to_string(),
        username: username.trim().to_string(),
        password,
    })
    .map_err(|error| error.to_string())?;
    client
        .test_connection()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sync_notes(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    sync_manifest::run_configured(&app, &state, SyncMode::Bidirectional).await
}

#[tauri::command]
pub async fn push_notes(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    sync_manifest::run_configured(&app, &state, SyncMode::Push).await
}

#[tauri::command]
pub async fn pull_notes(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    sync_manifest::run_configured(&app, &state, SyncMode::Pull).await
}

#[tauri::command]
pub async fn reset_sync_state(state: State<'_, AppState>) -> Result<(), String> {
    let _sync_guard = state.sync_lock.lock().await;
    let conn = state.db.get_connection();
    let conn = conn.lock();
    conn.execute("UPDATE webdav_config SET last_sync = 0 WHERE id = 1", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn cancel_sync(state: State<'_, AppState>) -> Result<(), String> {
    state.sync_cancelled.store(true, Ordering::SeqCst);
    Ok(())
}
