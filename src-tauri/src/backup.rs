use crate::commands::AppState;
use crate::crypto;
use crate::models::{Group, Note};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::State;

const BACKUP_FORMAT: &str = "lighttodo-backup";
const BACKUP_VERSION: u32 = 1;
const MAX_BACKUP_BYTES: u64 = 512 * 1024 * 1024;
const MAX_OBJECTS: usize = 50_000;
const MAX_TITLE_BYTES: usize = 1024 * 1024;
const MAX_CONTENT_BYTES: usize = 1024 * 1024;
const MAX_GROUP_NAME_BYTES: usize = 256;
const MAX_COLOR_BYTES: usize = 256;
const MAX_TAGS: usize = 100;
const MAX_TAG_BYTES: usize = 128;
const MAX_TIMESTAMP_MS: i64 = 8_640_000_000_000_000;

#[derive(Debug, Serialize, Deserialize)]
struct BackupDocument {
    format: String,
    version: u32,
    exported_at: i64,
    notes: Vec<Note>,
    groups: Vec<Group>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    note_count: usize,
    group_count: usize,
}

fn validate_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() || path.contains('\0') {
        return Err("备份文件路径无效".to_string());
    }
    let path = PathBuf::from(path);
    if path.file_name().is_none() {
        return Err("请选择一个备份文件".to_string());
    }
    Ok(path)
}

fn validate_text(label: &str, value: &str, max_bytes: usize) -> Result<(), String> {
    if value.contains('\0') {
        return Err(format!("{label}不能包含空字符"));
    }
    if value.len() > max_bytes {
        return Err(format!("{label}超过允许的长度"));
    }
    Ok(())
}

fn validate_id(label: &str, id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(format!("{label} ID 无效"));
    }
    Ok(())
}

fn validate_timestamp(label: &str, value: i64) -> Result<(), String> {
    if !(0..=MAX_TIMESTAMP_MS).contains(&value) {
        return Err(format!("{label}时间无效"));
    }
    Ok(())
}

fn load_tags(conn: &Connection) -> Result<HashMap<String, Vec<String>>, String> {
    let mut statement = conn
        .prepare(
            "SELECT nt.note_id, t.name
             FROM note_tags nt
             INNER JOIN tags t ON t.id = nt.tag_id
             ORDER BY nt.note_id, t.name",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut result = HashMap::<String, Vec<String>>::new();
    for row in rows {
        let (note_id, tag) = row.map_err(|error| error.to_string())?;
        result.entry(note_id).or_default().push(tag);
    }
    Ok(result)
}

fn load_notes(conn: &Connection) -> Result<Vec<Note>, String> {
    let mut tags_by_note = load_tags(conn)?;
    let mut statement = conn
        .prepare(
            "SELECT id, title, content, is_todo, is_completed, color, pinned, priority,
                    created_at, updated_at, synced_at, group_id, completed_at, deadline
             FROM notes
             ORDER BY created_at ASC, id ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                is_todo: row.get::<_, i64>(3)? != 0,
                is_completed: row.get::<_, i64>(4)? != 0,
                color: row.get(5)?,
                pinned: row.get::<_, i64>(6)? != 0,
                priority: row.get(7)?,
                tags: Vec::new(),
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                synced_at: row.get(10)?,
                group_id: row.get(11)?,
                completed_at: row.get(12)?,
                deadline: row.get(13)?,
                decryption_error: None,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut notes = Vec::new();
    for row in rows {
        let mut note = row.map_err(|error| error.to_string())?;
        note.tags = tags_by_note.remove(&note.id).unwrap_or_default();
        note.title = crypto::decrypt_note_title(&note.id, &note.content, &note.title)
            .map_err(|error| format!("无法导出密码条目 {}：{error}", note.id))?;
        notes.push(note);
    }
    Ok(notes)
}

fn load_groups(conn: &Connection) -> Result<Vec<Group>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, name, display_order, created_at, updated_at, deleted_at
             FROM groups
             WHERE deleted_at IS NULL
             ORDER BY display_order ASC, created_at ASC, id ASC",
        )
        .map_err(|error| error.to_string())?;
    let groups = statement
        .query_map([], |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                display_order: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                deleted_at: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(groups)
}

fn validate_backup(document: &mut BackupDocument) -> Result<(), String> {
    if document.format != BACKUP_FORMAT || document.version != BACKUP_VERSION {
        return Err("不支持的 LightTodo 备份格式或版本".to_string());
    }
    if document.notes.len() > MAX_OBJECTS || document.groups.len() > MAX_OBJECTS {
        return Err("备份中的数据条目过多".to_string());
    }
    validate_timestamp("导出", document.exported_at)?;

    let mut group_ids = HashSet::new();
    let mut group_names = HashSet::new();
    for group in &document.groups {
        validate_id("分组", &group.id)?;
        let name = group.name.trim();
        if name.is_empty() {
            return Err("分组名称不能为空".to_string());
        }
        validate_text("分组名称", name, MAX_GROUP_NAME_BYTES)?;
        if group.display_order < 0 {
            return Err("分组排序值无效".to_string());
        }
        validate_timestamp("分组创建", group.created_at)?;
        validate_timestamp("分组更新", group.updated_at)?;
        if group.deleted_at.is_some() {
            return Err("备份中包含已删除分组".to_string());
        }
        if !group_ids.insert(group.id.clone()) || !group_names.insert(name.to_string()) {
            return Err("备份中包含重复分组".to_string());
        }
    }

    let mut note_ids = HashSet::new();
    let mut blank_drafts = HashSet::new();
    for note in &mut document.notes {
        validate_id("待办", &note.id)?;
        if !note_ids.insert(note.id.clone()) {
            return Err("备份中包含重复待办".to_string());
        }
        validate_text("待办标题", &note.title, MAX_TITLE_BYTES)?;
        validate_text("待办内容", &note.content, MAX_CONTENT_BYTES)?;
        if let Some(color) = note.color.as_deref() {
            validate_text("颜色", color, MAX_COLOR_BYTES)?;
        }
        if !(0..=2).contains(&note.priority) {
            return Err("待办优先级无效".to_string());
        }
        validate_timestamp("待办创建", note.created_at)?;
        validate_timestamp("待办更新", note.updated_at)?;
        for (label, timestamp) in [
            ("待办同步", note.synced_at),
            ("待办完成", note.completed_at),
            ("待办截止", note.deadline),
        ] {
            if let Some(timestamp) = timestamp {
                validate_timestamp(label, timestamp)?;
            }
        }
        if note.decryption_error.is_some() {
            return Err("备份中包含无法解密的密码条目".to_string());
        }
        if let Some(group_id) = note.group_id.as_deref() {
            if !group_ids.contains(group_id) {
                return Err(format!("待办 {} 引用了不存在的分组", note.id));
            }
        }
        if note.tags.len() > MAX_TAGS {
            return Err("单条待办的标签过多".to_string());
        }
        let mut normalized_tags = Vec::new();
        for tag in &note.tags {
            let tag = tag.trim();
            if tag.is_empty() {
                continue;
            }
            validate_text("标签", tag, MAX_TAG_BYTES)?;
            if !normalized_tags.iter().any(|existing| existing == tag) {
                normalized_tags.push(tag.to_string());
            }
        }
        note.tags = normalized_tags;

        if note.is_todo
            && !note.is_completed
            && note.title.trim().is_empty()
            && note.content.trim().is_empty()
            && !blank_drafts.insert(note.group_id.clone())
        {
            return Err("同一分组中包含多条空白待办".to_string());
        }
    }
    Ok(())
}

fn write_backup(path: &Path, document: &BackupDocument) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(document).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_BACKUP_BYTES {
        return Err("备份文件超过 512 MB 限制".to_string());
    }
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("无法创建备份文件：{error}"))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("无法写入备份文件：{error}"))
}

