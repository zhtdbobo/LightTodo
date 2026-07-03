use rusqlite::{Connection, Result};
use std::path::PathBuf;
use parking_lot::Mutex;
use std::sync::Arc;

pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        let conn = self.conn.lock();

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

        // 迁移：添加 priority 列（如果不存在）
        let _ = conn.execute(
            "ALTER TABLE notes ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
            [],
        );

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

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)",
            [],
        )?;

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

        // 迁移：添加 directory 列（如果不存在）
        let _ = conn.execute(
            "ALTER TABLE webdav_config ADD COLUMN directory TEXT NOT NULL DEFAULT 'LightTodo'",
            [],
        );

        // 创建自定义分组表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                display_order INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_groups_order ON groups(display_order)",
            [],
        )?;

        // 迁移：为 notes 表添加 group_id 列（如果不存在）
        let _ = conn.execute(
            "ALTER TABLE notes ADD COLUMN group_id TEXT",
            [],
        );

        // 迁移：添加 completed_at 列（如果不存在）
        let _ = conn.execute(
            "ALTER TABLE notes ADD COLUMN completed_at INTEGER",
            [],
        );

        // 创建 completed_at 索引
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_completed_at ON notes(completed_at)",
            [],
        );

        Ok(())
    }

    pub fn get_connection(&self) -> Arc<Mutex<Connection>> {
        self.conn.clone()
    }
}
