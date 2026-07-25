use crate::commands::AppState;
use crate::crypto::{self, VaultEnvelope};
use crate::database::deduplicate_blank_drafts;
use crate::sync::{validate_directory, WebDAVSettings};
use crate::webdav::{
    ConditionalDeleteResult, ConditionalWriteResult, WebDAVClient, WebDAVConfig, MAX_MANIFEST_BYTES,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::atomic::Ordering;
use tauri::State;

const MANIFEST_VERSION: u32 = 1;
const MANIFEST_FILE: &str = "manifest.json";
const RETRY_SYNC_PREFIX: &str = "__LIGHTTODO_RETRY__:";
const MAX_MANIFEST_OBJECTS: usize = 50_000;
const MAX_LEGACY_FILES: usize = MAX_MANIFEST_OBJECTS;
// A manifest entry is bounded individually, but a hostile (or accidentally
// huge) manifest could otherwise make one sync download or upload an
// unbounded amount of data.  Keep a generous per-run budget and ask the user
// to retry in smaller batches when it is exceeded.
const MAX_SYNC_TRANSFER_BYTES: usize = 512 * 1024 * 1024;
const MAX_TITLE_BYTES: usize = 1024 * 1024;
const MAX_CONTENT_BYTES: usize = 1024 * 1024;
const MAX_GROUP_NAME_BYTES: usize = 256;
const MAX_COLOR_BYTES: usize = 256;
const MAX_TAGS: usize = 100;
const MAX_TAG_BYTES: usize = 128;
const MILLIS_TIMESTAMP_FLOOR: i64 = 100_000_000_000;
const MAX_REMOTE_CLOCK_SKEW_MS: i64 = 7 * 24 * 60 * 60 * 1000;
const MAX_TIMESTAMP_MS: i64 = 8_640_000_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncMode {
    Bidirectional,
    Push,
    Pull,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SyncManifest {
    #[serde(default = "manifest_version")]
    version: u32,
    #[serde(default)]
    updated_at: i64,
    #[serde(default)]
    notes: BTreeMap<String, ManifestEntry>,
    #[serde(default)]
    groups: BTreeMap<String, ManifestEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    vault: Option<VaultEnvelope>,
}

impl Default for SyncManifest {
    fn default() -> Self {
        Self {
            version: MANIFEST_VERSION,
            updated_at: 0,
            notes: BTreeMap::new(),
            groups: BTreeMap::new(),
            vault: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ManifestEntry {
    updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    deleted_at: Option<i64>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    hash: String,
    /// Entity tag of the object file.  It lets uploads/deletes use
    /// If-Match, so a concurrent device cannot be overwritten silently.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    etag: Option<String>,
}

impl ManifestEntry {
    fn live(updated_at: i64, hash: impl Into<String>) -> Self {
        Self {
            updated_at,
            deleted_at: None,
            hash: hash.into(),
            etag: None,
        }
    }

    fn deleted(deleted_at: i64) -> Self {
        Self {
            updated_at: deleted_at,
            deleted_at: Some(deleted_at),
            hash: String::new(),
            etag: None,
        }
    }

    fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }

    fn effective_timestamp(&self) -> i64 {
        self.deleted_at
            .unwrap_or(self.updated_at)
            .max(self.updated_at)
    }

    fn same_revision(&self, other: &Self) -> bool {
        self.updated_at == other.updated_at
            && self.deleted_at == other.deleted_at
            && self.hash == other.hash
    }
}

#[derive(Debug, Clone)]
struct LocalObject {
    entry: ManifestEntry,
    data: Option<Vec<u8>>,
}

impl LocalObject {
    fn live(updated_at: i64, data: Vec<u8>) -> Self {
        let hash = hash_bytes(&data);
        Self {
            entry: ManifestEntry::live(updated_at, hash),
            data: Some(data),
        }
    }

    fn deleted(deleted_at: i64) -> Self {
        Self {
            entry: ManifestEntry::deleted(deleted_at),
            data: None,
        }
    }
}

#[derive(Debug, Default)]
struct LocalSnapshot {
    notes: BTreeMap<String, LocalObject>,
    groups: BTreeMap<String, LocalObject>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum ObjectKind {
    Note,
    Group,
}

impl ObjectKind {
    fn object_label(self) -> &'static str {
        match self {
            Self::Note => "待办",
            Self::Group => "分组",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MergeAction {
    None,
    Upload,
    Download,
    DeleteRemote,
    DeleteLocal,
    Conflict,
}

#[derive(Debug, Default)]
struct SyncCounts {
    uploaded_notes: usize,
    downloaded_notes: usize,
    updated_notes: usize,
    deleted_remote_notes: usize,
    deleted_local_notes: usize,
    uploaded_groups: usize,
    downloaded_groups: usize,
    updated_groups: usize,
    deleted_remote_groups: usize,
    deleted_local_groups: usize,
}

impl SyncCounts {
    fn record_upload(&mut self, kind: ObjectKind) {
        match kind {
            ObjectKind::Note => self.uploaded_notes += 1,
            ObjectKind::Group => self.uploaded_groups += 1,
        }
    }

    fn record_download(&mut self, kind: ObjectKind, was_live: bool) {
        match (kind, was_live) {
            (ObjectKind::Note, true) => self.updated_notes += 1,
            (ObjectKind::Note, false) => self.downloaded_notes += 1,
            (ObjectKind::Group, true) => self.updated_groups += 1,
            (ObjectKind::Group, false) => self.downloaded_groups += 1,
        }
    }

    fn record_remote_delete(&mut self, kind: ObjectKind) {
        match kind {
            ObjectKind::Note => self.deleted_remote_notes += 1,
            ObjectKind::Group => self.deleted_remote_groups += 1,
        }
    }

    fn record_local_delete(&mut self, kind: ObjectKind, was_live: bool) {
        if !was_live {
            return;
        }
        match kind {
            ObjectKind::Note => self.deleted_local_notes += 1,
            ObjectKind::Group => self.deleted_local_groups += 1,
        }
    }
}

#[derive(Debug)]
struct RemoteIndex {
    manifest: SyncManifest,
    manifest_exists: bool,
    manifest_etag: Option<String>,
    legacy_contents: HashMap<(ObjectKind, String), Vec<u8>>,
    needs_rewrite: bool,
}

#[derive(Debug, Default)]
struct TransferBudget {
    used: usize,
}

impl TransferBudget {
    fn charge(&mut self, bytes: usize, label: &str) -> Result<(), String> {
        let next = self.used.saturating_add(bytes);
        if next > MAX_SYNC_TRANSFER_BYTES {
            return Err(format!(
                "本次同步传输量在处理“{}”时超过上限（{} 字节）",
                label, MAX_SYNC_TRANSFER_BYTES
            ));
        }
        self.used = next;
        Ok(())
    }
}

#[derive(Debug, Default)]
struct ManifestNormalization {
    changed: bool,
    rehash: Vec<(ObjectKind, String)>,
}

fn manifest_version() -> u32 {
    MANIFEST_VERSION
}

fn hash_bytes(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

fn normalize_remote_timestamp_at(
    value: i64,
    label: &str,
    allow_future: bool,
    now: i64,
) -> Result<(i64, bool), String> {
    if value < 0 {
        return Err(format!("{label}不能为负数"));
    }
    let (normalized, changed) = if value > 0 && value < MILLIS_TIMESTAMP_FLOOR {
        (
            value
                .checked_mul(1000)
                .ok_or_else(|| format!("{label}超出有效范围"))?,
            true,
        )
    } else {
        (value, false)
    };
    if normalized > MAX_TIMESTAMP_MS {
        return Err(format!("{label}超出支持的日期范围"));
    }
    if !allow_future && normalized > now.saturating_add(MAX_REMOTE_CLOCK_SKEW_MS) {
        return Err(format!("{label}超出允许的未来时间范围"));
    }
    Ok((normalized, changed))
}

fn normalize_remote_timestamp(value: i64, label: &str, allow_future: bool) -> Result<i64, String> {
    normalize_remote_timestamp_at(
        value,
        label,
        allow_future,
        chrono::Utc::now().timestamp_millis(),
    )
    .map(|(normalized, _)| normalized)
}

fn normalize_manifest_entries(
    kind: ObjectKind,
    entries: &mut BTreeMap<String, ManifestEntry>,
    now: i64,
    normalization: &mut ManifestNormalization,
) -> Result<(), String> {
    for (id, entry) in entries {
        let (updated_at, updated_changed) = normalize_remote_timestamp_at(
            entry.updated_at,
            &format!("{} {} 的更新时间", kind.object_label(), id),
            false,
            now,
        )?;
        entry.updated_at = updated_at;
        let deleted_changed = if let Some(deleted_at) = entry.deleted_at {
            let (deleted_at, changed) = normalize_remote_timestamp_at(
                deleted_at,
                &format!("{} {} 的删除时间", kind.object_label(), id),
                false,
                now,
            )?;
            entry.deleted_at = Some(deleted_at);
            changed
        } else {
            false
        };
        if entry.is_deleted() && !entry.hash.is_empty() {
            entry.hash.clear();
            normalization.changed = true;
        }
        if entry.etag.as_deref().is_some_and(str::is_empty) {
            entry.etag = None;
            normalization.changed = true;
        }
        if entry
            .deleted_at
            .is_some_and(|deleted_at| deleted_at < entry.updated_at)
        {
            return Err(format!(
                "{} {} 的删除时间早于更新时间",
                kind.object_label(),
                id
            ));
        }
        if updated_changed || deleted_changed {
            normalization.changed = true;
            if !entry.is_deleted() {
                normalization.rehash.push((kind, id.clone()));
            }
        }
    }
    Ok(())
}

fn normalize_manifest_timestamps(
    manifest: &mut SyncManifest,
) -> Result<ManifestNormalization, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let mut normalization = ManifestNormalization::default();
    let (updated_at, changed) =
        normalize_remote_timestamp_at(manifest.updated_at, "同步索引更新时间", false, now)?;
    manifest.updated_at = updated_at;
    normalization.changed = changed;
    normalize_manifest_entries(
        ObjectKind::Note,
        &mut manifest.notes,
        now,
        &mut normalization,
    )?;
    normalize_manifest_entries(
        ObjectKind::Group,
        &mut manifest.groups,
        now,
        &mut normalization,
    )?;
    Ok(normalization)
}

fn value_bool(value: &serde_json::Value, camel_case: &str, snake_case: &str) -> bool {
    let field = value.get(camel_case).or_else(|| value.get(snake_case));
    field
        .and_then(serde_json::Value::as_bool)
        .or_else(|| {
            field
                .and_then(serde_json::Value::as_i64)
                .map(|number| number != 0)
        })
        .unwrap_or(false)
}

fn value_bool_strict(
    value: &serde_json::Value,
    camel_case: &str,
    snake_case: &str,
    label: &str,
) -> Result<bool, String> {
    let field = value.get(camel_case).or_else(|| value.get(snake_case));
    match field {
        None => Ok(false),
        Some(value) if value.is_boolean() => Ok(value.as_bool().unwrap_or(false)),
        Some(value) if value.is_i64() => Ok(value.as_i64().unwrap_or(0) != 0),
        Some(_) => Err(format!("{label}的布尔字段格式无效")),
    }
}

fn value_i64_strict(
    value: &serde_json::Value,
    camel_case: &str,
    snake_case: &str,
    label: &str,
) -> Result<Option<i64>, String> {
    let field = value.get(camel_case).or_else(|| value.get(snake_case));
    match field {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(value) => value
            .as_i64()
            .map(Some)
            .ok_or_else(|| format!("{label}的数字字段格式无效")),
    }
}

fn value_string_array_strict(
    value: &serde_json::Value,
    camel_case: &str,
    snake_case: &str,
    label: &str,
) -> Result<Vec<String>, String> {
    let field = value.get(camel_case).or_else(|| value.get(snake_case));
    if field.is_some_and(|item| !item.is_array() && !item.is_null()) {
        return Err(format!("{label}的标签字段格式无效"));
    }
    Ok(value_string_array(value, camel_case, snake_case))
}

fn value_string_array(
    value: &serde_json::Value,
    camel_case: &str,
    snake_case: &str,
) -> Vec<String> {
    let mut values = value
        .get(camel_case)
        .or_else(|| value.get(snake_case))
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    values.sort_unstable();
    values.dedup();
    values
}

fn load_note_tags(conn: &Connection, note_id: &str) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare(
            "SELECT t.name
             FROM tags t
             INNER JOIN note_tags nt ON nt.tag_id = t.id
             WHERE nt.note_id = ?1
             ORDER BY t.name",
        )
        .map_err(|error| error.to_string())?;
    let mut tags = statement
        .query_map([note_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    tags.sort_unstable();
    tags.dedup();
    Ok(tags)
}

fn load_all_note_tags(conn: &Connection) -> Result<HashMap<String, Vec<String>>, String> {
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
    let mut tags_by_note = HashMap::<String, Vec<String>>::new();
    for row in rows {
        let (note_id, tag) = row.map_err(|error| error.to_string())?;
        tags_by_note.entry(note_id).or_default().push(tag);
    }
    Ok(tags_by_note)
}

fn canonicalize_object_data(
    kind: ObjectKind,
    fallback_id: &str,
    data: &[u8],
) -> Result<Vec<u8>, String> {
    let value: serde_json::Value = serde_json::from_slice(data).map_err(|error| {
        format!(
            "解析{} {} 失败: {}",
            kind.object_label(),
            fallback_id,
            error
        )
    })?;
    let id = value
        .get("id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(fallback_id);
    if id != fallback_id {
        return Err(format!(
            "{}文件 {} 的 ID 不匹配",
            kind.object_label(),
            fallback_id
        ));
    }
    validate_object_id(id)?;

    let canonical = match kind {
        ObjectKind::Note => {
            let created_at = normalize_remote_timestamp(
                value_i64_strict(
                    &value,
                    "createdAt",
                    "created_at",
                    &format!("待办 {} 的创建时间", fallback_id),
                )?
                .ok_or_else(|| format!("待办 {} 缺少创建时间", fallback_id))?,
                &format!("待办 {} 的创建时间", fallback_id),
                false,
            )?;
            let updated_at = normalize_remote_timestamp(
                value_i64_strict(
                    &value,
                    "updatedAt",
                    "updated_at",
                    &format!("待办 {} 的更新时间", fallback_id),
                )?
                .ok_or_else(|| format!("待办 {} 缺少更新时间", fallback_id))?,
                &format!("待办 {} 的更新时间", fallback_id),
                false,
            )?;
            let is_todo = value_bool_strict(
                &value,
                "isTodo",
                "is_todo",
                &format!("待办 {}", fallback_id),
            )?;
            let is_completed = value_bool_strict(
                &value,
                "isCompleted",
                "is_completed",
                &format!("待办 {}", fallback_id),
            )?;
            let pinned =
                value_bool_strict(&value, "pinned", "pinned", &format!("待办 {}", fallback_id))?;
            let priority = value_i64_strict(
                &value,
                "priority",
                "priority",
                &format!("待办 {} 的优先级", fallback_id),
            )?
            .unwrap_or(0);
            let tags = value_string_array_strict(
                &value,
                "tags",
                "tags",
                &format!("待办 {}", fallback_id),
            )?;
            let title = value
                .get("title")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| format!("待办 {} 缺少有效标题", fallback_id))?;
            let content = value
                .get("content")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| format!("待办 {} 缺少有效内容", fallback_id))?;
            let color = match value.get("color") {
                None | Some(serde_json::Value::Null) => serde_json::Value::Null,
                Some(value) if value.is_string() => value.clone(),
                Some(_) => return Err(format!("待办 {} 的颜色格式无效", fallback_id)),
            };
            let mut note = serde_json::json!({
                "id": id,
                "title": title,
                "content": content,
                "isTodo": is_todo,
                "isCompleted": is_completed,
                "color": color,
                "priority": priority,
                "pinned": pinned,
                "tags": tags,
                "createdAt": created_at,
                "updatedAt": updated_at,
            });

            if let Some(group_value) = value
                .get("groupId")
                .or_else(|| value.get("group_id"))
                .filter(|value| !value.is_null())
            {
                let group_id = group_value
                    .as_str()
                    .ok_or_else(|| format!("待办 {} 的分组 ID 格式无效", fallback_id))?;
                note["groupId"] = serde_json::Value::String(group_id.to_string());
            }
            if let Some(completed_at) = value_i64_strict(
                &value,
                "completedAt",
                "completed_at",
                &format!("待办 {} 的完成时间", fallback_id),
            )? {
                let completed_at = normalize_remote_timestamp(
                    completed_at,
                    &format!("待办 {} 的完成时间", fallback_id),
                    false,
                )?;
                note["completedAt"] = serde_json::Value::Number(completed_at.into());
            }
            if let Some(deadline) = value_i64_strict(
                &value,
                "deadline",
                "deadline_at",
                &format!("待办 {} 的截止时间", fallback_id),
            )? {
                let deadline = normalize_remote_timestamp(
                    deadline,
                    &format!("待办 {} 的截止时间", fallback_id),
                    true,
                )?;
                note["deadline"] = serde_json::Value::Number(deadline.into());
            }
            note
        }
        ObjectKind::Group => {
            let created_at = normalize_remote_timestamp(
                value_i64_strict(
                    &value,
                    "createdAt",
                    "created_at",
                    &format!("分组 {} 的创建时间", fallback_id),
                )?
                .ok_or_else(|| format!("分组 {} 缺少创建时间", fallback_id))?,
                &format!("分组 {} 的创建时间", fallback_id),
                false,
            )?;
            let updated_at = normalize_remote_timestamp(
                value_i64_strict(
                    &value,
                    "updatedAt",
                    "updated_at",
                    &format!("分组 {} 的更新时间", fallback_id),
                )?
                .ok_or_else(|| format!("分组 {} 缺少更新时间", fallback_id))?,
                &format!("分组 {} 的更新时间", fallback_id),
                false,
            )?;
            let display_order = value_i64_strict(
                &value,
                "displayOrder",
                "display_order",
                &format!("分组 {} 的显示顺序", fallback_id),
            )?
            .unwrap_or(0);
            serde_json::json!({
                "id": id,
                // Local group writes trim names. Canonicalize remote names in
                // exactly the same way so harmless surrounding whitespace
                // cannot create a permanent equal-timestamp hash conflict.
                "name": value.get("name").and_then(serde_json::Value::as_str).map(str::trim).unwrap_or(""),
                "displayOrder": display_order,
                "createdAt": created_at,
                "updatedAt": updated_at,
            })
        }
    };

    serde_json::to_vec(&canonical).map_err(|error| error.to_string())
}

fn manifest_path(directory: &str) -> String {
    format!("{}/{}", directory, MANIFEST_FILE)
}

fn validate_object_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(format!("拒绝非法同步对象 ID: {id:?}"));
    }
    Ok(())
}

fn validate_manifest(manifest: &SyncManifest) -> Result<(), String> {
    if !(0..=MAX_TIMESTAMP_MS).contains(&manifest.updated_at) {
        return Err("同步索引的时间戳无效".to_string());
    }
    let object_count = manifest.notes.len().saturating_add(manifest.groups.len());
    if object_count > MAX_MANIFEST_OBJECTS {
        return Err(format!(
            "同步索引包含过多对象（{}，上限 {}）",
            object_count, MAX_MANIFEST_OBJECTS
        ));
    }
    if let Some(vault) = &manifest.vault {
        if vault.version != 1
            || vault.key_id.len() != 64
            || vault.salt.len() > 128
            || vault.nonce.len() > 128
            || vault.wrapped_key.len() > 256
        {
            return Err("同步索引中的密码保险库信息无效".to_string());
        }
        if !vault.key_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("同步索引中的密码保险库 ID 无效".to_string());
        }
    }
    for (kind, entries) in [
        (ObjectKind::Note, &manifest.notes),
        (ObjectKind::Group, &manifest.groups),
    ] {
        for (id, entry) in entries {
            validate_object_id(id)?;
            if !(0..=MAX_TIMESTAMP_MS).contains(&entry.updated_at)
                || entry
                    .deleted_at
                    .is_some_and(|value| !(0..=MAX_TIMESTAMP_MS).contains(&value))
            {
                return Err(format!("{} {} 的时间戳无效", kind.object_label(), id));
            }
            if entry.hash.len() > 128
                || (!entry.hash.is_empty()
                    && (entry.hash.len() != 64
                        || !entry.hash.bytes().all(|byte| byte.is_ascii_hexdigit())))
            {
                return Err(format!("{} {} 的哈希格式无效", kind.object_label(), id));
            }
            if entry.etag.as_ref().is_some_and(|etag| {
                etag.is_empty()
                    || etag.len() > 1024
                    || etag.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
            }) {
                return Err(format!("{} {} 的 ETag 过长", kind.object_label(), id));
            }
        }
    }
    Ok(())
}

fn object_path(base_directory: &str, id: &str) -> Result<String, String> {
    validate_object_id(id)?;
    Ok(format!("{}/{}.json", base_directory, id))
}

fn resolve_action(
    mode: SyncMode,
    local: Option<&LocalObject>,
    remote: Option<&ManifestEntry>,
) -> MergeAction {
    match mode {
        SyncMode::Push => resolve_push(local, remote),
        SyncMode::Pull => resolve_pull(local, remote),
        SyncMode::Bidirectional => resolve_bidirectional(local, remote),
    }
}

fn resolve_push(local: Option<&LocalObject>, remote: Option<&ManifestEntry>) -> MergeAction {
    let Some(local) = local else {
        // “上传”只推送本地已知变更，不删除其他设备独有的数据。
        return MergeAction::None;
    };

    if local.entry.is_deleted() {
        let local_deleted = local.entry.effective_timestamp();
        return match remote {
            Some(remote)
                if remote.is_deleted() && remote.effective_timestamp() >= local_deleted =>
            {
                MergeAction::None
            }
            Some(remote) if !remote.is_deleted() && remote.updated_at > local_deleted => {
                MergeAction::None
            }
            _ => MergeAction::DeleteRemote,
        };
    }

    match remote {
        None => MergeAction::Upload,
        Some(remote) if remote.is_deleted() => {
            if local.entry.updated_at > remote.effective_timestamp() {
                MergeAction::Upload
            } else {
                MergeAction::None
            }
        }
        Some(remote) => {
            if local.entry.updated_at > remote.updated_at
                || (local.entry.updated_at == remote.updated_at && local.entry.hash != remote.hash)
            {
                MergeAction::Upload
            } else {
                MergeAction::None
            }
        }
    }
}

fn resolve_pull(local: Option<&LocalObject>, remote: Option<&ManifestEntry>) -> MergeAction {
    let Some(remote) = remote else {
        return MergeAction::None;
    };

    if remote.is_deleted() {
        let remote_deleted = remote.effective_timestamp();
        return match local {
            None => MergeAction::DeleteLocal,
            Some(local) if local.entry.is_deleted() => {
                if remote_deleted > local.entry.effective_timestamp() {
                    MergeAction::DeleteLocal
                } else {
                    MergeAction::None
                }
            }
            Some(local) => {
                if remote_deleted >= local.entry.updated_at {
                    MergeAction::DeleteLocal
                } else {
                    MergeAction::None
                }
            }
        };
    }

    match local {
        None => MergeAction::Download,
        Some(local) if local.entry.is_deleted() => {
            if remote.updated_at > local.entry.effective_timestamp() {
                MergeAction::Download
            } else {
                MergeAction::None
            }
        }
        Some(local) => {
            if remote.updated_at > local.entry.updated_at
                || (remote.updated_at == local.entry.updated_at && remote.hash != local.entry.hash)
            {
                MergeAction::Download
            } else {
                MergeAction::None
            }
        }
    }
}

fn resolve_bidirectional(
    local: Option<&LocalObject>,
    remote: Option<&ManifestEntry>,
) -> MergeAction {
    match (local, remote) {
        (None, None) => MergeAction::None,
        (Some(local), None) => {
            if local.entry.is_deleted() {
                MergeAction::DeleteRemote
            } else {
                MergeAction::Upload
            }
        }
        (None, Some(remote)) => {
            if remote.is_deleted() {
                MergeAction::DeleteLocal
            } else {
                MergeAction::Download
            }
        }
        (Some(local), Some(remote)) => match (local.entry.is_deleted(), remote.is_deleted()) {
            (true, true) => {
                if local.entry.effective_timestamp() > remote.effective_timestamp() {
                    MergeAction::DeleteRemote
                } else if remote.effective_timestamp() > local.entry.effective_timestamp() {
                    MergeAction::DeleteLocal
                } else {
                    MergeAction::None
                }
            }
            (true, false) => {
                if local.entry.effective_timestamp() >= remote.updated_at {
                    if local.entry.effective_timestamp() == remote.updated_at {
                        MergeAction::Conflict
                    } else {
                        MergeAction::DeleteRemote
                    }
                } else {
                    MergeAction::Download
                }
            }
            (false, true) => {
                if local.entry.updated_at > remote.effective_timestamp() {
                    MergeAction::Upload
                } else if local.entry.updated_at == remote.effective_timestamp() {
                    MergeAction::Conflict
                } else {
                    MergeAction::DeleteLocal
                }
            }
            (false, false) => {
                if local.entry.updated_at > remote.updated_at {
                    MergeAction::Upload
                } else if remote.updated_at > local.entry.updated_at {
                    MergeAction::Download
                } else if local.entry.hash == remote.hash {
                    MergeAction::None
                } else {
                    MergeAction::Conflict
                }
            }
        },
    }
}

fn build_local_snapshot(state: &State<'_, AppState>) -> Result<LocalSnapshot, String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();
    let mut snapshot = LocalSnapshot::default();
    let note_tags = load_all_note_tags(&conn)?;

    {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, content, is_todo, is_completed, color, priority, pinned,
                        group_id, created_at, updated_at, completed_at, deadline
                 FROM notes",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)? != 0,
                    row.get::<_, i64>(4)? != 0,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)? != 0,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, Option<i64>>(11)?,
                    row.get::<_, Option<i64>>(12)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);

        for (
            id,
            title,
            content,
            is_todo,
            is_completed,
            color,
            priority,
            pinned,
            group_id,
            created_at,
            updated_at,
            completed_at,
            deadline,
        ) in rows
        {
            let tags = note_tags.get(&id).cloned().unwrap_or_default();
            let mut note = serde_json::json!({
                "id": id,
                "title": title,
                "content": content,
                "isTodo": is_todo,
                "isCompleted": is_completed,
                "color": color,
                "priority": priority,
                "pinned": pinned,
                "tags": tags,
                "createdAt": created_at,
                "updatedAt": updated_at,
            });
            if let Some(value) = group_id {
                note["groupId"] = serde_json::Value::String(value);
            }
            if let Some(value) = completed_at {
                note["completedAt"] = serde_json::Value::Number(value.into());
            }
            if let Some(value) = deadline {
                note["deadline"] = serde_json::Value::Number(value.into());
            }
            let data = serde_json::to_vec(&note).map_err(|error| error.to_string())?;
            snapshot
                .notes
                .insert(id.clone(), LocalObject::live(updated_at, data));
        }
    }

    {
        let mut stmt = conn
            .prepare("SELECT note_id, deleted_at FROM note_tombstones")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (id, deleted_at) = row.map_err(|e| e.to_string())?;
            let should_apply = snapshot
                .notes
                .get(&id)
                .map(|object| deleted_at >= object.entry.updated_at)
                .unwrap_or(true);
            if should_apply {
                snapshot.notes.insert(id, LocalObject::deleted(deleted_at));
            }
        }
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, display_order, created_at, updated_at, deleted_at
                 FROM groups",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let updated_at: i64 = row.get(4)?;
                let deleted_at: Option<i64> = row.get(5)?;

                if let Some(deleted_at) = deleted_at {
                    return Ok((id, LocalObject::deleted(deleted_at.max(updated_at))));
                }

                let group = serde_json::json!({
                    "id": id,
                    "name": row.get::<_, String>(1)?,
                    "displayOrder": row.get::<_, i64>(2)?,
                    "createdAt": row.get::<_, i64>(3)?,
                    "updatedAt": updated_at,
                });
                let data = serde_json::to_vec(&group)
                    .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
                Ok((id, LocalObject::live(updated_at, data)))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (id, object) = row.map_err(|e| e.to_string())?;
            snapshot.groups.insert(id, object);
        }
    }

    Ok(snapshot)
}

