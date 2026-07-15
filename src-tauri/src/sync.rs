use crate::commands::AppState;
use crate::webdav::{WebDAVClient, WebDAVConfig};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDAVSettings {
    pub url: String,
    pub username: String,
    pub password: String,
    pub enabled: bool,
    pub auto_sync: bool,
    pub last_sync: Option<i64>,
    pub directory: String,  // 新增：子目录
}

/// 获取 WebDAV 配置
#[tauri::command]
pub async fn get_webdav_config(state: State<'_, AppState>) -> Result<Option<WebDAVSettings>, String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();

    let mut stmt = conn
        .prepare("SELECT url, username, password, enabled, auto_sync, directory, last_sync FROM webdav_config WHERE id = 1")
        .map_err(|e| e.to_string())?;

    let result = stmt
        .query_row([], |row| {
            Ok(WebDAVSettings {
                url: row.get(0)?,
                username: row.get(1)?,
                password: row.get(2)?,
                enabled: row.get::<_, i32>(3)? != 0,
                auto_sync: row.get::<_, i32>(4)? != 0,
                directory: row.get(5)?,
                last_sync: row.get(6)?,
            })
        })
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(result)
}

/// 保存 WebDAV 配置
#[tauri::command]
pub async fn save_webdav_config(
    state: State<'_, AppState>,
    config: WebDAVSettings,
) -> Result<(), String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();

    conn.execute(
        "INSERT OR REPLACE INTO webdav_config (id, url, username, password, enabled, auto_sync, directory, last_sync)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            config.url,
            config.username,
            config.password,
            if config.enabled { 1 } else { 0 },
            if config.auto_sync { 1 } else { 0 },
            config.directory,
            config.last_sync,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 测试 WebDAV 连接
#[tauri::command]
pub async fn test_webdav_connection(
    url: String,
    username: String,
    password: String,
) -> Result<bool, String> {
    let config = WebDAVConfig {
        url,
        username,
        password,
    };

    let client = WebDAVClient::new(config);

    match client.test_connection().await {
        Ok(success) => Ok(success),
        Err(e) => Err(e.to_string()),
    }
}

fn get_local_groups(state: &State<'_, AppState>, include_deleted: bool) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();

    let sql = if include_deleted {
        "SELECT id, name, created_at, updated_at, deleted_at
         FROM groups"
    } else {
        "SELECT id, name, created_at, updated_at, deleted_at
         FROM groups
         WHERE deleted_at IS NULL"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let groups = stmt.query_map([], |row| {
        let deleted_at: Option<i64> = row.get(4)?;
        let mut group = serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "name": row.get::<_, String>(1)?,
            "createdAt": row.get::<_, i64>(2)?,
            "updatedAt": row.get::<_, i64>(3)?,
        });

        if let Some(value) = deleted_at {
            group["deletedAt"] = serde_json::Value::Number(value.into());
        }

        Ok(group)
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(groups)
}

async fn upload_local_groups(
    state: &State<'_, AppState>,
    client: &WebDAVClient,
    groups_directory: &str,
    last_sync: i64,
) -> Result<usize, String> {
    let local_groups = get_local_groups(state, true)?;
    let mut uploaded = 0;
    let is_first_sync = last_sync == 0;

    for group in &local_groups {
        let updated_at = group.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);
        let deleted_at = group.get("deletedAt").and_then(|v| v.as_i64()).unwrap_or(0);

        if !is_first_sync && updated_at <= last_sync && deleted_at <= last_sync {
            continue;
        }

        let id = group.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let json_data = serde_json::to_string_pretty(&group).map_err(|e| e.to_string())?;
        let file_path = format!("{}/{}.json", groups_directory, id);

        client
            .upload_file(&file_path, json_data.as_bytes())
            .await
            .map_err(|e| format!("上传分组失败: {}", e))?;

        uploaded += 1;
    }

    Ok(uploaded)
}

