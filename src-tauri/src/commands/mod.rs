use crate::crypto;
use crate::database::{deduplicate_blank_drafts, Database};
use crate::models::{
    CreateGroupInput, CreateNoteInput, Group, Note, Tag, UpdateGroupInput, UpdateNoteInput,
};
use chrono::{Datelike, Duration as ChronoDuration, Timelike, Utc};
use rusqlite::{params, OptionalExtension};
use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Arc},
};
use tauri::State;
use tokio::sync::Mutex as AsyncMutex;

const MAX_TITLE_BYTES: usize = 1024 * 1024;
const MAX_CONTENT_BYTES: usize = 1024 * 1024;
const MAX_GROUP_NAME_BYTES: usize = 256;
const MAX_COLOR_BYTES: usize = 256;
const MAX_TAGS: usize = 100;
const MAX_TAG_BYTES: usize = 128;
// Keep IPC timestamps inside JavaScript's Date range.  Without this bound a
// malformed request could persist i64::MAX and later make the date picker
// throw while converting it to an ISO string.
const MAX_TIMESTAMP_MS: i64 = 8_640_000_000_000_000;
const REPEAT_RULES: [&str; 3] = ["daily", "weekly", "monthly"];

fn validate_repeat_rule(rule: Option<&str>) -> Result<(), String> {
    if let Some(rule) = rule {
        if !REPEAT_RULES.contains(&rule) {
            return Err("Repeat rule must be daily, weekly, or monthly".to_string());
        }
    }
    Ok(())
}

fn next_repeat_deadline(deadline: i64, rule: &str) -> Result<i64, String> {
    let value = chrono::DateTime::<Utc>::from_timestamp_millis(deadline)
        .ok_or_else(|| "Deadline is outside the supported date range".to_string())?;
    let next = match rule {
        "daily" => value + ChronoDuration::days(1),
        "weekly" => value + ChronoDuration::weeks(1),
        "monthly" => {
            let date = value.date_naive();
            let (year, month) = if date.month() == 12 {
                (date.year() + 1, 1)
            } else {
                (date.year(), date.month() + 1)
            };
            let first_of_following_month = if month == 12 {
                chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
            } else {
                chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)
            }
            .ok_or_else(|| "Unable to calculate the next monthly deadline".to_string())?;
            let last_day = (first_of_following_month - ChronoDuration::days(1)).day();
            let day = date.day().min(last_day);
            let next_date = chrono::NaiveDate::from_ymd_opt(year, month, day)
                .ok_or_else(|| "Unable to calculate the next monthly deadline".to_string())?;
            next_date
                .and_hms_milli_opt(
                    value.hour(),
                    value.minute(),
                    value.second(),
                    value.timestamp_subsec_millis(),
                )
                .ok_or_else(|| "Unable to calculate the next monthly deadline".to_string())?
                .and_utc()
        }
        _ => return Err("Unsupported repeat rule".to_string()),
    };
    let timestamp = next.timestamp_millis();
    if !(0..=MAX_TIMESTAMP_MS).contains(&timestamp) {
        return Err("Next deadline is outside the supported date range".to_string());
    }
    Ok(timestamp)
}

#[cfg(test)]
mod repeat_tests {
    use super::*;

    fn timestamp(value: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(value)
            .unwrap()
            .timestamp_millis()
    }

    #[test]
    fn advances_daily_and_weekly_deadlines() {
        let base = timestamp("2026-08-11T09:30:00Z");
        assert_eq!(
            next_repeat_deadline(base, "daily").unwrap(),
            timestamp("2026-08-12T09:30:00Z")
        );
        assert_eq!(
            next_repeat_deadline(base, "weekly").unwrap(),
            timestamp("2026-08-18T09:30:00Z")
        );
    }

    #[test]
    fn clamps_monthly_deadline_to_last_day() {
        let base = timestamp("2026-01-31T09:30:00Z");
        assert_eq!(
            next_repeat_deadline(base, "monthly").unwrap(),
            timestamp("2026-02-28T09:30:00Z")
        );
    }
}