fn load_current_local_object(
    state: &State<'_, AppState>,
    kind: ObjectKind,
    id: &str,
) -> Result<Option<LocalObject>, String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();

    match kind {
        ObjectKind::Note => {
            let note = conn
                .query_row(
                    "SELECT id, title, content, is_todo, is_completed, color, priority, pinned,
                            group_id, created_at, updated_at, completed_at, deadline
                     FROM notes WHERE id = ?1",
                    [id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)? != 0,
                            row.get::<_, i64>(4)? != 0,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, i64>(6)?,
                            row.get::<_, i64>(7)? != 0,
                            row.get::<_, Option<String>>(8)?,
                            row.get::<_, i64>(9)?,
                            row.get::<_, i64>(10)?,
                            row.get::<_, Option<i64>>(11)?,
                            row.get::<_, Option<i64>>(12)?,
                        ))
                    },
                )
                .optional()
                .map_err(|error| error.to_string())?;

            let tombstone = conn
                .query_row(
                    "SELECT deleted_at FROM note_tombstones WHERE note_id = ?1",
                    [id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;

            if let Some((
                note_id,
                title,
                content,
                is_todo,
                is_completed,
                color,
                priority,
                pinned,
                group_id,
                created_at,
                updated_at,
                completed_at,
                deadline,
            )) = note
            {
                if let Some(deleted_at) = tombstone.filter(|value| *value >= updated_at) {
                    return Ok(Some(LocalObject::deleted(deleted_at)));
                }
                let mut value = serde_json::json!({
                    "id": note_id,
                    "title": title,
                    "content": content,
                    "isTodo": is_todo,
                    "isCompleted": is_completed,
                    "color": color,
                    "priority": priority,
                    "pinned": pinned,
                    "tags": load_note_tags(&conn, id)?,
                    "createdAt": created_at,
                    "updatedAt": updated_at,
                });
                if let Some(group_id) = group_id {
                    value["groupId"] = serde_json::Value::String(group_id);
                }
                if let Some(completed_at) = completed_at {
                    value["completedAt"] = serde_json::Value::Number(completed_at.into());
                }
                if let Some(deadline) = deadline {
                    value["deadline"] = serde_json::Value::Number(deadline.into());
                }
                let data = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
                return Ok(Some(LocalObject::live(updated_at, data)));
            }

            Ok(tombstone.map(LocalObject::deleted))
        }
        ObjectKind::Group => {
            let group = conn
                .query_row(
                    "SELECT id, name, display_order, created_at, updated_at, deleted_at
                     FROM groups WHERE id = ?1",
                    [id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, Option<i64>>(5)?,
                        ))
                    },
                )
                .optional()
                .map_err(|error| error.to_string())?;
            let Some((group_id, name, display_order, created_at, updated_at, deleted_at)) = group
            else {
                return Ok(None);
            };
            if let Some(deleted_at) = deleted_at {
                return Ok(Some(LocalObject::deleted(deleted_at.max(updated_at))));
            }
            let data = serde_json::to_vec(&serde_json::json!({
                "id": group_id,
                "name": name,
                "displayOrder": display_order,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }))
            .map_err(|error| error.to_string())?;
            Ok(Some(LocalObject::live(updated_at, data)))
        }
    }
}

