use crate::database::Database;
use crate::models::{CreateNoteInput, Note, Tag, UpdateNoteInput, Group, CreateGroupInput, UpdateGroupInput};
use rusqlite::{params, OptionalExtension};
use std::sync::Arc;
use tauri::State;

pub struct AppState {
    pub db: Arc<Database>,
}

#[tauri::command]
pub async fn get_all_notes(state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();

    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, is_todo, is_completed, color, pinned, priority,
                    created_at, updated_at, synced_at, group_id, completed_at
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
                priority: row.get::<_, i64>(7)? as i32,
                tags: Vec::new(), // 稍后填充
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                synced_at: row.get(10)?,
                group_id: row.get(11)?,
                completed_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for note_result in notes {
        let mut note = note_result.map_err(|e| e.to_string())?;

        // 获取便签的标签
        note.tags = get_note_tags(&conn, &note.id).map_err(|e| e.to_string())?;
        result.push(note);
    }

    Ok(result)
}

#[tauri::command]
pub async fn get_note_by_id(id: String, state: State<'_, AppState>) -> Result<Option<Note>, String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();

    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, is_todo, is_completed, color, pinned, priority,
                    created_at, updated_at, synced_at, group_id, completed_at
             FROM notes WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let note = stmt
        .query_row([&id], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                is_todo: row.get::<_, i64>(3)? != 0,
                is_completed: row.get::<_, i64>(4)? != 0,
                color: row.get(5)?,
                pinned: row.get::<_, i64>(6)? != 0,
                priority: row.get::<_, i64>(7)? as i32,
                tags: Vec::new(),
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                synced_at: row.get(10)?,
                group_id: row.get(11)?,
                completed_at: row.get(12)?,
            })
        })
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(mut note) = note {
        note.tags = get_note_tags(&conn, &note.id).map_err(|e| e.to_string())?;
        Ok(Some(note))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn create_note(input: CreateNoteInput, state: State<'_, AppState>) -> Result<Note, String> {
    let conn = state.db.get_connection();
    let mut conn = conn.lock();

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let priority = input.priority.unwrap_or(0);
    let pinned = input.pinned.unwrap_or(false);

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO notes (id, title, content, is_todo, is_completed, color, pinned, priority, created_at, updated_at, group_id)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, ?8, ?8, ?9)",
        params![
            &id,
            &input.title,
            &input.content,
            input.is_todo as i64,
            &input.color,
            pinned as i64,
            priority,
            now,
            &input.group_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    // 插入标签
    for tag_name in &input.tags {
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
        tags: input.tags,
        group_id: input.group_id,
        created_at: now,
        updated_at: now,
        synced_at: None,
        completed_at: None,
    })
}