async fn download_remote_groups(
    state: &State<'_, AppState>,
    client: &WebDAVClient,
    groups_directory: &str,
) -> Result<(usize, usize), String> {
    let remote_group_files = client
        .list_directory(groups_directory)
        .await
        .unwrap_or_else(|_| Vec::new());

    let mut downloaded = 0;
    let mut updated = 0;
    for filename in remote_group_files {
        if !filename.ends_with(".json") {
            continue;
        }

        let file_path = format!("{}/{}", groups_directory, filename);

        if let Ok(data) = client.download_file(&file_path).await {
            if let Ok(remote_group) = serde_json::from_slice::<serde_json::Value>(&data) {
                let remote_id = remote_group.get("id").and_then(|v| v.as_str()).unwrap_or("");
                if remote_id.is_empty() {
                    continue;
                }

                let remote_created = remote_group.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(0);
                let remote_updated = remote_group
                    .get("updatedAt")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(remote_created);
                let remote_deleted = remote_group.get("deletedAt").and_then(|v| v.as_i64());

                let conn = state.db.get_connection();
                let mut conn = conn.lock();

                let local_updated: Option<i64> = conn
                    .query_row(
                        "SELECT updated_at FROM groups WHERE id = ?1",
                        params![remote_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;

                let should_apply = match local_updated {
                    Some(local) => remote_updated > local,
                    None => true,
                };

                if !should_apply {
                    continue;
                }

                let tx = conn.transaction().map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT OR REPLACE INTO groups
                     (id, name, created_at, updated_at, deleted_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        remote_id,
                        remote_group.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                        remote_created,
                        remote_updated,
                        remote_deleted,
                    ],
                )
                .map_err(|e| e.to_string())?;

                if remote_deleted.is_some() {
                    tx.execute(
                        "UPDATE notes SET group_id = NULL, updated_at = ?1 WHERE group_id = ?2",
                        params![remote_updated, remote_id],
                    )
                    .map_err(|e| e.to_string())?;
                }

                tx.commit().map_err(|e| e.to_string())?;

                if local_updated.is_some() {
                    updated += 1;
                } else {
                    downloaded += 1;
                }
            }
        }
    }

    Ok((downloaded, updated))
}

fn append_count(parts: &mut Vec<String>, action: &str, count: usize, object: &str) {
    if count > 0 {
        parts.push(format!("{} {} 个{}", action, count, object));
    }
}

fn format_sync_result(
    prefix: &str,
    empty_message: &str,
    counts: &[(&str, usize, &str)],
) -> String {
    let mut parts = Vec::new();
    for (action, count, object) in counts {
        append_count(&mut parts, action, *count, object);
    }

    if parts.is_empty() {
        empty_message.to_string()
    } else {
        format!("{} - {}", prefix, parts.join("，"))
    }
}

/// 增量双向同步（按待办单独存储）
#[tauri::command]
pub async fn sync_notes(state: State<'_, AppState>) -> Result<String, String> {
    // 获取配置
    let config = get_webdav_config(state.clone())
        .await?
        .ok_or("WebDAV 未配置")?;

    if !config.enabled {
        return Err("WebDAV 同步已禁用".to_string());
    }

    let webdav_config = WebDAVConfig {
        url: config.url,
        username: config.username,
        password: config.password,
    };

    let client = WebDAVClient::new(webdav_config);
    let directory = format!("{}/notes", config.directory);
    let sync_start_time = chrono::Utc::now().timestamp();

    // 确保目录存在
    let _ = client.create_directory(&config.directory).await;
    let _ = client.create_directory(&directory).await;

    let last_sync = config.last_sync.unwrap_or(0);

    // 1. 同步分组
    let groups_directory = format!("{}/groups", config.directory);
    let _ = client.create_directory(&groups_directory).await;

    let groups_uploaded = upload_local_groups(&state, &client, &groups_directory, last_sync).await?;
    let (groups_downloaded, groups_updated) =
        download_remote_groups(&state, &client, &groups_directory).await?;

    // 2. 获取本地所有待办（包含删除标记的）
    let local_notes: Vec<serde_json::Value> = {
        let conn = state.db.get_connection();
        let conn = conn.lock();

        let mut stmt = conn
            .prepare("SELECT id, title, content, is_todo, is_completed, priority, pinned, group_id, created_at, updated_at, completed_at, deadline FROM notes")
            .map_err(|e| e.to_string())?;

        let notes_result = stmt.query_map([], |row| {
            let group_id: Option<String> = row.get(7)?;
            let completed_at: Option<i64> = row.get(10)?;
            let deadline: Option<i64> = row.get(11)?;
            let mut note = serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "content": row.get::<_, String>(2)?,
                "isTodo": row.get::<_, i32>(3)? != 0,
                "isCompleted": row.get::<_, i32>(4)? != 0,
                "priority": row.get::<_, i32>(5)?,
                "pinned": row.get::<_, i32>(6)? != 0,
                "createdAt": row.get::<_, i64>(8)?,
                "updatedAt": row.get::<_, i64>(9)?,
            });

            if let Some(gid) = group_id {
                note["groupId"] = serde_json::Value::String(gid);
            }

            if let Some(cat) = completed_at {
                note["completedAt"] = serde_json::Value::Number(cat.into());
            }
            if let Some(value) = deadline {
                note["deadline"] = serde_json::Value::Number(value.into());
            }

            Ok(note)
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

        notes_result
    };

    // 3. 上传本地修改过的待办（updated_at > last_sync，或首次同步时上传所有）
    let mut uploaded = 0;
    let is_first_sync = last_sync == 0;

    for note in &local_notes {
        let updated_at = note.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);

        // 首次同步上传所有，之后只上传修改过的
        if is_first_sync || updated_at > last_sync {
            let id = note.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let json_data = serde_json::to_string_pretty(&note).map_err(|e| e.to_string())?;
            let file_path = format!("{}/{}.json", directory, id);

            client
                .upload_file(&file_path, json_data.as_bytes())
                .await
                .map_err(|e| format!("上传失败: {}", e))?;

            uploaded += 1;
        }
    }

    // 3.5. 删除云端多余的文件（本地已删除的）
    let remote_files = client
        .list_directory(&directory)
        .await
        .unwrap_or_else(|_| Vec::new());

    let local_ids: std::collections::HashSet<String> = local_notes
        .iter()
        .filter_map(|n| n.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();

    let mut deleted = 0;
    for filename in remote_files {
        if !filename.ends_with(".json") {
            continue;
        }

        // 提取文件名中的 ID（去掉 .json 后缀）
        let remote_id = filename.trim_end_matches(".json");

        // 如果本地不存在这个 ID，删除云端文件
        if !local_ids.contains(remote_id) {
            let file_path = format!("{}/{}", directory, filename);
            match client.delete_file(&file_path).await {
                Ok(_) => deleted += 1,
                Err(e) => eprintln!("删除云端文件失败 {}: {}", filename, e),
            }
        }
    }

    // 4. 下载远程文件列表
    let remote_files = client
        .list_directory(&directory)
        .await
        .unwrap_or_else(|_| Vec::new());

    // 5. 下载并合并远程待办
    let mut downloaded = 0;
    let mut updated = 0;

    for filename in remote_files {
        if !filename.ends_with(".json") {
            continue;
        }

        let file_path = format!("{}/{}", directory, filename);

        match client.download_file(&file_path).await {
            Ok(data) => {
                if let Ok(remote_note) = serde_json::from_slice::<serde_json::Value>(&data) {
                    let remote_id = remote_note.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let remote_updated = remote_note.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);

                    // 检查本地是否存在
                    let local_note = local_notes.iter().find(|n| {
                        n.get("id").and_then(|v| v.as_str()).unwrap_or("") == remote_id
                    });

                    let should_update = if let Some(local) = local_note {
                        let local_updated = local.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);
                        remote_updated > local_updated
                    } else {
                        true // 本地不存在，直接下载
                    };

                    if should_update {
                        // 写入本地数据库
                        let conn = state.db.get_connection();
                        let conn = conn.lock();

                        conn.execute(
                            "INSERT OR REPLACE INTO notes (id, title, content, is_todo, is_completed, priority, pinned, group_id, created_at, updated_at, completed_at, deadline)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                            params![
                                remote_id,
                                remote_note.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                                remote_note.get("content").and_then(|v| v.as_str()).unwrap_or(""),
                                if remote_note.get("isTodo").and_then(|v| v.as_bool()).unwrap_or(false) { 1 } else { 0 },
                                if remote_note.get("isCompleted").and_then(|v| v.as_bool()).unwrap_or(false) { 1 } else { 0 },
                                remote_note.get("priority").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                                if remote_note.get("pinned").and_then(|v| v.as_bool()).unwrap_or(false) { 1 } else { 0 },
                                remote_note.get("groupId").and_then(|v| v.as_str()),
                                remote_note.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(0),
                                remote_updated,
                                remote_note.get("completedAt").and_then(|v| v.as_i64()),
                                remote_note.get("deadline").and_then(|v| v.as_i64()),
                            ],
                        )
                        .map_err(|e| e.to_string())?;

                        if local_note.is_some() {
                            updated += 1;
                        } else {
                            downloaded += 1;
                        }
                    }
                }
            }
            Err(_) => continue,
        }
    }

    // 6. 仅在有实际操作时更新同步时间
    if uploaded > 0 || downloaded > 0 || updated > 0 || deleted > 0 || groups_uploaded > 0 || groups_downloaded > 0 || groups_updated > 0 {
        let conn = state.db.get_connection();
        let conn = conn.lock();
        conn.execute(
            "UPDATE webdav_config SET last_sync = ?1 WHERE id = 1",
            params![sync_start_time],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(format_sync_result(
        "同步完成",
        "无需同步，本地和云端已是最新",
        &[
            ("上传", groups_uploaded, "分组"),
            ("下载", groups_downloaded, "分组"),
            ("更新", groups_updated, "分组"),
            ("上传", uploaded, "待办"),
            ("下载", downloaded, "待办"),
            ("更新", updated, "待办"),
            ("清理云端已删除", deleted, "待办"),
        ],
    ))
}

/// 仅上传到 WebDAV（单向，增量）
#[tauri::command]
pub async fn push_notes(state: State<'_, AppState>) -> Result<String, String> {
    let config = get_webdav_config(state.clone())
        .await?
        .ok_or("WebDAV 未配置")?;

    if !config.enabled {
        return Err("WebDAV 同步已禁用".to_string());
    }

    let webdav_config = WebDAVConfig {
        url: config.url,
        username: config.username,
        password: config.password,
    };

    let client = WebDAVClient::new(webdav_config);
    let directory = format!("{}/notes", config.directory);
    let groups_directory = format!("{}/groups", config.directory);

    // 确保目录存在
    let _ = client.create_directory(&config.directory).await;
    let _ = client.create_directory(&directory).await;
    let _ = client.create_directory(&groups_directory).await;

    let last_sync = config.last_sync.unwrap_or(0);
    // 记录本次同步开始的时间（用于下次同步的基准）
    let sync_start_time = chrono::Utc::now().timestamp();

    let groups_uploaded =
        upload_local_groups(&state, &client, &groups_directory, last_sync).await?;

    let notes = {
        let conn = state.db.get_connection();
        let conn = conn.lock();

        let mut stmt = conn
            .prepare("SELECT id, title, content, is_todo, is_completed, priority, pinned, group_id, created_at, updated_at, completed_at, deadline FROM notes")
            .map_err(|e| e.to_string())?;

        let notes_result: Vec<serde_json::Value> = stmt
            .query_map([], |row| {
                let group_id: Option<String> = row.get(7)?;
                let completed_at: Option<i64> = row.get(10)?;
                let deadline: Option<i64> = row.get(11)?;
                let mut note = serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "content": row.get::<_, String>(2)?,
                    "isTodo": row.get::<_, i32>(3)? != 0,
                    "isCompleted": row.get::<_, i32>(4)? != 0,
                    "priority": row.get::<_, i32>(5)?,
                    "pinned": row.get::<_, i32>(6)? != 0,
                    "createdAt": row.get::<_, i64>(8)?,
                    "updatedAt": row.get::<_, i64>(9)?,
                });

                if let Some(gid) = group_id {
                    note["groupId"] = serde_json::Value::String(gid);
                }

                if let Some(cat) = completed_at {
                    note["completedAt"] = serde_json::Value::Number(cat.into());
                }
                if let Some(value) = deadline {
                    note["deadline"] = serde_json::Value::Number(value.into());
                }

                Ok(note)
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        notes_result
    };

    // 只上传修改过的待办（首次同步上传所有）
    let mut uploaded = 0;
    let is_first_sync = last_sync == 0;

    for note in &notes {
        let updated_at = note.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);
        let id = note.get("id").and_then(|v| v.as_str()).unwrap_or("");

        // 修改判断逻辑：只要 updated_at > last_sync 就上传（不用 >=）
        let should_upload = is_first_sync || updated_at > last_sync;

        if should_upload {
            let json_data = serde_json::to_string_pretty(&note).map_err(|e| e.to_string())?;
            let file_path = format!("{}/{}.json", directory, id);

            client
                .upload_file(&file_path, json_data.as_bytes())
                .await
                .map_err(|e| format!("上传 {} 失败: {}", id, e))?;

            uploaded += 1;
        }
    }

    // 删除云端多余的文件（本地已删除的）
    let remote_files = client
        .list_directory(&directory)
        .await
        .unwrap_or_else(|_| Vec::new());

    let local_ids: std::collections::HashSet<String> = notes
        .iter()
        .filter_map(|n| n.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();

    let mut deleted = 0;
    for filename in remote_files {
        if !filename.ends_with(".json") {
            continue;
        }

        let remote_id = filename.trim_end_matches(".json");

        if !local_ids.contains(remote_id) {
            let file_path = format!("{}/{}", directory, filename);
            match client.delete_file(&file_path).await {
                Ok(_) => deleted += 1,
                Err(e) => eprintln!("删除云端文件失败 {}: {}", filename, e),
            }
        }
    }

    // 仅在有实际操作时更新同步时间（避免空同步推进时间戳）
    if uploaded > 0 || deleted > 0 || groups_uploaded > 0 {
        let conn = state.db.get_connection();
        let conn = conn.lock();
        conn.execute(
            "UPDATE webdav_config SET last_sync = ?1 WHERE id = 1",
            params![sync_start_time],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(format_sync_result(
        "上传完成",
        "无需上传，云端已是最新",
        &[
            ("上传", groups_uploaded, "分组"),
            ("上传", uploaded, "待办"),
            ("清理云端已删除", deleted, "待办"),
        ],
    ))
}

/// 重置同步状态
#[tauri::command]
pub async fn reset_sync_state(state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();

    conn.execute(
        "UPDATE webdav_config SET last_sync = 0 WHERE id = 1",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 仅从 WebDAV 下载（单向，增量）
#[tauri::command]
pub async fn pull_notes(state: State<'_, AppState>) -> Result<String, String> {
    let config = get_webdav_config(state.clone())
        .await?
        .ok_or("WebDAV 未配置")?;

    if !config.enabled {
        return Err("WebDAV 同步已禁用".to_string());
    }

    let webdav_config = WebDAVConfig {
        url: config.url,
        username: config.username,
        password: config.password,
    };

    let client = WebDAVClient::new(webdav_config);
    let directory = format!("{}/notes", config.directory);
    let groups_directory = format!("{}/groups", config.directory);

    let (groups_downloaded, groups_updated) =
        download_remote_groups(&state, &client, &groups_directory).await?;

    // 获取远程文件列表
    let remote_files = client
        .list_directory(&directory)
        .await
        .map_err(|e| format!("获取远程文件列表失败: {}", e))?;

    let mut downloaded = 0;
    let mut updated = 0;
    let mut errors = Vec::new();

    for filename in remote_files {
        if !filename.ends_with(".json") {
            continue;
        }

        let file_path = format!("{}/{}", directory, filename);

        match client.download_file(&file_path).await {
            Ok(data) => {
                match serde_json::from_slice::<serde_json::Value>(&data) {
                    Ok(remote_note) => {
                        let remote_id = remote_note.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let remote_updated = remote_note.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);

                        let conn = state.db.get_connection();
                        let conn = conn.lock();

                        // 检查本地是否存在且是否需要更新
                        let local_updated: Option<i64> = conn
                            .query_row(
                                "SELECT updated_at FROM notes WHERE id = ?1",
                                params![remote_id],
                                |row| row.get(0),
                            )
                            .optional()
                            .map_err(|e| e.to_string())?;

                        let should_update = match local_updated {
                            Some(local) => remote_updated > local,
                            None => true, // 本地不存在，需要下载
                        };

                        if should_update {
                            match conn.execute(
                                "INSERT OR REPLACE INTO notes (id, title, content, is_todo, is_completed, priority, pinned, group_id, created_at, updated_at, completed_at, deadline)
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                                params![
                                    remote_id,
                                    remote_note.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                                    remote_note.get("content").and_then(|v| v.as_str()).unwrap_or(""),
                                    if remote_note.get("isTodo").and_then(|v| v.as_bool()).unwrap_or(false) { 1 } else { 0 },
                                    if remote_note.get("isCompleted").and_then(|v| v.as_bool()).unwrap_or(false) { 1 } else { 0 },
                                    remote_note.get("priority").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                                    if remote_note.get("pinned").and_then(|v| v.as_bool()).unwrap_or(false) { 1 } else { 0 },
                                    remote_note.get("groupId").and_then(|v| v.as_str()),
                                    remote_note.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(0),
                                    remote_updated,
                                    remote_note.get("completedAt").and_then(|v| v.as_i64()),
                                    remote_note.get("deadline").and_then(|v| v.as_i64()),
                                ],
                            ) {
                                Ok(_) => {
                                    if local_updated.is_some() {
                                        updated += 1;
                                    } else {
                                        downloaded += 1;
                                    }
                                }
                                Err(e) => {
                                    let err_msg = format!("插入数据库失败 {}: {}", filename, e);
                                    errors.push(err_msg);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let err_msg = format!("JSON 解析失败 {}: {}", filename, e);
                        errors.push(err_msg);
                    }
                }
            }
            Err(e) => {
                let err_msg = format!("下载失败 {}: {}", filename, e);
                errors.push(err_msg);
            }
        }
    }

    if !errors.is_empty() {
        let summary = format_sync_result(
            "下载完成",
            "下载完成",
            &[
                ("下载", groups_downloaded, "分组"),
                ("更新", groups_updated, "分组"),
                ("下载", downloaded, "待办"),
                ("更新", updated, "待办"),
            ],
        );
        Ok(format!("{}，{} 个失败: {}", summary, errors.len(), errors.join("; ")))
    } else if groups_downloaded > 0 || groups_updated > 0 || downloaded > 0 || updated > 0 {
        Ok(format_sync_result(
            "下载完成",
            "无需下载，本地已是最新",
            &[
                ("下载", groups_downloaded, "分组"),
                ("更新", groups_updated, "分组"),
                ("下载", downloaded, "待办"),
                ("更新", updated, "待办"),
            ],
        ))
    } else {
        Ok("无需下载，本地已是最新".to_string())
    }
}
