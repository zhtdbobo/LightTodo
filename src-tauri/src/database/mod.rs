use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Result, Transaction};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        // SQLite is accessed by command and sync tasks concurrently.  WAL and
        // a bounded busy timeout prevent readers from blocking writers (or
        // failing immediately) while keeping all data local to the app.
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        let mut conn = self.conn.lock();

        // Existing installations may have been created before foreign-key
        // enforcement was enabled.  Clean orphaned links before turning the
        // constraints on for all future writes.
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;

        // 创建 notes 表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                is_todo INTEGER NOT NULL DEFAULT 0,
                is_completed INTEGER NOT NULL DEFAULT 0,
                color TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                priority INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                synced_at INTEGER
            )",
            [],
        )?;

        // Migrations are explicit and idempotent.  Do not discard ALTER TABLE
        // errors: silently swallowing a failed migration leaves a database in
        // a shape that later queries cannot safely interpret.
        if !column_exists(&conn, "notes", "priority")? {
            conn.execute(
                "ALTER TABLE notes ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }

        // 创建索引
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(pinned)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at)",
            [],
        )?;

        // 创建 tags 表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute("CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)", [])?;

        // 创建 note_tags 关联表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS note_tags (
                note_id TEXT NOT NULL,
                tag_id TEXT NOT NULL,
                PRIMARY KEY (note_id, tag_id),
                FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_note_tags_note_id ON note_tags(note_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_note_tags_tag_id ON note_tags(tag_id)",
            [],
        )?;

        // 创建同步队列表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sync_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                note_id TEXT NOT NULL,
                action TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                synced INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sync_queue_synced ON sync_queue(synced)",
            [],
        )?;

        // 待办删除后 notes 行会被移除；单独保留墓碑供 manifest 增量同步传播删除。
        conn.execute(
            "CREATE TABLE IF NOT EXISTS note_tombstones (
                note_id TEXT PRIMARY KEY,
                deleted_at INTEGER NOT NULL
            )",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_note_tombstones_deleted_at
             ON note_tombstones(deleted_at)",
            [],
        )?;

        // 创建 WebDAV 配置表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS webdav_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                url TEXT NOT NULL,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 0,
                auto_sync INTEGER NOT NULL DEFAULT 0,
                directory TEXT NOT NULL DEFAULT 'LightTodo',
                last_sync INTEGER
            )",
            [],
        )?;

        if !column_exists(&conn, "webdav_config", "directory")? {
            conn.execute(
                "ALTER TABLE webdav_config ADD COLUMN directory TEXT NOT NULL DEFAULT 'LightTodo'",
                [],
            )?;
        }

        // 创建自定义分组表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0,
                deleted_at INTEGER
            )",
            [],
        )?;

        let had_display_order = {
            let mut stmt = conn.prepare("PRAGMA table_info(groups)")?;
            let columns = stmt
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<Vec<_>>>()?;
            columns.iter().any(|column| column == "display_order")
        };

        if !column_exists(&conn, "groups", "updated_at")? {
            conn.execute(
                "ALTER TABLE groups ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !column_exists(&conn, "groups", "deleted_at")? {
            conn.execute("ALTER TABLE groups ADD COLUMN deleted_at INTEGER", [])?;
        }
        if !column_exists(&conn, "groups", "display_order")? {
            conn.execute(
                "ALTER TABLE groups ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        conn.execute(
            "UPDATE groups SET updated_at = created_at WHERE updated_at = 0",
            [],
        )?;

        let groups_sql: Option<String> = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'groups'",
                [],
                |row| row.get(0),
            )
            .optional()?;

        if groups_sql
            .as_deref()
            .map(|sql| sql.contains("name TEXT NOT NULL UNIQUE"))
            .unwrap_or(false)
        {
            let tx = conn.transaction()?;
            tx.execute("DROP TABLE IF EXISTS groups_old_structure", [])?;
            tx.execute("ALTER TABLE groups RENAME TO groups_old_structure", [])?;
            tx.execute(
                "CREATE TABLE groups (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    display_order INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT 0,
                    deleted_at INTEGER
                )",
                [],
            )?;
            tx.execute(
                "INSERT INTO groups
                 (id, name, display_order, created_at, updated_at, deleted_at)
                 SELECT id, name, display_order, created_at,
                        CASE WHEN updated_at = 0 THEN created_at ELSE updated_at END,
                        deleted_at
                 FROM groups_old_structure",
                [],
            )?;
            tx.execute("DROP TABLE groups_old_structure", [])?;
            tx.commit()?;
        }

        let ordered_groups = {
            let mut stmt = conn.prepare(
                "SELECT id, display_order
                 FROM groups
                 WHERE deleted_at IS NULL
                 ORDER BY
                    display_order ASC,
                    CASE WHEN name GLOB '[A-Za-z]*' THEN 0 ELSE 1 END,
                    name COLLATE NOCASE ASC,
                    created_at ASC,
                    id ASC",
            )?;

            let groups = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })?
                .collect::<Result<Vec<_>>>()?;
            groups
        };
        let should_normalize_order = if !had_display_order {
            true
        } else {
            ordered_groups.iter().enumerate().try_fold(
                false,
                |needs_normalization, (display_order, (_, current_order))| {
                    let display_order = i32::try_from(display_order).map_err(|error| {
                        rusqlite::Error::ToSqlConversionFailure(Box::new(error))
                    })?;
                    Ok::<bool, rusqlite::Error>(
                        needs_normalization || *current_order != i64::from(display_order),
                    )
                },
            )?
        };

        if should_normalize_order {
            let migration_timestamp = chrono::Utc::now().timestamp_millis();

            for (display_order, (group_id, _)) in ordered_groups.iter().enumerate() {
                let display_order = i32::try_from(display_order)
                    .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
                conn.execute(
                    "UPDATE groups
                     SET display_order = ?1, updated_at = ?2
                     WHERE id = ?3",
                    params![display_order, migration_timestamp, group_id],
                )?;
            }
        }

        conn.execute("DROP INDEX IF EXISTS idx_groups_order", [])?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_groups_order ON groups(display_order)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_groups_updated_at ON groups(updated_at)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_groups_deleted_at ON groups(deleted_at)",
            [],
        )?;

        if !column_exists(&conn, "notes", "group_id")? {
            conn.execute("ALTER TABLE notes ADD COLUMN group_id TEXT", [])?;
        }

        if !column_exists(&conn, "notes", "completed_at")? {
            conn.execute("ALTER TABLE notes ADD COLUMN completed_at INTEGER", [])?;
        }

        // 截止时间使用 Unix 毫秒时间戳；NULL 表示未设置。
        if !column_exists(&conn, "notes", "deadline")? {
            conn.execute("ALTER TABLE notes ADD COLUMN deadline INTEGER", [])?;
        }

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_deadline ON notes(deadline)",
            [],
        )?;

        // 创建 completed_at 索引
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_completed_at ON notes(completed_at)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_group_id ON notes(group_id)",
            [],
        )?;

        // Releases before 0.2.3 stored Unix timestamps in seconds.  Convert
        // every timestamp-bearing column once so sync comparisons remain
        // meaningful after the switch to millisecond precision.  The bounded
        // predicate makes this idempotent and prevents multiplying already
        // millisecond (or otherwise very large) values.
        migrate_epoch_seconds_to_millis(&mut conn)?;

        // Repair stale group references left by versions that did not enforce
        // group ownership.  Keeping these rows attached to a deleted/missing
        // group makes the UI hide them and makes a remote sync impossible, so
        // move them to the explicit unclassified bucket and bump their
        // revision so the repair propagates to other devices.
        conn.execute(
            "UPDATE notes
             SET group_id = NULL,
                 updated_at = MAX(
                   CASE WHEN updated_at < 9223372036854775807 THEN updated_at + 1 ELSE updated_at END,
                   ?1)
             WHERE group_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM groups
                 WHERE groups.id = notes.group_id AND groups.deleted_at IS NULL
               )",
            [chrono::Utc::now().timestamp_millis()],
        )?;

        // Repair links left behind by older versions before relying on the
        // foreign keys declared on note_tags.
        conn.execute(
            "DELETE FROM note_tags
             WHERE NOT EXISTS (SELECT 1 FROM notes WHERE notes.id = note_tags.note_id)
                OR NOT EXISTS (SELECT 1 FROM tags WHERE tags.id = note_tags.tag_id)",
            [],
        )?;
        conn.execute(
            "DELETE FROM tags
             WHERE NOT EXISTS (
               SELECT 1 FROM note_tags WHERE note_tags.tag_id = tags.id
             )",
            [],
        )?;

        // Older releases could create several blank active drafts for one
        // group. Keep the newest draft and tombstone discarded rows so a
        // later sync cannot resurrect them.  The invariant is per group, not
        // per deadline: a blank draft is a single editing slot for that group.
        // A previous build may already have installed either version of this
        // index. Drop it before merging duplicate groups because moving their
        // notes together can temporarily create several blank drafts in one
        // group; the transaction below repairs those rows before re-creating
        // the stronger invariant.
        conn.execute("DROP INDEX IF EXISTS idx_notes_one_blank_active", [])?;
        let tx = conn.unchecked_transaction()?;
        deduplicate_active_groups(&tx)?;
        deduplicate_blank_drafts(&tx)?;
        tx.commit()?;
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_active_name ON groups(name) WHERE deleted_at IS NULL",
            [],
        )?;
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_one_blank_active
             ON notes(COALESCE(group_id, ''))
             WHERE is_todo = 1 AND is_completed = 0
               AND TRIM(title) = '' AND TRIM(content) = ''",
            [],
        )?;

        Ok(())
    }

    pub fn get_connection(&self) -> Arc<Mutex<Connection>> {
        self.conn.clone()
    }
}