fn replace_database(
    conn: &mut Connection,
    document: &BackupDocument,
    prepared_titles: &HashMap<String, String>,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM note_tags", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM tags", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM notes", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM note_tombstones", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM sync_queue", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM groups", [])
        .map_err(|error| error.to_string())?;

    for group in &document.groups {
        tx.execute(
            "INSERT INTO groups (id, name, display_order, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            params![
                &group.id,
                group.name.trim(),
                group.display_order,
                group.created_at,
                group.updated_at,
            ],
        )
        .map_err(|error| error.to_string())?;
    }

    let mut tag_ids = HashMap::<String, String>::new();
    for note in &document.notes {
        let stored_title = prepared_titles
            .get(&note.id)
            .ok_or_else(|| format!("待办 {} 缺少已加密标题", note.id))?;
        tx.execute(
            "INSERT INTO notes
             (id, title, content, is_todo, is_completed, color, pinned, priority,
              created_at, updated_at, synced_at, group_id, completed_at, deadline)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                &note.id,
                stored_title,
                &note.content,
                note.is_todo as i64,
                note.is_completed as i64,
                &note.color,
                note.pinned as i64,
                note.priority,
                note.created_at,
                note.updated_at,
                note.synced_at,
                &note.group_id,
                note.completed_at,
                note.deadline,
            ],
        )
        .map_err(|error| error.to_string())?;

        for tag in &note.tags {
            let tag_id = tag_ids
                .entry(tag.clone())
                .or_insert_with(|| uuid::Uuid::new_v4().to_string());
            tx.execute(
                "INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
                params![&*tag_id, tag, note.created_at],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "INSERT INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
                params![&note.id, &*tag_id],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    tx.execute("UPDATE webdav_config SET last_sync = NULL WHERE id = 1", [])
        .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn export_backup(
    path: String,
    state: State<'_, AppState>,
) -> Result<BackupSummary, String> {
    let path = validate_path(&path)?;
    let _sync_guard = state.sync_lock.lock().await;
    let _vault_guard = state.vault_lock.lock().await;
    let conn = state.db.get_connection();
    let conn = conn.lock();
    let notes = load_notes(&conn)?;
    let groups = load_groups(&conn)?;
    let summary = BackupSummary {
        note_count: notes.len(),
        group_count: groups.len(),
    };
    let document = BackupDocument {
        format: BACKUP_FORMAT.to_string(),
        version: BACKUP_VERSION,
        exported_at: chrono::Utc::now().timestamp_millis(),
        notes,
        groups,
    };
    write_backup(&path, &document)?;
    Ok(summary)
}

#[tauri::command]
pub async fn import_backup(
    path: String,
    state: State<'_, AppState>,
) -> Result<BackupSummary, String> {
    let path = validate_path(&path)?;
    let metadata = fs::metadata(&path).map_err(|error| format!("无法读取备份文件：{error}"))?;
    if metadata.len() > MAX_BACKUP_BYTES {
        return Err("备份文件超过 512 MB 限制".to_string());
    }
    let bytes = fs::read(&path).map_err(|error| format!("无法读取备份文件：{error}"))?;
    let mut document: BackupDocument =
        serde_json::from_slice(&bytes).map_err(|error| format!("备份文件解析失败：{error}"))?;
    validate_backup(&mut document)?;

    let _sync_guard = state.sync_lock.lock().await;
    let _vault_guard = state.vault_lock.lock().await;
    let mut prepared_titles = HashMap::new();
    for note in &document.notes {
        let title = crypto::encrypt_note_title(&note.id, &note.content, &note.title)
            .map_err(|error| format!("无法加密密码条目 {}：{error}", note.id))?;
        prepared_titles.insert(note.id.clone(), title);
    }

    let conn = state.db.get_connection();
    let mut conn = conn.lock();
    replace_database(&mut conn, &document, &prepared_titles)?;

    Ok(BackupSummary {
        note_count: document.notes.len(),
        group_count: document.groups.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;

    fn sample_document() -> BackupDocument {
        BackupDocument {
            format: BACKUP_FORMAT.to_string(),
            version: BACKUP_VERSION,
            exported_at: 1_700_000_000_000,
            groups: vec![Group {
                id: "group-1".to_string(),
                name: "工作".to_string(),
                display_order: 0,
                created_at: 1_700_000_000_000,
                updated_at: 1_700_000_000_001,
                deleted_at: None,
            }],
            notes: vec![Note {
                id: "note-1".to_string(),
                title: "备份待办".to_string(),
                content: "内容".to_string(),
                is_todo: true,
                is_completed: false,
                color: None,
                pinned: false,
                deadline: None,
                priority: 1,
                tags: vec!["重要".to_string()],
                group_id: Some("group-1".to_string()),
                created_at: 1_700_000_000_002,
                updated_at: 1_700_000_000_003,
                synced_at: None,
                completed_at: None,
                decryption_error: None,
            }],
        }
    }

    fn test_database() -> (Database, PathBuf) {
        let path =
            std::env::temp_dir().join(format!("lighttodo-backup-test-{}.db", uuid::Uuid::new_v4()));
        (Database::new(path.clone()).unwrap(), path)
    }

    fn remove_database_files(path: &Path) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(path.with_extension("db-wal"));
        let _ = fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn replaces_notes_groups_and_tags_in_one_transaction() {
        let (database, path) = test_database();
        let mut document = sample_document();
        validate_backup(&mut document).unwrap();
        let titles = HashMap::from([("note-1".to_string(), "备份待办".to_string())]);
        {
            let connection = database.get_connection();
            let mut connection = connection.lock();
            replace_database(&mut connection, &document, &titles).unwrap();

            let values: (String, String, String) = connection
                .query_row(
                    "SELECT n.title, g.name, t.name
                     FROM notes n
                     JOIN groups g ON g.id = n.group_id
                     JOIN note_tags nt ON nt.note_id = n.id
                     JOIN tags t ON t.id = nt.tag_id
                     WHERE n.id = 'note-1'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
            assert_eq!(values, ("备份待办".into(), "工作".into(), "重要".into()));
        }
        drop(database);
        remove_database_files(&path);
    }

    #[test]
    fn rolls_back_when_replacement_cannot_be_completed() {
        let (database, path) = test_database();
        {
            let connection = database.get_connection();
            let mut connection = connection.lock();
            connection
                .execute(
                    "INSERT INTO notes
                     (id, title, content, is_todo, is_completed, created_at, updated_at)
                     VALUES ('existing-note', '保留', '', 1, 0, 1, 1)",
                    [],
                )
                .unwrap();

            let error =
                replace_database(&mut connection, &sample_document(), &HashMap::new()).unwrap_err();
            assert!(error.contains("缺少已加密标题"));
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM notes WHERE id = 'existing-note'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1);
        }
        drop(database);
        remove_database_files(&path);
    }

    #[test]
    fn rejects_notes_that_reference_missing_groups() {
        let mut document = sample_document();
        document.groups.clear();
        assert!(validate_backup(&mut document)
            .unwrap_err()
            .contains("不存在的分组"));
    }
}