fn next_timestamp(previous: i64) -> Result<i64, String> {
    if previous > MAX_TIMESTAMP_MS {
        return Err("Existing timestamp is outside the supported date range".to_string());
    }
    let next = chrono::Utc::now()
        .timestamp_millis()
        .max(previous.saturating_add(1));
    if next > MAX_TIMESTAMP_MS {
        return Err("Timestamp range has been exhausted".to_string());
    }
    Ok(next)
}

fn validate_text_size(label: &str, value: &str, max_bytes: usize) -> Result<(), String> {
    if value.contains('\0') {
        return Err(format!("{label} cannot contain NUL characters"));
    }
    if value.len() > max_bytes {
        return Err(format!("{label} exceeds the {max_bytes}-byte limit"));
    }
    Ok(())
}

fn validate_entity_id(label: &str, id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(format!("{label} has an invalid ID"));
    }
    Ok(())
}

fn next_database_timestamp(conn: &rusqlite::Connection) -> Result<i64, String> {
    let latest = conn
        .query_row(
            "SELECT COALESCE(MAX(value), 0)
             FROM (
               SELECT MAX(updated_at) AS value FROM notes
               UNION ALL SELECT MAX(updated_at) FROM groups
               UNION ALL SELECT MAX(deleted_at) FROM note_tombstones
             )",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    next_timestamp(latest)
}

fn normalize_tags(tags: &[String]) -> Result<Vec<String>, String> {
    if tags.len() > MAX_TAGS {
        return Err(format!("Too many tags (maximum {MAX_TAGS})"));
    }
    let mut normalized = Vec::new();
    for tag in tags {
        let tag = tag.trim();
        if tag.is_empty() {
            continue;
        }
        validate_text_size("Tag", tag, MAX_TAG_BYTES)?;
        if !normalized.iter().any(|existing| existing == tag) {
            normalized.push(tag.to_string());
        }
    }
    Ok(normalized)
}

fn validate_group_id(conn: &rusqlite::Connection, group_id: Option<&str>) -> Result<(), String> {
    let Some(group_id) = group_id else {
        return Ok(());
    };
    validate_entity_id("Group", group_id)?;
    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM groups WHERE id = ?1 AND deleted_at IS NULL)",
            [group_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Err("Target group does not exist".to_string());
    }
    Ok(())
}

pub struct AppState {
    pub db: Arc<Database>,
    /// Prevents two sync jobs in the same process from interleaving their
    /// manifest read/merge/write cycles.
    pub sync_lock: Arc<AsyncMutex<()>>,
    /// Serializes vault-key changes with password-note reads and writes.
    pub vault_lock: Arc<AsyncMutex<()>>,
    /// Allows the UI to request cancellation between network operations.
    pub sync_cancelled: Arc<AtomicBool>,
}

