use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub is_todo: bool,
    pub is_completed: bool,
    pub color: Option<String>,
    pub pinned: bool,
    pub deadline: Option<i64>,
    pub priority: i32,
    pub tags: Vec<String>,
    pub group_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub synced_at: Option<i64>,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateNoteInput {
    pub title: String,
    pub content: String,
    pub is_todo: bool,
    pub tags: Vec<String>,
    pub color: Option<String>,
    pub priority: Option<i32>,
    pub pinned: Option<bool>,
    pub deadline: Option<i64>,
    pub group_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateNoteInput {
    pub id: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub is_todo: Option<bool>,
    pub is_completed: Option<bool>,
    pub color: Option<String>,
    pub pinned: Option<bool>,
    pub deadline: Option<i64>,
    pub clear_deadline: Option<bool>,
    pub priority: Option<i32>,
    pub tags: Option<Vec<String>>,
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateGroupInput {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateGroupInput {
    pub id: String,
    pub name: Option<String>,
}