/// Merge duplicate active groups left by older schemas before installing the
/// partial unique index. The newest group survives; notes are reassigned and
/// losing group rows become tombstones so sync propagates the repair.
fn deduplicate_active_groups(tx: &Transaction<'_>) -> Result<()> {
    let duplicate_rows = {
        let mut statement = tx.prepare(
            "SELECT id, keeper_id, updated_at
             FROM (
               SELECT id, updated_at,
                      FIRST_VALUE(id) OVER (
                        PARTITION BY name
                        ORDER BY updated_at DESC, created_at DESC, id DESC
                      ) AS keeper_id,
                      ROW_NUMBER() OVER (
                        PARTITION BY name
                        ORDER BY updated_at DESC, created_at DESC, id DESC
                      ) AS row_number
               FROM groups
               WHERE deleted_at IS NULL
             )
             WHERE row_number > 1",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>>>()?;
        rows
    };

    let now = chrono::Utc::now().timestamp_millis();
    for (duplicate_id, keeper_id, updated_at) in duplicate_rows {
        let deleted_at = now.max(updated_at.saturating_add(1));
        tx.execute(
            "UPDATE notes
             SET group_id = ?1,
                 updated_at = MAX(
                   CASE
                     WHEN updated_at < 9223372036854775807 THEN updated_at + 1
                     ELSE updated_at
                   END,
                   ?2
                 )
             WHERE group_id = ?3",
            params![keeper_id, deleted_at, duplicate_id],
        )?;
        tx.execute(
            "UPDATE groups
             SET deleted_at = ?1, updated_at = ?1
             WHERE id = ?2 AND deleted_at IS NULL",
            params![deleted_at, duplicate_id],
        )?;
    }
    Ok(())
}

/// Remove duplicate active blank todo drafts inside a transaction, retaining
/// the newest row for each group (including the unclassified group).  Deleted
/// rows receive tombstones so a later sync cannot resurrect them.
pub fn deduplicate_blank_drafts(tx: &Transaction<'_>) -> Result<()> {
    let duplicate_rows = {
        let mut statement = tx.prepare(
            "SELECT id, updated_at
             FROM (
               SELECT id, updated_at,
                      ROW_NUMBER() OVER (
                        PARTITION BY COALESCE(group_id, '')
                        ORDER BY updated_at DESC, id DESC
                      ) AS row_number
               FROM notes
               WHERE is_todo = 1 AND is_completed = 0
                 AND TRIM(title) = '' AND TRIM(content) = ''
             )
             WHERE row_number > 1",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?
            .collect::<Result<Vec<_>>>()?;
        rows
    };

    if duplicate_rows.is_empty() {
        return Ok(());
    }

    let now = chrono::Utc::now().timestamp_millis();
    for (id, updated_at) in duplicate_rows {
        let deleted_at = now.max(updated_at.saturating_add(1));
        tx.execute(
            "INSERT INTO note_tombstones (note_id, deleted_at)
             VALUES (?1, ?2)
             ON CONFLICT(note_id) DO UPDATE SET
               deleted_at = MAX(deleted_at, excluded.deleted_at)",
            params![id, deleted_at],
        )?;
        tx.execute("DELETE FROM notes WHERE id = ?1", [id])?;
    }
    Ok(())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    // Table names are internal constants at all call sites.  Keep this helper
    // small and avoid interpolating user-controlled identifiers.
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>>>()?;
    Ok(columns.iter().any(|name| name == column))
}

fn migrate_epoch_seconds_to_millis(conn: &mut Connection) -> Result<()> {
    const MILLIS_TIMESTAMP_FLOOR: i64 = 100_000_000_000;
    let tx = conn.transaction()?;
    tx.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            key TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL
        )",
        [],
    )?;
    let already_applied: Option<i64> = tx
        .query_row(
            "SELECT applied_at FROM schema_migrations WHERE key = 'epoch_seconds_to_millis_v1'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if already_applied.is_some() {
        tx.commit()?;
        return Ok(());
    }
    for (table, column) in [
        ("notes", "created_at"),
        ("notes", "updated_at"),
        ("notes", "synced_at"),
        ("notes", "completed_at"),
        ("notes", "deadline"),
        ("groups", "created_at"),
        ("groups", "updated_at"),
        ("groups", "deleted_at"),
        ("tags", "created_at"),
        ("note_tombstones", "deleted_at"),
        ("sync_queue", "timestamp"),
        ("webdav_config", "last_sync"),
    ] {
        let statement = format!(
            "UPDATE {table}
             SET {column} = {column} * 1000
             WHERE {column} >= 0 AND {column} < ?1"
        );
        tx.execute(&statement, [MILLIS_TIMESTAMP_FLOOR])?;
    }
    tx.execute(
        "INSERT INTO schema_migrations (key, applied_at)
         VALUES ('epoch_seconds_to_millis_v1', ?1)",
        [chrono::Utc::now().timestamp_millis()],
    )?;
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_enables_foreign_keys_and_rejects_duplicate_blank_drafts() {
        let path =
            std::env::temp_dir().join(format!("lighttodo-schema-test-{}.db", uuid::Uuid::new_v4()));
        let db = Database::new(path.clone()).expect("database should initialize");
        let connection = db.get_connection();
        let connection = connection.lock();
        let foreign_keys: i64 = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(foreign_keys, 1);

        let insert = "INSERT INTO notes
            (id, title, content, is_todo, is_completed, created_at, updated_at, group_id, deadline)
            VALUES (?1, '', '', 1, 0, 1, 1, NULL, NULL)";
        connection.execute(insert, ["blank-1"]).unwrap();
        assert!(connection.execute(insert, ["blank-2"]).is_err());

        let insert_with_deadline = "INSERT INTO notes
            (id, title, content, is_todo, is_completed, created_at, updated_at, group_id, deadline)
            VALUES (?1, '', '', 1, 0, 1, 1, NULL, 123)";
        assert!(connection
            .execute(insert_with_deadline, ["blank-with-deadline"])
            .is_err());

        let non_todo = "INSERT INTO notes
            (id, title, content, is_todo, is_completed, created_at, updated_at, group_id, deadline)
            VALUES (?1, '', '', 0, 0, 1, 1, NULL, 123)";
        assert!(connection.execute(non_todo, ["empty-note"]).is_ok());

        drop(connection);
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn epoch_seconds_are_migrated_once() {
        let path = std::env::temp_dir().join(format!(
            "lighttodo-epoch-migration-test-{}.db",
            uuid::Uuid::new_v4()
        ));
        let db = Database::new(path.clone()).expect("database should initialize");
        {
            let connection = db.get_connection();
            let mut connection = connection.lock();
            connection
                .execute(
                    "DELETE FROM schema_migrations WHERE key = 'epoch_seconds_to_millis_v1'",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO notes
                     (id, title, content, is_todo, is_completed, created_at, updated_at,
                      synced_at, completed_at, deadline)
                     VALUES ('epoch-note', 'x', '', 1, 1, 1, 2, 3, 4, 5)",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO groups
                     (id, name, display_order, created_at, updated_at, deleted_at)
                     VALUES ('epoch-group', 'epoch', 0, 6, 7, 8)",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO tags (id, name, created_at) VALUES ('epoch-tag', 'epoch', 9)",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO note_tombstones (note_id, deleted_at) VALUES ('old-note', 10)",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO webdav_config
                     (id, url, username, password, enabled, auto_sync, directory, last_sync)
                     VALUES (1, '', '', '', 0, 0, 'LightTodo', 11)
                     ON CONFLICT(id) DO UPDATE SET last_sync = 11",
                    [],
                )
                .unwrap();

            migrate_epoch_seconds_to_millis(&mut connection).unwrap();
            migrate_epoch_seconds_to_millis(&mut connection).unwrap();

            let values: (i64, i64, i64, i64, i64) = connection
                .query_row(
                    "SELECT created_at, updated_at, synced_at, completed_at, deadline
                     FROM notes WHERE id = 'epoch-note'",
                    [],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                        ))
                    },
                )
                .unwrap();
            assert_eq!(values, (1000, 2000, 3000, 4000, 5000));
            assert_eq!(
                connection
                    .query_row(
                        "SELECT created_at FROM groups WHERE id = 'epoch-group'",
                        [],
                        |row| row.get::<_, i64>(0)
                    )
                    .unwrap(),
                6000
            );
            assert_eq!(
                connection
                    .query_row(
                        "SELECT deleted_at FROM note_tombstones WHERE note_id = 'old-note'",
                        [],
                        |row| row.get::<_, i64>(0)
                    )
                    .unwrap(),
                10000
            );
            assert_eq!(
                connection
                    .query_row(
                        "SELECT last_sync FROM webdav_config WHERE id = 1",
                        [],
                        |row| row.get::<_, i64>(0)
                    )
                    .unwrap(),
                11000
            );
        }
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn duplicate_active_groups_are_repaired_before_unique_index() {
        let path = std::env::temp_dir().join(format!(
            "lighttodo-group-migration-test-{}.db",
            uuid::Uuid::new_v4()
        ));
        let db = Database::new(path.clone()).expect("database should initialize");
        {
            let connection = db.get_connection();
            let connection = connection.lock();
            connection
                .execute("DROP INDEX idx_groups_active_name", [])
                .unwrap();
            connection
                .execute(
                    "INSERT INTO groups
                     (id, name, display_order, created_at, updated_at, deleted_at)
                     VALUES ('duplicate-old', '同名', 0, 1000, 1000, NULL)",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO groups
                     (id, name, display_order, created_at, updated_at, deleted_at)
                     VALUES ('duplicate-new', '同名', 1, 1001, 2000, NULL)",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO notes
                     (id, title, content, is_todo, is_completed, created_at, updated_at, group_id)
                     VALUES ('group-note', '保留', '', 1, 0, 1000, 1000, 'duplicate-old')",
                    [],
                )
                .unwrap();
        }
        db.init_schema()
            .expect("migration should repair duplicate groups");
        {
            let connection = db.get_connection();
            let connection = connection.lock();
            assert_eq!(
                connection
                    .query_row(
                        "SELECT COUNT(*) FROM groups WHERE name = '同名' AND deleted_at IS NULL",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                1
            );
            assert!(connection
                .query_row(
                    "SELECT deleted_at IS NOT NULL FROM groups WHERE id = 'duplicate-old'",
                    [],
                    |row| row.get::<_, bool>(0),
                )
                .unwrap());
            assert_eq!(
                connection
                    .query_row(
                        "SELECT group_id FROM notes WHERE id = 'group-note'",
                        [],
                        |row| row.get::<_, String>(0)
                    )
                    .unwrap(),
                "duplicate-new"
            );
        }
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn orphaned_group_references_are_moved_to_unclassified() {
        let path = std::env::temp_dir().join(format!(
            "lighttodo-orphan-group-test-{}.db",
            uuid::Uuid::new_v4()
        ));
        let db = Database::new(path.clone()).expect("database should initialize");
        {
            let connection = db.get_connection();
            let connection = connection.lock();
            connection
                .execute(
                    "INSERT INTO notes
                     (id, title, content, is_todo, is_completed, created_at, updated_at, group_id)
                     VALUES ('orphan-note', '孤儿', '', 1, 0, 1000, 1000, 'missing-group')",
                    [],
                )
                .unwrap();
        }
        db.init_schema()
            .expect("migration should repair orphan groups");
        {
            let connection = db.get_connection();
            let connection = connection.lock();
            let value: (Option<String>, i64) = connection
                .query_row(
                    "SELECT group_id, updated_at FROM notes WHERE id = 'orphan-note'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(value.0, None);
            assert!(value.1 > 1000);
        }
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }
}