#[tauri::command]
pub async fn get_all_notes(state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    let _vault_guard = state.vault_lock.lock().await;
    let conn = state.db.get_connection();
    let conn = conn.lock();
    let mut vault_key = None;
    let mut vault_key_error: Option<String> = None;
    let tags_by_note = get_all_note_tags(&conn).map_err(|error| error.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, is_todo, is_completed, color, pinned, priority,
                    created_at, updated_at, synced_at, group_id, completed_at, deadline, repeat_rule
             FROM notes
             ORDER BY pinned DESC, priority DESC, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([], |row| {
            let note_id: String = row.get(0)?;

            Ok(Note {
                id: note_id.clone(),
                title: row.get(1)?,
                content: row.get(2)?,
                is_todo: row.get::<_, i64>(3)? != 0,
                is_completed: row.get::<_, i64>(4)? != 0,
                color: row.get(5)?,
                pinned: row.get::<_, i64>(6)? != 0,
                priority: row.get::<_, i32>(7)?,
                tags: Vec::new(), // 稍后填充
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                synced_at: row.get(10)?,
                group_id: row.get(11)?,
                completed_at: row.get(12)?,
                deadline: row.get(13)?,
                repeat_rule: row.get(14)?,
                decryption_error: None,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for note_result in notes {
        let mut note = note_result.map_err(|e| e.to_string())?;
        note.tags = tags_by_note.get(&note.id).cloned().unwrap_or_default();

        if note.content == crypto::PASSWORD_NOTE_MARKER {
            if let Some(error) = vault_key_error.as_ref() {
                note.title = crypto::PASSWORD_DECRYPTION_ERROR_TITLE.to_string();
                note.decryption_error = Some(error.clone());
                result.push(note);
                continue;
            }
            let key = match vault_key {
                Some(key) => key,
                None => match crypto::load_vault_key() {
                    Ok(key) => {
                        vault_key = Some(key);
                        key
                    }
                    Err(error) => {
                        vault_key_error = Some(error.clone());
                        note.title = crypto::PASSWORD_DECRYPTION_ERROR_TITLE.to_string();
                        note.decryption_error = Some(error);
                        result.push(note);
                        continue;
                    }
                },
            };
            match crypto::decrypt_note_title_with_key(&note.id, &note.title, &key) {
                Ok(title) => note.title = title,
                Err(error) => {
                    eprintln!("Failed to decrypt password note {}: {}", note.id, error);
                    note.title = crypto::PASSWORD_DECRYPTION_ERROR_TITLE.to_string();
                    note.decryption_error = Some(error);
                }
            }
        }
        result.push(note);
    }

    Ok(result)
}

#[tauri::command]
pub async fn get_note_by_id(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Note>, String> {
    validate_entity_id("Note", &id)?;
    let _vault_guard = state.vault_lock.lock().await;
    let conn = state.db.get_connection();
    let conn = conn.lock();
    query_note_by_id(&conn, &id).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_note(
    input: CreateNoteInput,
    state: State<'_, AppState>,
) -> Result<Note, String> {
    let _vault_guard = state.vault_lock.lock().await;
    let conn = state.db.get_connection();
    let mut conn = conn.lock();

    validate_text_size("Title", &input.title, MAX_TITLE_BYTES)?;
    validate_text_size("Content", &input.content, MAX_CONTENT_BYTES)?;
    if let Some(color) = input.color.as_deref() {
        validate_text_size("Color", color, MAX_COLOR_BYTES)?;
    }
    if !(0..=2).contains(&input.priority.unwrap_or(0)) {
        return Err("Priority must be between 0 and 2".to_string());
    }
    if input
        .deadline
        .is_some_and(|deadline| !(0..=MAX_TIMESTAMP_MS).contains(&deadline))
    {
        return Err("Deadline is outside the supported date range".to_string());
    }
    validate_repeat_rule(input.repeat_rule.as_deref())?;
    if input.repeat_rule.is_some() && input.deadline.is_none() {
        return Err("A repeat rule requires a deadline".to_string());
    }
    validate_group_id(&conn, input.group_id.as_deref())?;
    let tags = normalize_tags(&input.tags)?;

    let is_blank_draft =
        input.is_todo && input.title.trim().is_empty() && input.content.trim().is_empty();
    if is_blank_draft {
        let existing_id = conn
            .query_row(
                "SELECT id FROM notes
                 WHERE is_todo = 1 AND is_completed = 0
                   AND TRIM(title) = '' AND TRIM(content) = ''
                   AND COALESCE(group_id, '') = COALESCE(?1, '')
                 ORDER BY updated_at DESC, id DESC
                 LIMIT 1",
                params![input.group_id.as_deref()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(existing_id) = existing_id {
            return query_note_by_id(&conn, &existing_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "Existing blank note disappeared".to_string());
        }
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = next_database_timestamp(&conn)?;
    let priority = input.priority.unwrap_or(0);
    let pinned = input.pinned.unwrap_or(false);
    let stored_title = crypto::encrypt_note_title(&id, &input.content, &input.title)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO notes (id, title, content, is_todo, is_completed, color, pinned, priority, created_at, updated_at, group_id, deadline, repeat_rule)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11)",
        params![
            &id,
            &stored_title,
            &input.content,
            input.is_todo as i64,
            &input.color,
            pinned as i64,
            priority,
            now,
            &input.group_id,
            input.deadline,
            &input.repeat_rule,
        ],
    )
    .map_err(|e| e.to_string())?;

    // 插入标签
    for tag_name in &tags {
        insert_tag_for_note(&tx, &id, tag_name).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(Note {
        id,
        title: input.title,
        content: input.content,
        is_todo: input.is_todo,
        is_completed: false,
        color: input.color,
        pinned,
        priority,
        tags,
        group_id: input.group_id,
        created_at: now,
        updated_at: now,
        synced_at: None,
        completed_at: None,
        deadline: input.deadline,
        repeat_rule: input.repeat_rule,
        decryption_error: None,
    })
}

#[tauri::command]
pub async fn update_note(
    input: UpdateNoteInput,
    state: State<'_, AppState>,
) -> Result<Note, String> {
    let _vault_guard = state.vault_lock.lock().await;
    validate_entity_id("Note", &input.id)?;
    let conn = state.db.get_connection();
    validate_text_size(
        "Title",
        input.title.as_deref().unwrap_or(""),
        MAX_TITLE_BYTES,
    )?;
    validate_text_size(
        "Content",
        input.content.as_deref().unwrap_or(""),
        MAX_CONTENT_BYTES,
    )?;
    if let Some(color) = input.color.as_deref() {
        validate_text_size("Color", color, MAX_COLOR_BYTES)?;
    }
    if let Some(priority) = input.priority {
        if !(0..=2).contains(&priority) {
            return Err("Priority must be between 0 and 2".to_string());
        }
    }
    if input
        .deadline
        .is_some_and(|deadline| !(0..=MAX_TIMESTAMP_MS).contains(&deadline))
    {
        return Err("Deadline is outside the supported date range".to_string());
    }
    validate_repeat_rule(input.repeat_rule.as_deref())?;
    let normalized_tags = input.tags.as_deref().map(normalize_tags).transpose()?;

    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let current = tx
        .query_row(
            "SELECT title, content, is_todo, is_completed, color, pinned, priority,
                    group_id, created_at, updated_at, completed_at, deadline, repeat_rule
             FROM notes WHERE id = ?1",
            [&input.id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? != 0,
                    row.get::<_, i64>(3)? != 0,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)? != 0,
                    row.get::<_, i32>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, Option<i64>>(10)?,
                    row.get::<_, Option<i64>>(11)?,
                    row.get::<_, Option<String>>(12)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Note not found".to_string())?;

    let current_title = crypto::decrypt_note_title(&input.id, &current.1, &current.0)?;
    let next_title = input.title.clone().unwrap_or(current_title);
    let next_content = input.content.clone().unwrap_or(current.1);
    let stored_title = crypto::encrypt_note_title(&input.id, &next_content, &next_title)?;
    let next_is_todo = input.is_todo.unwrap_or(current.2);
    let next_completed = input.is_completed.unwrap_or(current.3);
    let next_color = if input.clear_color.unwrap_or(false) {
        None
    } else if input.color.is_some() {
        input.color.clone()
    } else {
        current.4
    };
    let next_pinned = input.pinned.unwrap_or(current.5);
    let next_priority = input.priority.unwrap_or(current.6);
    let next_group_id = if input.clear_group.unwrap_or(false) {
        None
    } else if input.group_id.is_some() {
        input
            .group_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    } else {
        current.7
    };
    validate_group_id(&tx, next_group_id.as_deref())?;
    let next_deadline = if input.clear_deadline.unwrap_or(false) {
        None
    } else if input.deadline.is_some() {
        input.deadline
    } else {
        current.11
    };
    let next_repeat_rule =
        if !next_is_todo || next_deadline.is_none() || input.clear_repeat_rule.unwrap_or(false) {
            None
        } else if input.repeat_rule.is_some() {
            input.repeat_rule.clone()
        } else {
            current.12
        };
    if next_repeat_rule.is_some() && next_deadline.is_none() {
        return Err("A repeat rule requires a deadline".to_string());
    }
    let should_spawn_next =
        !current.3 && next_completed && next_repeat_rule.is_some() && next_deadline.is_some();
    let spawned_deadline = if should_spawn_next {
        Some(next_repeat_deadline(
            next_deadline.expect("checked above"),
            next_repeat_rule.as_deref().expect("checked above"),
        )?)
    } else {
        None
    };
    let stored_repeat_rule = if should_spawn_next {
        None
    } else {
        next_repeat_rule.clone()
    };

    if next_is_todo
        && !next_completed
        && next_title.trim().is_empty()
        && next_content.trim().is_empty()
    {
        let duplicate = tx
            .query_row(
                "SELECT id FROM notes
                 WHERE id <> ?1 AND is_todo = 1 AND is_completed = 0
                   AND TRIM(title) = '' AND TRIM(content) = ''
                   AND COALESCE(group_id, '') = COALESCE(?2, '')
                 LIMIT 1",
                params![&input.id, next_group_id.as_deref()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(duplicate) = duplicate {
            return Err(format!(
                "A blank todo already exists in this group ({duplicate})"
            ));
        }
    }
    let now = next_timestamp(current.9)?;
    let next_completed_at = if next_completed {
        if current.3 {
            current.10
        } else {
            Some(now)
        }
    } else {
        None
    };

    tx.execute(
        "UPDATE notes SET
           title = ?1, content = ?2, is_todo = ?3, is_completed = ?4,
           color = ?5, pinned = ?6, priority = ?7, group_id = ?8,
           updated_at = ?9, completed_at = ?10, deadline = ?11, repeat_rule = ?12
         WHERE id = ?13",
        params![
            stored_title,
            next_content,
            next_is_todo as i64,
            next_completed as i64,
            next_color,
            next_pinned as i64,
            next_priority,
            next_group_id,
            now,
            next_completed_at,
            next_deadline,
            stored_repeat_rule,
            &input.id,
        ],
    )
    .map_err(|error| error.to_string())?;

    if let Some(tags) = normalized_tags.as_ref() {
        tx.execute("DELETE FROM note_tags WHERE note_id = ?1", [&input.id])
            .map_err(|error| error.to_string())?;
        for tag_name in tags {
            insert_tag_for_note(&tx, &input.id, tag_name).map_err(|error| error.to_string())?;
        }
    }

    if let Some(deadline) = spawned_deadline {
        let next_id = uuid::Uuid::new_v4().to_string();
        let next_created_at = next_timestamp(now)?;
        let next_title = crypto::encrypt_note_title(&next_id, &next_content, &next_title)?;
        let next_tags = normalized_tags
            .clone()
            .unwrap_or(get_note_tags(&tx, &input.id).map_err(|error| error.to_string())?);
        tx.execute(
            "INSERT INTO notes
             (id, title, content, is_todo, is_completed, color, pinned, priority,
              created_at, updated_at, group_id, deadline, repeat_rule)
             VALUES (?1, ?2, ?3, 1, 0, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10)",
            params![
                &next_id,
                next_title,
                &next_content,
                next_color,
                next_pinned as i64,
                next_priority,
                next_created_at,
                &next_group_id,
                deadline,
                &next_repeat_rule,
            ],
        )
        .map_err(|error| error.to_string())?;
        for tag_name in &next_tags {
            insert_tag_for_note(&tx, &next_id, tag_name).map_err(|error| error.to_string())?;
        }
    }
    tx.commit().map_err(|error| error.to_string())?;

    query_note_by_id(&conn, &input.id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Note not found after update".to_string())
}

#[tauri::command]
pub async fn delete_note(id: String, state: State<'_, AppState>) -> Result<(), String> {
    validate_entity_id("Note", &id)?;
    let _vault_guard = state.vault_lock.lock().await;
    let conn = state.db.get_connection();
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let previous_updated = tx
        .query_row("SELECT updated_at FROM notes WHERE id = ?1", [&id], |row| {
            row.get::<_, i64>(0)
        })
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(previous_updated) = previous_updated else {
        tx.commit().map_err(|error| error.to_string())?;
        return Ok(());
    };
    let deleted_at = next_timestamp(previous_updated)?;

    tx.execute(
        "INSERT INTO note_tombstones (note_id, deleted_at)
         VALUES (?1, ?2)
         ON CONFLICT(note_id) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)",
        params![&id, deleted_at],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM notes WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn search_notes(query: String, state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    validate_text_size("Search query", &query, 4096)?;
    let _vault_guard = state.vault_lock.lock().await;
    let conn = state.db.get_connection();
    let conn = conn.lock();
    let mut vault_key = None;
    let mut vault_key_error: Option<String> = None;
    let tags_by_note = get_all_note_tags(&conn).map_err(|error| error.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, is_todo, is_completed, color, pinned, priority,
                    created_at, updated_at, synced_at, group_id, completed_at, deadline, repeat_rule
             FROM notes
             ORDER BY pinned DESC, priority DESC, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                is_todo: row.get::<_, i64>(3)? != 0,
                is_completed: row.get::<_, i64>(4)? != 0,
                color: row.get(5)?,
                pinned: row.get::<_, i64>(6)? != 0,
                priority: row.get::<_, i32>(7)?,
                tags: Vec::new(),
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                synced_at: row.get(10)?,
                group_id: row.get(11)?,
                completed_at: row.get(12)?,
                deadline: row.get(13)?,
                repeat_rule: row.get(14)?,
                decryption_error: None,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    let normalized_query = query.to_lowercase();
    for note_result in notes {
        let mut note = note_result.map_err(|e| e.to_string())?;
        note.tags = tags_by_note.get(&note.id).cloned().unwrap_or_default();
        if note.content == crypto::PASSWORD_NOTE_MARKER {
            if let Some(error) = vault_key_error.as_ref() {
                note.title = crypto::PASSWORD_DECRYPTION_ERROR_TITLE.to_string();
                note.decryption_error = Some(error.clone());
            } else {
                let key = match vault_key {
                    Some(key) => key,
                    None => match crypto::load_vault_key() {
                        Ok(key) => {
                            vault_key = Some(key);
                            key
                        }
                        Err(error) => {
                            vault_key_error = Some(error.clone());
                            note.title = crypto::PASSWORD_DECRYPTION_ERROR_TITLE.to_string();
                            note.decryption_error = Some(error);
                            if !note.title.to_lowercase().contains(&normalized_query)
                                && !note.content.to_lowercase().contains(&normalized_query)
                            {
                                continue;
                            }
                            result.push(note);
                            continue;
                        }
                    },
                };
                match crypto::decrypt_note_title_with_key(&note.id, &note.title, &key) {
                    Ok(title) => note.title = title,
                    Err(error) => {
                        eprintln!("Failed to decrypt password note {}: {}", note.id, error);
                        note.title = crypto::PASSWORD_DECRYPTION_ERROR_TITLE.to_string();
                        note.decryption_error = Some(error);
                    }
                }
            }
        }
        if !note.title.to_lowercase().contains(&normalized_query)
            && !note.content.to_lowercase().contains(&normalized_query)
        {
            continue;
        }
        result.push(note);
    }

    Ok(result)
}

#[tauri::command]
pub async fn get_all_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();

    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM tags ORDER BY name")
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tags)
}

fn query_note_by_id(conn: &rusqlite::Connection, id: &str) -> Result<Option<Note>, String> {
    let note = conn
        .query_row(
            "SELECT id, title, content, is_todo, is_completed, color, pinned, priority,
                    created_at, updated_at, synced_at, group_id, completed_at, deadline, repeat_rule
             FROM notes WHERE id = ?1",
            [id],
            |row| {
                Ok(Note {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    content: row.get(2)?,
                    is_todo: row.get::<_, i64>(3)? != 0,
                    is_completed: row.get::<_, i64>(4)? != 0,
                    color: row.get(5)?,
                    pinned: row.get::<_, i64>(6)? != 0,
                    priority: row.get::<_, i32>(7)?,
                    tags: Vec::new(),
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    synced_at: row.get(10)?,
                    group_id: row.get(11)?,
                    completed_at: row.get(12)?,
                    deadline: row.get(13)?,
                    repeat_rule: row.get(14)?,
                    decryption_error: None,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    note.map(|mut note| {
        if note.content == crypto::PASSWORD_NOTE_MARKER {
            match crypto::decrypt_note_title(&note.id, &note.content, &note.title) {
                Ok(title) => note.title = title,
                Err(error) => {
                    note.title = crypto::PASSWORD_DECRYPTION_ERROR_TITLE.to_string();
                    note.decryption_error = Some(error);
                }
            }
        }
        note.tags = get_note_tags(conn, &note.id).map_err(|error| error.to_string())?;
        Ok(note)
    })
    .transpose()
}

// 辅助函数
fn get_note_tags(conn: &rusqlite::Connection, note_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM tags t
         INNER JOIN note_tags nt ON t.id = nt.tag_id
         WHERE nt.note_id = ?1
         ORDER BY t.name",
    )?;

    let tags = stmt
        .query_map([note_id], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;

    Ok(tags)
}

fn get_all_note_tags(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<HashMap<String, Vec<String>>> {
    let mut statement = conn.prepare(
        "SELECT nt.note_id, t.name
         FROM note_tags nt
         INNER JOIN tags t ON t.id = nt.tag_id
         ORDER BY nt.note_id, t.name",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut tags_by_note = HashMap::<String, Vec<String>>::new();
    for row in rows {
        let (note_id, tag) = row?;
        tags_by_note.entry(note_id).or_default().push(tag);
    }
    Ok(tags_by_note)
}

fn insert_tag_for_note(
    tx: &rusqlite::Transaction,
    note_id: &str,
    tag_name: &str,
) -> rusqlite::Result<()> {
    // 查找或创建标签
    let tag_id: Option<String> = tx
        .query_row("SELECT id FROM tags WHERE name = ?1", [tag_name], |row| {
            row.get(0)
        })
        .optional()?;

    let tag_id = if let Some(id) = tag_id {
        id
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        tx.execute(
            "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![&new_id, tag_name, now],
        )?;
        new_id
    };

    // 关联便签和标签
    tx.execute(
        "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
        params![note_id, &tag_id],
    )?;

    Ok(())
}

// 分组管理命令
#[tauri::command]
pub async fn get_all_groups(state: State<'_, AppState>) -> Result<Vec<Group>, String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();

    let mut stmt = conn
        .prepare(
            "SELECT id, name, display_order, created_at, updated_at, deleted_at
             FROM groups
             WHERE deleted_at IS NULL
             ORDER BY
                display_order ASC,
                CASE WHEN name GLOB '[A-Za-z]*' THEN 0 ELSE 1 END,
                name COLLATE NOCASE ASC,
                created_at ASC,
                id ASC",
        )
        .map_err(|e| e.to_string())?;

    let groups = stmt
        .query_map([], |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                display_order: row.get::<_, i32>(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                deleted_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(groups)
}

#[tauri::command]
pub async fn create_group(
    input: CreateGroupInput,
    state: State<'_, AppState>,
) -> Result<Group, String> {
    let _vault_guard = state.vault_lock.lock().await;
    let conn = state.db.get_connection();
    let conn = conn.lock();

    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("Group name cannot be empty".to_string());
    }
    validate_text_size("Group name", &name, MAX_GROUP_NAME_BYTES)?;
    let duplicate = conn
        .query_row(
            "SELECT id FROM groups WHERE name = ?1 AND deleted_at IS NULL LIMIT 1",
            [&name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if duplicate.is_some() {
        return Err("A group with this name already exists".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = next_database_timestamp(&conn)?;
    let next_display_order = conn
        .query_row(
            "SELECT COALESCE(MAX(display_order), -1)
             FROM groups
             WHERE deleted_at IS NULL",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        .checked_add(1)
        .ok_or_else(|| "Group display order has reached its limit".to_string())?;
    let display_order = i32::try_from(next_display_order)
        .map_err(|_| "Group display order has reached its limit".to_string())?;

    conn.execute(
        "INSERT INTO groups (id, name, display_order, created_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?4, NULL)",
        params![&id, &name, display_order, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Group {
        id,
        name,
        display_order,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    })
}

#[tauri::command]
pub async fn update_group(
    input: UpdateGroupInput,
    state: State<'_, AppState>,
) -> Result<Group, String> {
    let _vault_guard = state.vault_lock.lock().await;
    validate_entity_id("Group", &input.id)?;
    let conn = state.db.get_connection();
    let mut conn = conn.lock();
    if input.name.is_none() && input.display_order.is_none() {
        return Err("No fields to update".to_string());
    }
    if let Some(name) = input.name.as_deref() {
        let name = name.trim();
        if name.is_empty() {
            return Err("Group name cannot be empty".to_string());
        }
        validate_text_size("Group name", name, MAX_GROUP_NAME_BYTES)?;
    }
    if input.display_order.is_some_and(|order| order < 0) {
        return Err("Display order cannot be negative".to_string());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let current = tx
        .query_row(
            "SELECT name, display_order, created_at, updated_at
             FROM groups WHERE id = ?1 AND deleted_at IS NULL",
            [&input.id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Group not found".to_string())?;
    let name = input
        .name
        .as_deref()
        .map(str::trim)
        .map(ToOwned::to_owned)
        .unwrap_or(current.0);
    let duplicate = tx
        .query_row(
            "SELECT id FROM groups
             WHERE id <> ?1 AND name = ?2 AND deleted_at IS NULL
             LIMIT 1",
            params![&input.id, &name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if duplicate.is_some() {
        return Err("A group with this name already exists".to_string());
    }
    let display_order = input.display_order.unwrap_or(current.1);
    let now = next_timestamp(current.3)?;
    tx.execute(
        "UPDATE groups SET name = ?1, display_order = ?2, updated_at = ?3,
                deleted_at = NULL WHERE id = ?4",
        params![name, display_order, now, &input.id],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;

    conn.query_row(
        "SELECT id, name, display_order, created_at, updated_at, deleted_at
         FROM groups WHERE id = ?1 AND deleted_at IS NULL",
        [&input.id],
        |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                display_order: row.get::<_, i32>(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                deleted_at: row.get(5)?,
            })
        },
    )
    .map_err(|error| error.to_string())
}

/// Atomically persist the complete active-group order.  Updating two rows in
/// separate IPC calls can otherwise leave a half-swapped order after a crash
/// or a competing sync.
#[tauri::command]
pub async fn reorder_groups(
    group_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Group>, String> {
    let _vault_guard = state.vault_lock.lock().await;
    if group_ids.len() > 50_000 {
        return Err("Too many groups".to_string());
    }
    for group_id in &group_ids {
        validate_entity_id("Group", group_id)?;
    }
    let mut seen = std::collections::HashSet::new();
    if !group_ids.iter().all(|id| seen.insert(id)) {
        return Err("Duplicate group ID".to_string());
    }

    let conn = state.db.get_connection();
    let mut conn = conn.lock();
    let now = next_database_timestamp(&conn)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let active_count = tx
        .query_row(
            "SELECT COUNT(*) FROM groups WHERE deleted_at IS NULL",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let active_count =
        usize::try_from(active_count).map_err(|_| "Active group count is invalid".to_string())?;
    if active_count != group_ids.len() {
        return Err("Group order must include every active group exactly once".to_string());
    }
    for (display_order, group_id) in group_ids.iter().enumerate() {
        let changed = tx
            .execute(
                "UPDATE groups SET display_order = ?1,
                        updated_at = MAX(
                            CASE WHEN updated_at < 9223372036854775807 THEN updated_at + 1 ELSE updated_at END,
                            ?2)
                 WHERE id = ?3 AND deleted_at IS NULL",
                params![display_order as i64, now, group_id],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err(format!("Group not found: {group_id}"));
        }
    }
    tx.commit().map_err(|error| error.to_string())?;

    let mut statement = conn
        .prepare(
            "SELECT id, name, display_order, created_at, updated_at, deleted_at
             FROM groups WHERE deleted_at IS NULL ORDER BY display_order, id",
        )
        .map_err(|error| error.to_string())?;
    let groups = statement
        .query_map([], |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                display_order: row.get::<_, i32>(2)?,
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

#[tauri::command]
pub async fn delete_group(id: String, state: State<'_, AppState>) -> Result<(), String> {
    validate_entity_id("Group", &id)?;
    let _vault_guard = state.vault_lock.lock().await;
    let conn = state.db.get_connection();
    let mut conn = conn.lock();
    let global_now = next_database_timestamp(&conn)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let previous_updated = tx
        .query_row(
            "SELECT updated_at FROM groups WHERE id = ?1 AND deleted_at IS NULL",
            [&id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(previous_updated) = previous_updated else {
        tx.commit().map_err(|error| error.to_string())?;
        return Ok(());
    };
    let now = global_now.max(next_timestamp(previous_updated)?);

    // 将该分组下的所有待办的 group_id 设为 NULL
    tx.execute(
        "UPDATE notes SET group_id = NULL, updated_at = MAX(
             CASE WHEN updated_at < 9223372036854775807 THEN updated_at + 1 ELSE updated_at END,
             ?1)
         WHERE group_id = ?2",
        params![now, &id],
    )
    .map_err(|e| e.to_string())?;
    deduplicate_blank_drafts(&tx).map_err(|error| error.to_string())?;

    // 保留删除墓碑，便于其他设备增量同步删除动作。
    tx.execute(
        "UPDATE groups SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, &id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}