#[tauri::command]
pub async fn update_note(input: UpdateNoteInput, state: State<'_, AppState>) -> Result<Note, String> {
    let conn = state.db.get_connection();
    let now = chrono::Utc::now().timestamp();

    // 在闭包内完成所有数据库操作
    {
        let mut conn = conn.lock();
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        // 构建动态更新语句
        let mut updates = vec!["updated_at = ?1".to_string()];
        let mut update_count = 1;

        if input.title.is_some() {
            update_count += 1;
            updates.push(format!("title = ?{}", update_count));
        }
        if input.content.is_some() {
            update_count += 1;
            updates.push(format!("content = ?{}", update_count));
        }
        if input.is_todo.is_some() {
            update_count += 1;
            updates.push(format!("is_todo = ?{}", update_count));
        }
        if input.is_completed.is_some() {
            update_count += 1;
            updates.push(format!("is_completed = ?{}", update_count));

            // 只有在从未完成变为完成时，才设置 completed_at
            // 需要判断当前 completed_at 是否为 NULL
            update_count += 1;
            updates.push(format!("completed_at = CASE WHEN ?{} = 1 AND completed_at IS NULL THEN ?{} ELSE completed_at END", update_count, update_count + 1));
            update_count += 1;
        }
        if input.color.is_some() {
            update_count += 1;
            updates.push(format!("color = ?{}", update_count));
        }
        if input.pinned.is_some() {
            update_count += 1;
            updates.push(format!("pinned = ?{}", update_count));
        }
        if input.priority.is_some() {
            update_count += 1;
            updates.push(format!("priority = ?{}", update_count));
        }
        if input.group_id.is_some() {
            update_count += 1;
            updates.push(format!("group_id = ?{}", update_count));
        }

        let sql = format!(
            "UPDATE notes SET {} WHERE id = ?{}",
            updates.join(", "),
            update_count + 1
        );

        // 使用 execute 和具体参数
        {
            let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
            let mut param_index = 1;

            stmt.raw_bind_parameter(param_index, now).map_err(|e| e.to_string())?;
            param_index += 1;

            if let Some(ref title) = input.title {
                stmt.raw_bind_parameter(param_index, title).map_err(|e| e.to_string())?;
                param_index += 1;
            }
            if let Some(ref content) = input.content {
                stmt.raw_bind_parameter(param_index, content).map_err(|e| e.to_string())?;
                param_index += 1;
            }
            if let Some(is_todo) = input.is_todo {
                stmt.raw_bind_parameter(param_index, is_todo as i64).map_err(|e| e.to_string())?;
                param_index += 1;
            }
            if let Some(is_completed) = input.is_completed {
                stmt.raw_bind_parameter(param_index, is_completed as i64).map_err(|e| e.to_string())?;
                param_index += 1;

                // 为 CASE 表达式绑定参数：is_completed 值
                stmt.raw_bind_parameter(param_index, is_completed as i64).map_err(|e| e.to_string())?;
                param_index += 1;

                // 为 CASE 表达式绑定参数：completed_at 时间戳
                stmt.raw_bind_parameter(param_index, now).map_err(|e| e.to_string())?;
                param_index += 1;
            }
            if let Some(ref color) = input.color {
                stmt.raw_bind_parameter(param_index, color).map_err(|e| e.to_string())?;
                param_index += 1;
            }
            if let Some(pinned) = input.pinned {
                stmt.raw_bind_parameter(param_index, pinned as i64).map_err(|e| e.to_string())?;
                param_index += 1;
            }
            if let Some(priority) = input.priority {
                stmt.raw_bind_parameter(param_index, priority as i64).map_err(|e| e.to_string())?;
                param_index += 1;
            }
            if let Some(ref group_id) = input.group_id {
                stmt.raw_bind_parameter(param_index, group_id).map_err(|e| e.to_string())?;
                param_index += 1;
            }
            stmt.raw_bind_parameter(param_index, &input.id).map_err(|e| e.to_string())?;

            stmt.raw_execute().map_err(|e| e.to_string())?;
        } // stmt 在这里被 drop

        // 更新标签
        if let Some(ref tags) = input.tags {
            tx.execute("DELETE FROM note_tags WHERE note_id = ?1", [&input.id])
                .map_err(|e| e.to_string())?;

            for tag_name in tags {
                insert_tag_for_note(&tx, &input.id, tag_name).map_err(|e| e.to_string())?;
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
    }

    // 释放锁后再查询
    get_note_by_id(input.id, state)
        .await?
        .ok_or_else(|| "Note not found after update".to_string())
}

#[tauri::command]
pub async fn delete_note(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();

    conn.execute("DELETE FROM notes WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn search_notes(query: String, state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();

    let search_pattern = format!("%{}%", query);
    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, is_todo, is_completed, color, pinned, priority,
                    created_at, updated_at, synced_at, group_id, completed_at
             FROM notes
             WHERE title LIKE ?1 OR content LIKE ?1
             ORDER BY pinned DESC, priority DESC, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map([&search_pattern], |row| {
            Ok(Note {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                is_todo: row.get::<_, i64>(3)? != 0,
                is_completed: row.get::<_, i64>(4)? != 0,
                color: row.get(5)?,
                pinned: row.get::<_, i64>(6)? != 0,
                priority: row.get::<_, i64>(7)? as i32,
                tags: Vec::new(),
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                synced_at: row.get(10)?,
                group_id: row.get(11)?,
                completed_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for note_result in notes {
        let mut note = note_result.map_err(|e| e.to_string())?;
        note.tags = get_note_tags(&conn, &note.id).map_err(|e| e.to_string())?;
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
        let now = chrono::Utc::now().timestamp();
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
            "SELECT id, name, created_at, updated_at, deleted_at
             FROM groups
             WHERE deleted_at IS NULL
             ORDER BY
                CASE WHEN name GLOB '[A-Za-z]*' THEN 0 ELSE 1 END,
                name COLLATE NOCASE ASC",
        )
        .map_err(|e| e.to_string())?;

    let groups = stmt
        .query_map([], |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                deleted_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(groups)
}

#[tauri::command]
pub async fn create_group(input: CreateGroupInput, state: State<'_, AppState>) -> Result<Group, String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO groups (id, name, created_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?3, NULL)",
        params![&id, &input.name, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Group {
        id,
        name: input.name,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    })
}

#[tauri::command]
pub async fn update_group(input: UpdateGroupInput, state: State<'_, AppState>) -> Result<Group, String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();
    let now = chrono::Utc::now().timestamp();

    let mut updates = vec!["updated_at = ?1".to_string(), "deleted_at = NULL".to_string()];
    let mut update_count = 1;

    if input.name.is_some() {
        update_count += 1;
        updates.push(format!("name = ?{}", update_count));
    }

    if input.name.is_none() {
        return Err("No fields to update".to_string());
    }

    let sql = format!(
        "UPDATE groups SET {} WHERE id = ?{}",
        updates.join(", "),
        update_count + 1
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut param_index = 1;

    stmt.raw_bind_parameter(param_index, now).map_err(|e| e.to_string())?;
    param_index += 1;

    if let Some(ref name) = input.name {
        stmt.raw_bind_parameter(param_index, name).map_err(|e| e.to_string())?;
        param_index += 1;
    }
    stmt.raw_bind_parameter(param_index, &input.id).map_err(|e| e.to_string())?;

    stmt.raw_execute().map_err(|e| e.to_string())?;

    // 查询更新后的分组
    let group = conn
        .query_row(
            "SELECT id, name, created_at, updated_at, deleted_at
             FROM groups
             WHERE id = ?1 AND deleted_at IS NULL",
            [&input.id],
            |row| {
                Ok(Group {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    deleted_at: row.get(4)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(group)
}

#[tauri::command]
pub async fn delete_group(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.get_connection();
    let mut conn = conn.lock();
    let now = chrono::Utc::now().timestamp();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 将该分组下的所有待办的 group_id 设为 NULL
    tx.execute(
        "UPDATE notes SET group_id = NULL, updated_at = ?1 WHERE group_id = ?2",
        params![now, &id],
    )
    .map_err(|e| e.to_string())?;

    // 保留删除墓碑，便于其他设备增量同步删除动作。
    tx.execute(
        "UPDATE groups SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, &id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}