fn ensure_local_snapshot_unchanged(
    state: &State<'_, AppState>,
    kind: ObjectKind,
    id: &str,
    expected: Option<&LocalObject>,
) -> Result<(), String> {
    let current = load_current_local_object(state, kind, id)?;
    let expected_entry = expected.map(|object| &object.entry);
    let current_entry = current.as_ref().map(|object| &object.entry);
    if expected_entry != current_entry {
        return Err(format!(
            "{}本地数据在同步期间发生变化，请重试",
            RETRY_SYNC_PREFIX
        ));
    }
    Ok(())
}

async fn load_remote_index(
    client: &WebDAVClient,
    directory: &str,
    notes_directory: &str,
    groups_directory: &str,
    budget: &mut TransferBudget,
    cancelled: &std::sync::atomic::AtomicBool,
) -> Result<RemoteIndex, String> {
    if cancelled.load(Ordering::SeqCst) {
        return Err("同步已取消".to_string());
    }
    let path = manifest_path(directory);
    if let Some(file) = client
        .download_optional_file_with_metadata(&path, MAX_MANIFEST_BYTES)
        .await
        .map_err(|e| format!("读取同步索引失败: {}", e))?
    {
        budget.charge(file.data.len(), "读取同步索引")?;
        let mut manifest: SyncManifest =
            serde_json::from_slice(&file.data).map_err(|e| format!("同步索引格式错误: {}", e))?;
        if manifest.version > MANIFEST_VERSION {
            return Err(format!(
                "同步索引版本 {} 高于当前支持版本 {}",
                manifest.version, MANIFEST_VERSION
            ));
        }
        let normalization = normalize_manifest_timestamps(&mut manifest)?;
        validate_manifest(&manifest)?;
        let mut cached_contents = HashMap::new();
        for (kind, id) in &normalization.rehash {
            if cancelled.load(Ordering::SeqCst) {
                return Err("同步已取消".to_string());
            }
            let object_directory = match kind {
                ObjectKind::Note => notes_directory,
                ObjectKind::Group => groups_directory,
            };
            let object_path = object_path(object_directory, id)?;
            let downloaded = client
                .download_optional_file_with_metadata(&object_path, crate::webdav::MAX_OBJECT_BYTES)
                .await
                .map_err(|error| {
                    format!("迁移{} {} 的时间戳失败: {}", kind.object_label(), id, error)
                })?
                .ok_or_else(|| {
                    format!("同步索引引用的远程{} {} 不存在", kind.object_label(), id)
                })?;
            budget.charge(downloaded.data.len(), "迁移远程对象")?;
            let data = canonicalize_object_data(*kind, id, &downloaded.data)?;
            let entries = match kind {
                ObjectKind::Note => &mut manifest.notes,
                ObjectKind::Group => &mut manifest.groups,
            };
            let entry = entries
                .get_mut(id)
                .ok_or_else(|| format!("同步索引缺少{} {}", kind.object_label(), id))?;
            verify_remote_revision_timestamp(*kind, id, entry, &data)?;
            entry.hash = hash_bytes(&data);
            if let Some(etag) = downloaded.etag.filter(|etag| !etag.is_empty()) {
                entry.etag = Some(etag);
            }
            cached_contents.insert((*kind, id.clone()), data);
        }
        return Ok(RemoteIndex {
            manifest,
            manifest_exists: true,
            manifest_etag: file.etag.filter(|etag| !etag.is_empty()),
            legacy_contents: cached_contents,
            needs_rewrite: normalization.changed,
        });
    }

    // 兼容旧版本：云端没有 manifest 时只在首次迁移读取旧的逐条 JSON。
    let mut index = RemoteIndex {
        manifest: SyncManifest::default(),
        manifest_exists: false,
        manifest_etag: None,
        legacy_contents: HashMap::new(),
        needs_rewrite: false,
    };

    let note_files = client
        .list_directory(notes_directory)
        .await
        .map_err(|e| format!("读取旧待办目录失败: {}", e))?;
    budget.charge(crate::webdav::MAX_DIRECTORY_LIST_BYTES, "读取旧待办目录")?;
    if note_files.len() > MAX_LEGACY_FILES {
        return Err("旧待办目录包含过多文件".to_string());
    }
    for filename in note_files {
        if cancelled.load(Ordering::SeqCst) {
            return Err("同步已取消".to_string());
        }
        let Some(stem) = filename.strip_suffix(".json") else {
            continue;
        };
        if validate_object_id(stem).is_err() {
            continue;
        }
        let path = format!("{}/{}", notes_directory, filename);
        let Some(data) = client
            .download_optional_file(&path)
            .await
            .map_err(|e| format!("迁移旧待办失败: {}", e))?
        else {
            continue;
        };
        budget.charge(data.len(), "迁移旧待办")?;
        let value: serde_json::Value = serde_json::from_slice(&data)
            .map_err(|error| format!("旧待办文件 {} 格式错误: {}", filename, error))?;
        let id = value
            .get("id")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| filename.trim_end_matches(".json").to_string());
        if id.is_empty() {
            continue;
        }
        validate_object_id(&id)?;
        let updated_at = value
            .get("updatedAt")
            .or_else(|| value.get("updated_at"))
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let updated_at = normalize_remote_timestamp(
            updated_at,
            &format!("旧待办文件 {} 的更新时间", filename),
            false,
        )?;
        let data = canonicalize_object_data(ObjectKind::Note, &id, &data)?;
        if index.manifest.notes.contains_key(&id) {
            return Err(format!("旧待办目录包含重复 ID: {id}"));
        }
        index.manifest.notes.insert(
            id.clone(),
            ManifestEntry::live(updated_at, hash_bytes(&data)),
        );
        index.legacy_contents.insert((ObjectKind::Note, id), data);
    }

    let group_files = client
        .list_directory(groups_directory)
        .await
        .map_err(|e| format!("读取旧分组目录失败: {}", e))?;
    budget.charge(crate::webdav::MAX_DIRECTORY_LIST_BYTES, "读取旧分组目录")?;
    if group_files.len() > MAX_LEGACY_FILES {
        return Err("旧分组目录包含过多文件".to_string());
    }
    for filename in group_files {
        if cancelled.load(Ordering::SeqCst) {
            return Err("同步已取消".to_string());
        }
        let Some(stem) = filename.strip_suffix(".json") else {
            continue;
        };
        if validate_object_id(stem).is_err() {
            continue;
        }
        let path = format!("{}/{}", groups_directory, filename);
        let Some(data) = client
            .download_optional_file(&path)
            .await
            .map_err(|e| format!("迁移旧分组失败: {}", e))?
        else {
            continue;
        };
        budget.charge(data.len(), "迁移旧分组")?;
        let value: serde_json::Value = serde_json::from_slice(&data)
            .map_err(|error| format!("旧分组文件 {} 格式错误: {}", filename, error))?;
        let id = value
            .get("id")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| filename.trim_end_matches(".json").to_string());
        if id.is_empty() {
            continue;
        }
        validate_object_id(&id)?;
        let updated_at = value
            .get("updatedAt")
            .or_else(|| value.get("updated_at"))
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let updated_at = normalize_remote_timestamp(
            updated_at,
            &format!("旧分组文件 {} 的更新时间", filename),
            false,
        )?;
        let deleted_at = value
            .get("deletedAt")
            .or_else(|| value.get("deleted_at"))
            .and_then(|value| value.as_i64())
            .map(|deleted_at| {
                normalize_remote_timestamp(
                    deleted_at,
                    &format!("旧分组文件 {} 的删除时间", filename),
                    false,
                )
            })
            .transpose()?;
        let (entry, cached_data) = if let Some(deleted_at) = deleted_at {
            (ManifestEntry::deleted(deleted_at), None)
        } else {
            let data = canonicalize_object_data(ObjectKind::Group, &id, &data)?;
            (
                ManifestEntry::live(updated_at, hash_bytes(&data)),
                Some(data),
            )
        };
        if index.manifest.groups.contains_key(&id) {
            return Err(format!("旧分组目录包含重复 ID: {id}"));
        }
        index.manifest.groups.insert(id.clone(), entry);
        if let Some(data) = cached_data {
            index.legacy_contents.insert((ObjectKind::Group, id), data);
        }
    }

    validate_manifest(&index.manifest)?;
    Ok(index)
}

fn verify_remote_revision_timestamp(
    kind: ObjectKind,
    id: &str,
    entry: &ManifestEntry,
    data: &[u8],
) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_slice(data)
        .map_err(|error| format!("解析{} {} 失败: {}", kind.object_label(), id, error))?;
    let object_updated_at = value
        .get("updatedAt")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| format!("远程{} {} 缺少更新时间", kind.object_label(), id))?;
    if object_updated_at != entry.updated_at {
        return Err(format!(
            "远程{} {} 的文件时间戳与同步索引不一致",
            kind.object_label(),
            id
        ));
    }
    Ok(())
}

fn verify_remote_data(
    kind: ObjectKind,
    id: &str,
    entry: &ManifestEntry,
    data: &[u8],
) -> Result<(), String> {
    verify_remote_revision_timestamp(kind, id, entry, data)?;
    if !entry.hash.is_empty() && hash_bytes(data) != entry.hash {
        return Err(format!("{} 的远程文件校验失败", id));
    }
    Ok(())
}

fn apply_remote_note(state: &State<'_, AppState>, id: &str, data: &[u8]) -> Result<bool, String> {
    let remote_note: serde_json::Value =
        serde_json::from_slice(data).map_err(|e| format!("解析待办 {} 失败: {}", id, e))?;
    let remote_id = remote_note
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or(id);
    if remote_id != id {
        return Err(format!("待办文件 {} 的 ID 不匹配", id));
    }

    let title = remote_note
        .get("title")
        .and_then(|value| value.as_str())
        .ok_or_else(|| format!("待办 {} 缺少有效标题", id))?;
    let content = remote_note
        .get("content")
        .and_then(|value| value.as_str())
        .ok_or_else(|| format!("待办 {} 缺少有效内容", id))?;
    if title.len() > MAX_TITLE_BYTES || content.len() > MAX_CONTENT_BYTES {
        return Err(format!("待办 {} 的文本超过大小限制", id));
    }
    if title.contains('\0') || content.contains('\0') {
        return Err(format!("待办 {} 的文本包含非法字符", id));
    }
    let is_todo = value_bool(&remote_note, "isTodo", "is_todo");
    let is_completed = value_bool(&remote_note, "isCompleted", "is_completed");
    let pinned = value_bool(&remote_note, "pinned", "pinned");
    let priority = remote_note
        .get("priority")
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    if !(0..=2).contains(&priority) {
        return Err(format!("待办 {} 的优先级无效", id));
    }
    let priority = i32::try_from(priority).map_err(|_| format!("待办 {} 的优先级无效", id))?;
    let tags = value_string_array(&remote_note, "tags", "tags");
    if tags.len() > MAX_TAGS
        || tags
            .iter()
            .any(|tag| tag.len() > MAX_TAG_BYTES || tag.contains('\0'))
    {
        return Err(format!("待办 {} 的标签超过限制", id));
    }
    let color = match remote_note.get("color") {
        None | Some(serde_json::Value::Null) => None,
        Some(value) => Some(
            value
                .as_str()
                .ok_or_else(|| format!("待办 {} 的颜色格式无效", id))?,
        ),
    };
    if color.is_some_and(|value| value.len() > MAX_COLOR_BYTES || value.contains('\0')) {
        return Err(format!("待办 {} 的颜色超过限制", id));
    }
    let remote_updated = remote_note
        .get("updatedAt")
        .or_else(|| remote_note.get("updated_at"))
        .and_then(|value| value.as_i64())
        .ok_or_else(|| format!("待办 {} 缺少更新时间", id))?;
    let created_at = remote_note
        .get("createdAt")
        .or_else(|| remote_note.get("created_at"))
        .and_then(|value| value.as_i64())
        .ok_or_else(|| format!("待办 {} 缺少创建时间", id))?;
    if !(0..=MAX_TIMESTAMP_MS).contains(&created_at)
        || !(0..=MAX_TIMESTAMP_MS).contains(&remote_updated)
    {
        return Err(format!("待办 {} 的时间戳无效", id));
    }
    if created_at > remote_updated {
        return Err(format!("待办 {} 的创建时间晚于更新时间", id));
    }
    let group_id = remote_note
        .get("groupId")
        .or_else(|| remote_note.get("group_id"))
        .and_then(|value| value.as_str());
    if let Some(group_id) = group_id {
        if group_id.trim().is_empty() {
            return Err(format!("待办 {} 的分组 ID 不能为空", id));
        }
        validate_object_id(group_id)?;
    }
    let completed_at = if is_completed {
        remote_note
            .get("completedAt")
            .or_else(|| remote_note.get("completed_at"))
            .and_then(|value| value.as_i64())
            .or(Some(remote_updated))
    } else {
        None
    };
    let deadline = remote_note
        .get("deadline")
        .or_else(|| remote_note.get("deadline_at"))
        .and_then(|value| value.as_i64());
    if completed_at.is_some_and(|value| !(0..=MAX_TIMESTAMP_MS).contains(&value))
        || deadline.is_some_and(|value| !(0..=MAX_TIMESTAMP_MS).contains(&value))
    {
        return Err(format!("待办 {} 的可选时间戳无效", id));
    }
    let (stored_title, migrated_plaintext_password) =
        crypto::normalize_remote_title(id, content, title)?;
    let stored_updated = if migrated_plaintext_password {
        chrono::Utc::now()
            .timestamp_millis()
            .max(remote_updated.saturating_add(1))
    } else {
        remote_updated
    };

    let conn = state.db.get_connection();
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if let Some(group_id) = group_id {
        let exists = tx
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM groups WHERE id = ?1 AND deleted_at IS NULL
                 )",
                [group_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| error.to_string())?;
        if !exists {
            return Err(format!("待办 {} 引用了不存在的分组 {}", id, group_id));
        }
    }
    if is_todo && title.trim().is_empty() && content.trim().is_empty() && !is_completed {
        let conflicting_blank = tx
            .query_row(
                "SELECT id FROM notes
                 WHERE id <> ?1 AND is_todo = 1 AND is_completed = 0
                   AND TRIM(title) = '' AND TRIM(content) = ''
                   AND COALESCE(group_id, '') = COALESCE(?2, '')
                 LIMIT 1",
                params![id, group_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(conflicting_id) = conflicting_blank {
            return Err(format!(
                "待办 {} 与本地空白待办 {} 冲突，请先编辑或删除其中一条",
                id, conflicting_id
            ));
        }
    }
    tx.execute(
        "INSERT INTO notes
         (id, title, content, is_todo, is_completed, color, priority, pinned, group_id,
          created_at, updated_at, completed_at, deadline)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           content = excluded.content,
           is_todo = excluded.is_todo,
           is_completed = excluded.is_completed,
           color = excluded.color,
           priority = excluded.priority,
           pinned = excluded.pinned,
           group_id = excluded.group_id,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           completed_at = excluded.completed_at,
           deadline = excluded.deadline",
        params![
            id,
            stored_title,
            content,
            if is_todo { 1 } else { 0 },
            if is_completed { 1 } else { 0 },
            color,
            priority,
            if pinned { 1 } else { 0 },
            group_id,
            created_at,
            stored_updated,
            completed_at,
            deadline,
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM note_tags WHERE note_id = ?1", [id])
        .map_err(|e| e.to_string())?;
    for tag_name in tags {
        let tag_id = tx
            .query_row("SELECT id FROM tags WHERE name = ?1", [&tag_name], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        tx.execute(
            "INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![&tag_id, &tag_name, chrono::Utc::now().timestamp_millis()],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
            params![id, &tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("DELETE FROM note_tombstones WHERE note_id = ?1", [id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(migrated_plaintext_password)
}

fn apply_remote_note_deletion(
    state: &State<'_, AppState>,
    id: &str,
    deleted_at: i64,
) -> Result<(), String> {
    let conn = state.db.get_connection();
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO note_tombstones (note_id, deleted_at)
         VALUES (?1, ?2)
         ON CONFLICT(note_id) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)",
        params![id, deleted_at],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM notes WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn apply_remote_group(state: &State<'_, AppState>, id: &str, data: &[u8]) -> Result<(), String> {
    let remote_group: serde_json::Value =
        serde_json::from_slice(data).map_err(|e| format!("解析分组 {} 失败: {}", id, e))?;
    let remote_id = remote_group
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or(id);
    if remote_id != id {
        return Err(format!("分组文件 {} 的 ID 不匹配", id));
    }
    let name = remote_group
        .get("name")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("分组 {} 缺少有效名称", id))?;
    if name.len() > MAX_GROUP_NAME_BYTES || name.contains('\0') {
        return Err(format!("分组 {} 的名称过长", id));
    }
    let display_order = remote_group
        .get("displayOrder")
        .or_else(|| remote_group.get("display_order"))
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    let created_at = remote_group
        .get("createdAt")
        .or_else(|| remote_group.get("created_at"))
        .and_then(|value| value.as_i64())
        .ok_or_else(|| format!("分组 {} 缺少创建时间", id))?;
    let updated_at = remote_group
        .get("updatedAt")
        .or_else(|| remote_group.get("updated_at"))
        .and_then(|value| value.as_i64())
        .ok_or_else(|| format!("分组 {} 缺少更新时间", id))?;
    if display_order < 0
        || display_order > i32::MAX as i64
        || !(0..=MAX_TIMESTAMP_MS).contains(&created_at)
        || !(0..=MAX_TIMESTAMP_MS).contains(&updated_at)
        || created_at > updated_at
    {
        return Err(format!("分组 {} 的数字字段无效", id));
    }

    let conn = state.db.get_connection();
    let conn = conn.lock();
    let duplicate = conn
        .query_row(
            "SELECT id FROM groups
             WHERE id <> ?1 AND name = ?2 AND deleted_at IS NULL
             LIMIT 1",
            params![id, name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(duplicate_id) = duplicate {
        return Err(format!(
            "远程分组 {} 与本地分组 {} 使用了相同名称“{}”，已停止合并",
            id, duplicate_id, name
        ));
    }
    conn.execute(
        "INSERT INTO groups
         (id, name, display_order, created_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           display_order = excluded.display_order,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           deleted_at = NULL",
        params![id, name, display_order, created_at, updated_at,],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn apply_remote_group_deletion(
    state: &State<'_, AppState>,
    id: &str,
    deleted_at: i64,
) -> Result<(), String> {
    let conn = state.db.get_connection();
    let mut conn = conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let changed = tx
        .execute(
            "UPDATE groups SET deleted_at = ?1, updated_at = MAX(updated_at, ?1)
             WHERE id = ?2",
            params![deleted_at, id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        tx.execute(
            "INSERT INTO groups
             (id, name, display_order, created_at, updated_at, deleted_at)
             VALUES (?1, '', 0, ?2, ?2, ?2)",
            params![id, deleted_at],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "UPDATE notes SET group_id = NULL, updated_at = MAX(
             CASE WHEN updated_at < 9223372036854775807 THEN updated_at + 1 ELSE updated_at END,
             ?1)
          WHERE group_id = ?2",
        params![deleted_at, id],
    )
    .map_err(|e| e.to_string())?;
    deduplicate_blank_drafts(&tx).map_err(|error| error.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

async fn get_remote_data(
    client: &WebDAVClient,
    kind: ObjectKind,
    directory: &str,
    id: &str,
    cache: &mut HashMap<(ObjectKind, String), Vec<u8>>,
    budget: &mut TransferBudget,
) -> Result<(Vec<u8>, Option<String>), String> {
    if let Some(data) = cache.remove(&(kind, id.to_string())) {
        return Ok((data, None));
    }
    let path = object_path(directory, id)?;
    let file = client
        .download_optional_file_with_metadata(&path, crate::webdav::MAX_OBJECT_BYTES)
        .await
        .map_err(|e| format!("下载{} {} 失败: {}", kind.object_label(), id, e))?
        .ok_or_else(|| format!("远程{} {} 不存在", kind.object_label(), id))?;
    budget.charge(
        file.data.len(),
        &format!("下载{} {}", kind.object_label(), id),
    )?;
    Ok((file.data, file.etag.filter(|etag| !etag.is_empty())))
}

struct CollectionContext<'a, 'state> {
    state: &'a State<'state, AppState>,
    client: &'a WebDAVClient,
    directory: &'a str,
    mode: SyncMode,
}

async fn process_collection(
    context: &CollectionContext<'_, '_>,
    kind: ObjectKind,
    local_objects: &BTreeMap<String, LocalObject>,
    remote_objects: &mut BTreeMap<String, ManifestEntry>,
    legacy_contents: &mut HashMap<(ObjectKind, String), Vec<u8>>,
    counts: &mut SyncCounts,
    budget: &mut TransferBudget,
) -> Result<bool, String> {
    let mut ids = BTreeSet::new();
    ids.extend(local_objects.keys().cloned());
    ids.extend(remote_objects.keys().cloned());
    let mut manifest_changed = false;

    for id in ids {
        validate_object_id(&id)?;
        if context.state.sync_cancelled.load(Ordering::SeqCst) {
            return Err("同步已取消".to_string());
        }
        let local = local_objects.get(&id).cloned();
        let remote = remote_objects.get(&id).cloned();
        let action = resolve_action(context.mode, local.as_ref(), remote.as_ref());

        match action {
            MergeAction::None => {}
            MergeAction::Upload => {
                let Some(local) = local.as_ref() else {
                    continue;
                };
                let Some(data) = local.data.as_ref() else {
                    continue;
                };
                {
                    let _write_guard = context.state.vault_lock.lock().await;
                    ensure_local_snapshot_unchanged(context.state, kind, &id, Some(local))?;
                }
                let object_path = object_path(context.directory, &id)?;
                let remote_is_live = remote.as_ref().is_some_and(|entry| !entry.is_deleted());
                let mut remote_etag = remote
                    .as_ref()
                    .filter(|entry| !entry.is_deleted())
                    .and_then(|entry| entry.etag.clone());
                if remote_is_live && remote_etag.is_none() {
                    let (etag, metadata_bytes) = context
                        .client
                        .file_etag_with_size(&object_path)
                        .await
                        .map_err(|error| {
                            format!(
                                "读取远程{} {} 元数据失败: {}",
                                kind.object_label(),
                                id,
                                error
                            )
                        })?;
                    budget.charge(
                        metadata_bytes,
                        &format!("读取远程{} {} 元数据", kind.object_label(), id),
                    )?;
                    remote_etag = etag;
                    if remote_etag.is_none() {
                        return Err(format!(
                            "无法安全上传{} {}：远程对象缺少 ETag",
                            kind.object_label(),
                            id
                        ));
                    }
                }
                budget.charge(data.len(), &format!("上传{} {}", kind.object_label(), id))?;
                let mut write_result = context
                    .client
                    .upload_file_conditionally(
                        &object_path,
                        data,
                        remote_etag.as_deref(),
                        !remote_is_live,
                    )
                    .await
                    .map_err(|e| format!("上传{} {} 失败: {}", kind.object_label(), id, e))?;
                if write_result == ConditionalWriteResult::PreconditionFailed {
                    // A previous attempt may already have written the object
                    // before losing the manifest race. Inspect the current
                    // object: matching local content is recoverable; matching
                    // manifest content can be retried with its fresh ETag;
                    // anything else is a real concurrent edit.
                    let current = context
                        .client
                        .download_optional_file_with_metadata(
                            &object_path,
                            crate::webdav::MAX_OBJECT_BYTES,
                        )
                        .await
                        .map_err(|error| {
                            format!(
                                "读取并发后的远程{} {} 失败: {}",
                                kind.object_label(),
                                id,
                                error
                            )
                        })?;
                    match current {
                        Some(file) => {
                            let current_data = canonicalize_object_data(kind, &id, &file.data)?;
                            let current_hash = hash_bytes(&current_data);
                            if current_hash == local.entry.hash {
                                write_result = ConditionalWriteResult::Written { etag: file.etag };
                            } else if remote_is_live
                                && remote
                                    .as_ref()
                                    .is_some_and(|entry| entry.hash == current_hash)
                            {
                                let etag = file.etag.ok_or_else(|| {
                                    format!(
                                        "无法安全重试上传{} {}：远程对象缺少 ETag",
                                        kind.object_label(),
                                        id
                                    )
                                })?;
                                budget.charge(
                                    data.len(),
                                    &format!("重试上传{} {}", kind.object_label(), id),
                                )?;
                                write_result = context
                                    .client
                                    .upload_file_conditionally(
                                        &object_path,
                                        data,
                                        Some(&etag),
                                        false,
                                    )
                                    .await
                                    .map_err(|error| {
                                        format!(
                                            "重试上传{} {} 失败: {}",
                                            kind.object_label(),
                                            id,
                                            error
                                        )
                                    })?;
                            } else {
                                return Err(format!(
                                    "检测到远程{} {} 的对象文件与 manifest 同时发生变化，已停止覆盖",
                                    kind.object_label(),
                                    id
                                ));
                            }
                        }
                        None if !remote_is_live => {
                            budget.charge(
                                data.len(),
                                &format!("重试创建{} {}", kind.object_label(), id),
                            )?;
                            write_result = context
                                .client
                                .upload_file_conditionally(&object_path, data, None, true)
                                .await
                                .map_err(|error| {
                                    format!(
                                        "重试创建{} {} 失败: {}",
                                        kind.object_label(),
                                        id,
                                        error
                                    )
                                })?;
                        }
                        None => {
                            return Err(format!(
                                "{}远程{} {} 在上传期间消失，请稍后重试",
                                RETRY_SYNC_PREFIX,
                                kind.object_label(),
                                id
                            ));
                        }
                    }
                }
                if write_result == ConditionalWriteResult::PreconditionFailed {
                    return Err(format!(
                        "{}{} {} 在上传期间再次发生变化，请稍后重试",
                        RETRY_SYNC_PREFIX,
                        kind.object_label(),
                        id
                    ));
                }
                {
                    let _write_guard = context.state.vault_lock.lock().await;
                    ensure_local_snapshot_unchanged(context.state, kind, &id, Some(local))?;
                }
                let mut uploaded_entry = local.entry.clone();
                if let ConditionalWriteResult::Written { etag } = write_result {
                    uploaded_entry.etag = etag;
                }
                if remote
                    .as_ref()
                    .map(|entry| !entry.same_revision(&uploaded_entry))
                    .unwrap_or(true)
                {
                    manifest_changed = true;
                }
                remote_objects.insert(id, uploaded_entry);
                counts.record_upload(kind);
            }
            MergeAction::DeleteRemote => {
                let Some(local) = local.as_ref() else {
                    continue;
                };
                {
                    let _write_guard = context.state.vault_lock.lock().await;
                    ensure_local_snapshot_unchanged(context.state, kind, &id, Some(local))?;
                }
                let Some(remote_entry) = remote.as_ref() else {
                    remote_objects.insert(id, local.entry.clone());
                    manifest_changed = true;
                    continue;
                };
                if remote_entry.is_deleted() {
                    if !remote_entry.same_revision(&local.entry) {
                        manifest_changed = true;
                    }
                    remote_objects.insert(id, local.entry.clone());
                    continue;
                }
                let object_path = object_path(context.directory, &id)?;
                let etag = match remote_entry.etag.clone() {
                    Some(etag) => etag,
                    None => {
                        let (etag, metadata_bytes) = context
                            .client
                            .file_etag_with_size(&object_path)
                            .await
                            .map_err(|error| {
                                format!(
                                    "读取远程{} {} 元数据失败: {}",
                                    kind.object_label(),
                                    id,
                                    error
                                )
                            })?;
                        budget.charge(
                            metadata_bytes,
                            &format!("读取远程{} {} 元数据", kind.object_label(), id),
                        )?;
                        match etag {
                            Some(etag) => etag,
                            None => {
                                remote_objects.insert(id, local.entry.clone());
                                manifest_changed = true;
                                counts.record_remote_delete(kind);
                                continue;
                            }
                        }
                    }
                };
                let mut delete_result = context
                    .client
                    .delete_file_conditionally(&object_path, Some(&etag))
                    .await
                    .map_err(|error| {
                        format!("删除云端{} {} 失败: {}", kind.object_label(), id, error)
                    })?;
                if delete_result == ConditionalDeleteResult::PreconditionFailed {
                    let current = context
                        .client
                        .download_optional_file_with_metadata(
                            &object_path,
                            crate::webdav::MAX_OBJECT_BYTES,
                        )
                        .await
                        .map_err(|error| {
                            format!(
                                "读取并发后的远程{} {} 失败: {}",
                                kind.object_label(),
                                id,
                                error
                            )
                        })?;
                    if let Some(file) = current {
                        let current_data = canonicalize_object_data(kind, &id, &file.data)?;
                        if hash_bytes(&current_data) != remote_entry.hash {
                            return Err(format!(
                                "检测到远程{} {} 在删除前已被修改，已停止删除",
                                kind.object_label(),
                                id
                            ));
                        }
                        let etag = file.etag.ok_or_else(|| {
                            format!(
                                "无法安全重试删除{} {}：远程对象缺少 ETag",
                                kind.object_label(),
                                id
                            )
                        })?;
                        delete_result = context
                            .client
                            .delete_file_conditionally(&object_path, Some(&etag))
                            .await
                            .map_err(|error| {
                                format!(
                                    "重试删除云端{} {} 失败: {}",
                                    kind.object_label(),
                                    id,
                                    error
                                )
                            })?;
                    } else {
                        delete_result = ConditionalDeleteResult::Deleted;
                    }
                }
                if delete_result == ConditionalDeleteResult::PreconditionFailed {
                    return Err(format!(
                        "{}删除云端{} {} 时再次发生并发变化，请稍后重试",
                        RETRY_SYNC_PREFIX,
                        kind.object_label(),
                        id
                    ));
                }
                {
                    let _write_guard = context.state.vault_lock.lock().await;
                    ensure_local_snapshot_unchanged(context.state, kind, &id, Some(local))?;
                }
                if !remote_entry.same_revision(&local.entry) {
                    manifest_changed = true;
                }
                remote_objects.insert(id, local.entry.clone());
                counts.record_remote_delete(kind);
            }
            MergeAction::Download => {
                let Some(remote) = remote.as_ref() else {
                    continue;
                };
                if remote.is_deleted() {
                    continue;
                }
                let (raw_data, object_etag) = get_remote_data(
                    context.client,
                    kind,
                    context.directory,
                    &id,
                    legacy_contents,
                    budget,
                )
                .await?;
                let data = canonicalize_object_data(kind, &id, &raw_data)?;
                verify_remote_data(kind, &id, remote, &data)?;
                let was_live = local
                    .as_ref()
                    .map(|object| !object.entry.is_deleted())
                    .unwrap_or(false);
                let (migrated_plaintext_password, migrated_local) = {
                    let _write_guard = context.state.vault_lock.lock().await;
                    ensure_local_snapshot_unchanged(context.state, kind, &id, local.as_ref())?;
                    let migrated_plaintext_password = match kind {
                        ObjectKind::Note => apply_remote_note(context.state, &id, &data)?,
                        ObjectKind::Group => {
                            apply_remote_group(context.state, &id, &data)?;
                            false
                        }
                    };
                    let migrated_local = if migrated_plaintext_password {
                        Some(
                            load_current_local_object(context.state, kind, &id)?.ok_or_else(
                                || format!("迁移后的{} {} 不存在", kind.object_label(), id),
                            )?,
                        )
                    } else {
                        None
                    };
                    (migrated_plaintext_password, migrated_local)
                };
                counts.record_download(kind, was_live);
                if let Some(current) = migrated_local {
                    let encrypted_data = current.data.as_deref().ok_or_else(|| {
                        format!("迁移后的{} {} 缺少内容", kind.object_label(), id)
                    })?;
                    let object_path = object_path(context.directory, &id)?;
                    let mut etag = object_etag.clone().or_else(|| remote.etag.clone());
                    if etag.is_none() {
                        let (fetched_etag, metadata_bytes) = context
                            .client
                            .file_etag_with_size(&object_path)
                            .await
                            .map_err(|error| {
                                format!(
                                    "读取远程{} {} 元数据失败: {}",
                                    kind.object_label(),
                                    id,
                                    error
                                )
                            })?;
                        budget.charge(
                            metadata_bytes,
                            &format!("读取远程{} {} 元数据", kind.object_label(), id),
                        )?;
                        etag = fetched_etag;
                    }
                    let etag = etag.ok_or_else(|| {
                        format!(
                            "无法安全迁移云端{} {}：远程对象缺少 ETag",
                            kind.object_label(),
                            id
                        )
                    })?;
                    budget.charge(
                        encrypted_data.len(),
                        &format!("加密迁移云端{} {}", kind.object_label(), id),
                    )?;
                    let write_result = context
                        .client
                        .upload_file_conditionally(&object_path, encrypted_data, Some(&etag), false)
                        .await
                        .map_err(|error| {
                            format!("加密迁移云端{} {} 失败: {}", kind.object_label(), id, error)
                        })?;
                    if write_result == ConditionalWriteResult::PreconditionFailed {
                        return Err(format!(
                            "{}加密迁移云端{} {} 时发生并发变化，请稍后重试",
                            RETRY_SYNC_PREFIX,
                            kind.object_label(),
                            id
                        ));
                    }
                    {
                        let _write_guard = context.state.vault_lock.lock().await;
                        ensure_local_snapshot_unchanged(context.state, kind, &id, Some(&current))?;
                    }
                    let mut migrated_entry = current.entry;
                    if let ConditionalWriteResult::Written { etag } = write_result {
                        migrated_entry.etag = etag;
                    }
                    remote_objects.insert(id.clone(), migrated_entry);
                    manifest_changed = true;
                    counts.record_upload(kind);
                }
                if remote.hash.is_empty() || (remote.etag.is_none() && object_etag.is_some()) {
                    let mut normalized = remote.clone();
                    if normalized.hash.is_empty() {
                        normalized.hash = hash_bytes(&data);
                    }
                    if normalized.etag.is_none() {
                        normalized.etag = object_etag;
                    }
                    if !migrated_plaintext_password {
                        remote_objects.insert(id, normalized);
                    }
                    manifest_changed = true;
                }
            }
            MergeAction::DeleteLocal => {
                let Some(remote) = remote.as_ref() else {
                    continue;
                };
                let deleted_at = remote.effective_timestamp();
                let was_live = local
                    .as_ref()
                    .map(|object| !object.entry.is_deleted())
                    .unwrap_or(false);
                {
                    let _write_guard = context.state.vault_lock.lock().await;
                    ensure_local_snapshot_unchanged(context.state, kind, &id, local.as_ref())?;
                    match kind {
                        ObjectKind::Note => {
                            apply_remote_note_deletion(context.state, &id, deleted_at)?
                        }
                        ObjectKind::Group => {
                            apply_remote_group_deletion(context.state, &id, deleted_at)?
                        }
                    }
                }
                counts.record_local_delete(kind, was_live);
            }
            MergeAction::Conflict => {
                return Err(format!(
                    "检测到{} {} 在本地和云端同时修改，已停止覆盖，请先选择保留本地或云端版本后再同步",
                    kind.object_label(),
                    id
                ));
            }
        }
    }

    Ok(manifest_changed)
}

async fn ensure_sync_directories(
    client: &WebDAVClient,
    directory: &str,
    notes_directory: &str,
    groups_directory: &str,
) -> Result<(), String> {
    client
        .create_directory(directory)
        .await
        .map_err(|e| format!("创建同步目录失败: {}", e))?;
    client
        .create_directory(notes_directory)
        .await
        .map_err(|e| format!("创建待办目录失败: {}", e))?;
    client
        .create_directory(groups_directory)
        .await
        .map_err(|e| format!("创建分组目录失败: {}", e))?;
    Ok(())
}

fn update_last_sync(state: &State<'_, AppState>, timestamp: i64) -> Result<(), String> {
    let conn = state.db.get_connection();
    let conn = conn.lock();
    conn.execute(
        "UPDATE webdav_config SET last_sync = ?1 WHERE id = 1",
        params![timestamp],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn append_result(parts: &mut Vec<String>, action: &str, count: usize, object: &str) {
    if count > 0 {
        parts.push(format!("{} {} 个{}", action, count, object));
    }
}

fn format_result(mode: SyncMode, counts: &SyncCounts, manifest_written: bool) -> String {
    let mut parts = Vec::new();
    append_result(&mut parts, "上传", counts.uploaded_groups, "分组");
    append_result(&mut parts, "下载", counts.downloaded_groups, "分组");
    append_result(&mut parts, "更新", counts.updated_groups, "分组");
    append_result(&mut parts, "删除云端", counts.deleted_remote_groups, "分组");
    append_result(&mut parts, "删除本地", counts.deleted_local_groups, "分组");
    append_result(&mut parts, "上传", counts.uploaded_notes, "待办");
    append_result(&mut parts, "下载", counts.downloaded_notes, "待办");
    append_result(&mut parts, "更新", counts.updated_notes, "待办");
    append_result(&mut parts, "删除云端", counts.deleted_remote_notes, "待办");
    append_result(&mut parts, "删除本地", counts.deleted_local_notes, "待办");

    let prefix = match mode {
        SyncMode::Bidirectional => "同步完成",
        SyncMode::Push => "上传完成",
        SyncMode::Pull => "下载完成",
    };
    if parts.is_empty() {
        if manifest_written {
            format!("{}，云端同步索引已更新", prefix)
        } else {
            match mode {
                SyncMode::Bidirectional => "无需同步，本地和云端已是最新".to_string(),
                SyncMode::Push => "无需上传，云端已是最新".to_string(),
                SyncMode::Pull => "无需下载，本地已是最新".to_string(),
            }
        }
    } else {
        format!("{} - {}", prefix, parts.join("，"))
    }
}

/// Load configuration after taking the sync lock so a concurrent settings
/// save cannot change the credential or directory halfway through a run.
pub async fn run_configured(state: &State<'_, AppState>, mode: SyncMode) -> Result<String, String> {
    let _guard = state
        .sync_lock
        .try_lock()
        .map_err(|_| "同步任务正在进行".to_string())?;
    let config = crate::sync::load_webdav_config_for_sync(state)?
        .ok_or_else(|| "WebDAV 未配置".to_string())?;
    run_loop(state, &config, mode).await
}

async fn run_loop(
    state: &State<'_, AppState>,
    config: &WebDAVSettings,
    mode: SyncMode,
) -> Result<String, String> {
    state.sync_cancelled.store(false, Ordering::SeqCst);
    for attempt in 0..3 {
        match run_once(state, config, mode).await {
            Ok(result) => return Ok(result),
            Err(error) if error.starts_with(RETRY_SYNC_PREFIX) && attempt < 2 => continue,
            Err(error) if error.starts_with(RETRY_SYNC_PREFIX) => {
                return Err(error.trim_start_matches(RETRY_SYNC_PREFIX).to_string());
            }
            Err(error) => return Err(error),
        }
    }
    Err("同步失败：超过最大重试次数".to_string())
}

async fn run_once(
    state: &State<'_, AppState>,
    config: &WebDAVSettings,
    mode: SyncMode,
) -> Result<String, String> {
    if !config.enabled {
        return Err("WebDAV 同步已禁用".to_string());
    }
    if config.password.is_empty() {
        return Err("WebDAV 密码未配置，无法同步密码保险库".to_string());
    }
    if config.username.trim().is_empty() {
        return Err("WebDAV 用户名不能为空".to_string());
    }

    let client = WebDAVClient::new(WebDAVConfig {
        url: config.url.clone(),
        username: config.username.clone(),
        password: config.password.clone(),
    })
    .map_err(|error| error.to_string())?;
    let directory = validate_directory(&config.directory)?;
    let notes_directory = format!("{}/notes", directory);
    let groups_directory = format!("{}/groups", directory);
    let mut transfer_budget = TransferBudget::default();
    let mut remote = load_remote_index(
        &client,
        &directory,
        &notes_directory,
        &groups_directory,
        &mut transfer_budget,
        state.sync_cancelled.as_ref(),
    )
    .await?;
    let (vault, vault_changed) = {
        let _vault_guard = state.vault_lock.lock().await;
        crypto::reconcile_vault(
            state.db.as_ref(),
            remote.manifest.vault.as_ref(),
            &config.password,
        )?
    };
    remote.manifest.vault = Some(vault);
    // 仅首次创建/迁移索引时建立目录；已有 manifest 的正常同步不再重复 MKCOL。
    if mode != SyncMode::Pull && !remote.manifest_exists {
        ensure_sync_directories(&client, &directory, &notes_directory, &groups_directory).await?;
    }

    let mut counts = SyncCounts::default();
    let mut manifest_changed = vault_changed || remote.needs_rewrite;
    // Apply groups first.  A remote group deletion can move notes to the
    // unclassified bucket; rebuilding the note snapshot afterwards ensures
    // those note changes are included in this same manifest update.
    let local = {
        let _snapshot_guard = state.vault_lock.lock().await;
        build_local_snapshot(state)?
    };
    let group_context = CollectionContext {
        state,
        client: &client,
        directory: &groups_directory,
        mode,
    };
    manifest_changed |= process_collection(
        &group_context,
        ObjectKind::Group,
        &local.groups,
        &mut remote.manifest.groups,
        &mut remote.legacy_contents,
        &mut counts,
        &mut transfer_budget,
    )
    .await?;
    let local = {
        let _snapshot_guard = state.vault_lock.lock().await;
        build_local_snapshot(state)?
    };
    let note_context = CollectionContext {
        state,
        client: &client,
        directory: &notes_directory,
        mode,
    };
    manifest_changed |= process_collection(
        &note_context,
        ObjectKind::Note,
        &local.notes,
        &mut remote.manifest.notes,
        &mut remote.legacy_contents,
        &mut counts,
        &mut transfer_budget,
    )
    .await?;
    // 即使首次执行的是“下载”且云端为空，也创建空 manifest；后续同步即可稳定为一次索引请求。
    let should_write_manifest = manifest_changed || !remote.manifest_exists;
    if should_write_manifest {
        if mode == SyncMode::Pull && !remote.manifest_exists {
            ensure_sync_directories(&client, &directory, &notes_directory, &groups_directory)
                .await?;
        }
        remote.manifest.version = MANIFEST_VERSION;
        // Validate the merged local/remote set as well.  The initial
        // validation only covered the downloaded manifest; without this
        // second check a local database with too many rows could generate an
        // oversized index and turn every later sync into a denial of service.
        validate_manifest(&remote.manifest)?;
        remote.manifest.updated_at = chrono::Utc::now()
            .timestamp_millis()
            .max(remote.manifest.updated_at.saturating_add(1));
        let data = serde_json::to_vec(&remote.manifest).map_err(|e| e.to_string())?;
        if data.len() > MAX_MANIFEST_BYTES {
            return Err("同步索引超过大小限制".to_string());
        }
        if remote.manifest_exists && remote.manifest_etag.is_none() {
            return Err(
                "云端同步索引没有 ETag，无法安全防止并发覆盖；请更换支持 ETag 的 WebDAV 服务"
                    .to_string(),
            );
        }
        transfer_budget.charge(data.len(), "上传同步索引")?;
        let write_result = client
            .upload_file_conditionally(
                &manifest_path(&directory),
                &data,
                remote.manifest_etag.as_deref(),
                !remote.manifest_exists,
            )
            .await
            .map_err(|e| format!("上传同步索引失败: {}", e))?;
        if write_result == ConditionalWriteResult::PreconditionFailed {
            return Err(format!(
                "{}云端同步索引在同步期间发生变化，请稍后重试",
                RETRY_SYNC_PREFIX
            ));
        }
    }

    update_last_sync(state, chrono::Utc::now().timestamp_millis())?;
    Ok(format_result(mode, &counts, should_write_manifest))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live(updated_at: i64, hash: &str) -> LocalObject {
        LocalObject {
            entry: ManifestEntry::live(updated_at, hash.to_string()),
            data: Some(Vec::new()),
        }
    }

    #[test]
    fn unchanged_items_are_not_transferred() {
        let local = live(10, "same");
        let remote = ManifestEntry::live(10, "same");
        assert_eq!(
            resolve_bidirectional(Some(&local), Some(&remote)),
            MergeAction::None
        );
    }

    #[test]
    fn newer_remote_item_is_downloaded() {
        let local = live(10, "local");
        let remote = ManifestEntry::live(11, "remote");
        assert_eq!(
            resolve_bidirectional(Some(&local), Some(&remote)),
            MergeAction::Download
        );
    }

    #[test]
    fn newer_local_item_is_uploaded() {
        let local = live(11, "local");
        let remote = ManifestEntry::live(10, "remote");
        assert_eq!(
            resolve_bidirectional(Some(&local), Some(&remote)),
            MergeAction::Upload
        );
    }

    #[test]
    fn newest_tombstone_wins() {
        let local = LocalObject::deleted(20);
        let remote = ManifestEntry::live(10, "remote");
        assert_eq!(
            resolve_bidirectional(Some(&local), Some(&remote)),
            MergeAction::DeleteRemote
        );
    }

    #[test]
    fn remote_tombstone_deletes_older_local_item() {
        let local = live(10, "local");
        let remote = ManifestEntry::deleted(20);
        assert_eq!(
            resolve_bidirectional(Some(&local), Some(&remote)),
            MergeAction::DeleteLocal
        );
    }

    #[test]
    fn push_does_not_overwrite_a_newer_remote_item() {
        let local = live(10, "local");
        let remote = ManifestEntry::live(20, "remote");
        assert_eq!(resolve_push(Some(&local), Some(&remote)), MergeAction::None);
    }

    #[test]
    fn legacy_group_is_hashed_with_current_schema_defaults() {
        let legacy = r#"{
            "id": "group-1",
            "name": "工作",
            "createdAt": 1,
            "updatedAt": 2
        }"#;
        let canonical =
            canonicalize_object_data(ObjectKind::Group, "group-1", legacy.as_bytes()).unwrap();
        let expected = serde_json::to_vec(&serde_json::json!({
            "id": "group-1",
            "name": "工作",
            "displayOrder": 0,
            "createdAt": 1000,
            "updatedAt": 2000,
        }))
        .unwrap();

        assert_eq!(canonical, expected);
        assert_eq!(hash_bytes(&canonical), hash_bytes(&expected));
    }

    #[test]
    fn legacy_seconds_are_normalized_and_far_future_revisions_are_rejected() {
        let (normalized, changed) =
            normalize_remote_timestamp_at(1_700_000_000, "测试时间", false, 1_800_000_000_000)
                .unwrap();
        assert_eq!(normalized, 1_700_000_000_000);
        assert!(changed);

        let future = 1_800_000_000_000_i64;
        assert!(
            normalize_remote_timestamp_at(future, "测试时间", false, 1_700_000_000_000).is_err()
        );
        assert!(normalize_remote_timestamp_at(future, "截止时间", true, 1_700_000_000_000).is_ok());
    }

    #[test]
    fn manifest_timestamp_migration_marks_live_objects_for_rehash() {
        let mut manifest = SyncManifest {
            version: MANIFEST_VERSION,
            updated_at: 2,
            notes: BTreeMap::from([("note-1".to_string(), ManifestEntry::live(1, "old-hash"))]),
            groups: BTreeMap::new(),
            vault: None,
        };
        let normalization = normalize_manifest_timestamps(&mut manifest).unwrap();
        assert!(normalization.changed);
        assert_eq!(manifest.updated_at, 2000);
        assert_eq!(manifest.notes["note-1"].updated_at, 1000);
        assert_eq!(
            normalization.rehash,
            vec![(ObjectKind::Note, "note-1".to_string())]
        );
    }

    #[test]
    fn group_name_whitespace_is_canonicalized_and_ids_are_checked() {
        let remote = serde_json::json!({
            "id": "group-1",
            "name": "  工作  ",
            "displayOrder": 0,
            "createdAt": 1,
            "updatedAt": 2,
        });
        let canonical = canonicalize_object_data(
            ObjectKind::Group,
            "group-1",
            &serde_json::to_vec(&remote).unwrap(),
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&canonical).unwrap();
        assert_eq!(value["name"], "工作");

        let mismatched = serde_json::json!({"id": "other", "name": "工作"});
        assert!(canonicalize_object_data(
            ObjectKind::Group,
            "group-1",
            &serde_json::to_vec(&mismatched).unwrap()
        )
        .is_err());
    }

    #[test]
    fn timestamps_beyond_javascript_date_range_are_rejected() {
        assert!(normalize_remote_timestamp_at(MAX_TIMESTAMP_MS + 1, "测试时间", true, 0).is_err());
    }
}
