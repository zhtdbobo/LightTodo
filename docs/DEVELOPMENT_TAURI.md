# LightTodo - Tauri 开发说明书

## 项目概述

LightTodo 是一个基于 Tauri + React 构建的轻量级跨平台便签工具，支持 WebDAV 同步。

## 技术架构

### 核心技术栈

**前端**
- **框架**: React 18 + TypeScript
- **构建工具**: Vite 5
- **状态管理**: Zustand 4.x（轻量、简单）
- **路由**: React Router v6
- **UI 框架**: Tailwind CSS + shadcn/ui
- **HTTP 客户端**: Tauri 的 `@tauri-apps/api`

**后端 (Rust)**
- **框架**: Tauri 2.x
- **数据库**: rusqlite（SQLite）
- **WebDAV**: reqwest (HTTP) + roxmltree (XML 解析)
- **序列化**: serde + serde_json
- **日期时间**: chrono
- **UUID**: uuid

### 项目结构

```
LightTodo/
├── src/                      # 前端代码
│   ├── main.tsx              # React 入口
│   ├── App.tsx               # 根组件
│   ├── features/             # 功能模块
│   │   ├── notes/            # 便签功能
│   │   │   ├── components/   # React 组件
│   │   │   ├── hooks/        # 自定义 Hooks
│   │   │   ├── stores/       # Zustand stores
│   │   │   └── types.ts      # TypeScript 类型
│   │   ├── sync/             # 同步功能
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── stores/
│   │   └── settings/         # 设置功能
│   │       ├── components/
│   │       └── stores/
│   ├── shared/               # 共享模块
│   │   ├── components/       # 通用 UI 组件
│   │   ├── hooks/            # 通用 Hooks
│   │   └── utils/            # 工具函数
│   └── styles/               # 全局样式
│       └── globals.css
├── src-tauri/                # Rust 后端代码
│   ├── src/
│   │   ├── main.rs           # Tauri 应用入口
│   │   ├── commands/         # Tauri Commands（前端调用）
│   │   │   ├── mod.rs
│   │   │   ├── notes.rs      # 便签相关命令
│   │   │   ├── sync.rs       # 同步相关命令
│   │   │   └── settings.rs   # 设置相关命令
│   │   ├── database/         # 数据库模块
│   │   │   ├── mod.rs
│   │   │   ├── schema.rs     # 数据库 schema
│   │   │   └── connection.rs # 连接管理
│   │   ├── models/           # 数据模型
│   │   │   ├── mod.rs
│   │   │   ├── note.rs
│   │   │   └── tag.rs
│   │   ├── sync/             # WebDAV 同步
│   │   │   ├── mod.rs
│   │   │   ├── client.rs     # WebDAV 客户端
│   │   │   └── conflict.rs   # 冲突处理
│   │   └── utils/            # 工具函数
│   │       └── mod.rs
│   ├── Cargo.toml            # Rust 依赖
│   ├── tauri.conf.json       # Tauri 配置
│   └── icons/                # 应用图标
├── public/                   # 静态资源
├── index.html                # HTML 入口
├── package.json              # Node.js 依赖
├── tsconfig.json             # TypeScript 配置
├── tailwind.config.js        # Tailwind 配置
└── vite.config.ts            # Vite 配置
```

## 数据库设计

### 表结构

#### notes 表
```sql
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    is_todo INTEGER NOT NULL DEFAULT 0,
    is_completed INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    synced_at INTEGER
);

CREATE INDEX idx_notes_pinned ON notes(pinned);
CREATE INDEX idx_notes_updated_at ON notes(updated_at);
```

#### tags 表
```sql
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_tags_name ON tags(name);
```

#### note_tags 表（多对多关系）
```sql
CREATE TABLE IF NOT EXISTS note_tags (
    note_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (note_id, tag_id),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX idx_note_tags_note_id ON note_tags(note_id);
CREATE INDEX idx_note_tags_tag_id ON note_tags(tag_id);
```

#### sync_queue 表
```sql
CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL,
    action TEXT NOT NULL, -- 'create', 'update', 'delete'
    timestamp INTEGER NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_sync_queue_synced ON sync_queue(synced);
```

### Rust 数据模型

```rust
// src-tauri/src/models/note.rs
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
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub synced_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateNoteInput {
    pub title: String,
    pub content: String,
    pub is_todo: bool,
    pub tags: Vec<String>,
    pub color: Option<String>,
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
    pub tags: Option<Vec<String>>,
}
```

### TypeScript 类型定义

```typescript
// src/features/notes/types.ts
export interface Note {
  id: string;
  title: string;
  content: string;
  isTodo: boolean;
  isCompleted: boolean;
  color?: string;
  pinned: boolean;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;
}

export interface CreateNoteInput {
  title: string;
  content: string;
  isTodo: boolean;
  tags: string[];
  color?: string;
}

export interface UpdateNoteInput {
  id: string;
  title?: string;
  content?: string;
  isTodo?: boolean;
  isCompleted?: boolean;
  color?: string;
  pinned?: boolean;
  tags?: string[];
}
```

## Tauri Commands（前后端通信）

### 便签相关命令

```rust
// src-tauri/src/commands/notes.rs

#[tauri::command]
pub async fn get_all_notes(state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    // 从数据库获取所有便签
}

#[tauri::command]
pub async fn get_note_by_id(id: String, state: State<'_, AppState>) -> Result<Option<Note>, String> {
    // 根据 ID 获取便签
}

#[tauri::command]
pub async fn create_note(input: CreateNoteInput, state: State<'_, AppState>) -> Result<Note, String> {
    // 创建新便签
}

#[tauri::command]
pub async fn update_note(input: UpdateNoteInput, state: State<'_, AppState>) -> Result<Note, String> {
    // 更新便签
}

#[tauri::command]
pub async fn delete_note(id: String, state: State<'_, AppState>) -> Result<(), String> {
    // 删除便签
}

#[tauri::command]
pub async fn search_notes(query: String, state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    // 搜索便签
}
```

### 前端调用示例

```typescript
// src/features/notes/hooks/useNotes.ts
import { invoke } from '@tauri-apps/api/core';
import type { Note, CreateNoteInput, UpdateNoteInput } from '../types';

export function useNotes() {
  const getAllNotes = async (): Promise<Note[]> => {
    return await invoke('get_all_notes');
  };

  const createNote = async (input: CreateNoteInput): Promise<Note> => {
    return await invoke('create_note', { input });
  };

  const updateNote = async (input: UpdateNoteInput): Promise<Note> => {
    return await invoke('update_note', { input });
  };

  const deleteNote = async (id: string): Promise<void> => {
    await invoke('delete_note', { id });
  };

  const searchNotes = async (query: string): Promise<Note[]> => {
    return await invoke('search_notes', { query });
  };

  return {
    getAllNotes,
    createNote,
    updateNote,
    deleteNote,
    searchNotes,
  };
}
```

## WebDAV 同步实现

### Rust WebDAV 客户端

```rust
// src-tauri/src/sync/client.rs
use reqwest::{Client, StatusCode};
use roxmltree::Document;

pub struct WebDavClient {
    client: Client,
    base_url: String,
    username: String,
    password: String,
}

impl WebDavClient {
    pub fn new(base_url: String, username: String, password: String) -> Self {
        Self {
            client: Client::new(),
            base_url,
            username,
            password,
        }
    }

    // PROPFIND - 列出远程文件
    pub async fn list_files(&self, path: &str) -> Result<Vec<RemoteFile>, Box<dyn std::error::Error>> {
        // 实现 PROPFIND 请求
    }

    // GET - 下载文件
    pub async fn download_file(&self, path: &str) -> Result<String, Box<dyn std::error::Error>> {
        // 实现 GET 请求
    }

    // PUT - 上传文件
    pub async fn upload_file(&self, path: &str, content: &str) -> Result<(), Box<dyn std::error::Error>> {
        // 实现 PUT 请求
    }

    // DELETE - 删除文件
    pub async fn delete_file(&self, path: &str) -> Result<(), Box<dyn std::error::Error>> {
        // 实现 DELETE 请求
    }
}
```

### 同步流程

```rust
// src-tauri/src/commands/sync.rs

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> Result<SyncResult, String> {
    // 1. 读取 WebDAV 配置
    // 2. 创建 WebDAV 客户端
    // 3. 上传本地修改（从 sync_queue）
    // 4. 下载远程修改
    // 5. 检测并处理冲突
    // 6. 更新本地数据库
    // 7. 返回同步结果
}
```

## 状态管理（Zustand）

```typescript
// src/features/notes/stores/notesStore.ts
import { create } from 'zustand';
import type { Note } from '../types';

interface NotesState {
  notes: Note[];
  loading: boolean;
  selectedNote: Note | null;
  searchQuery: string;
  filterTags: string[];
  
  setNotes: (notes: Note[]) => void;
  addNote: (note: Note) => void;
  updateNote: (note: Note) => void;
  removeNote: (id: string) => void;
  setSelectedNote: (note: Note | null) => void;
  setSearchQuery: (query: string) => void;
  setFilterTags: (tags: string[]) => void;
}

export const useNotesStore = create<NotesState>((set) => ({
  notes: [],
  loading: false,
  selectedNote: null,
  searchQuery: '',
  filterTags: [],
  
  setNotes: (notes) => set({ notes }),
  addNote: (note) => set((state) => ({ notes: [note, ...state.notes] })),
  updateNote: (note) => set((state) => ({
    notes: state.notes.map((n) => (n.id === note.id ? note : n)),
  })),
  removeNote: (id) => set((state) => ({
    notes: state.notes.filter((n) => n.id !== id),
  })),
  setSelectedNote: (note) => set({ selectedNote: note }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilterTags: (tags) => set({ filterTags: tags }),
}));
```

## UI 组件示例

### 便签卡片组件

```typescript
// src/features/notes/components/NoteCard.tsx
import { Note } from '../types';

interface NoteCardProps {
  note: Note;
  onClick: () => void;
  onDelete: () => void;
  onTogglePinned: () => void;
}

export function NoteCard({ note, onClick, onDelete, onTogglePinned }: NoteCardProps) {
  return (
    <div
      className="rounded-lg p-4 cursor-pointer hover:shadow-lg transition"
      style={{ backgroundColor: note.color || '#FFFFFF' }}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {note.isTodo && (
            <input
              type="checkbox"
              checked={note.isCompleted}
              onClick={(e) => e.stopPropagation()}
              className="w-4 h-4"
            />
          )}
          <h3 className="font-semibold text-lg">{note.title}</h3>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onTogglePinned(); }}>
          {note.pinned ? '📌' : '📍'}
        </button>
      </div>
      
      <p className="text-sm text-gray-600 line-clamp-3 mb-3">
        {note.content}
      </p>
      
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {note.tags.map((tag) => (
            <span key={tag} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
              {tag}
            </span>
          ))}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-red-500 hover:text-red-700"
        >
          🗑️
        </button>
      </div>
    </div>
  );
}
```

## 依赖包

### package.json

```json
{
  "name": "lighttodo",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "zustand": "^4.5.5",
    "@tauri-apps/api": "^2.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.3",
    "tailwindcss": "^3.4.10",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.45"
  }
}
```

### Cargo.toml

```toml
[package]
name = "lighttodo"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2.0", features = ["devtools"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
rusqlite = { version = "0.32", features = ["bundled"] }
uuid = { version = "1.10", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
reqwest = { version = "0.12", features = ["blocking"] }
roxmltree = "0.20"
tokio = { version = "1", features = ["full"] }

[build-dependencies]
tauri-build = { version = "2.0" }
```

## 数据存储位置

Tauri 自动选择合适的数据目录：

- **Windows**: `C:\Users\<用户名>\AppData\Roaming\com.lighttodo.app\`
- **macOS**: `~/Library/Application Support/com.lighttodo.app/`
- **Linux**: `~/.local/share/lighttodo/`

数据库文件：`notes.db`

## 性能优化

1. **数据库索引** - 已在 schema 中定义
2. **虚拟滚动** - 列表使用 `react-window` 或 `@tanstack/react-virtual`
3. **防抖搜索** - 搜索输入延迟 300ms
4. **懒加载** - 大量便签时分页加载
5. **异步操作** - 所有 Tauri commands 都是异步的

## 开发命令

```bash
# 开发模式（热重载）
npm run tauri dev

# 生产构建
npm run tauri build

# 仅构建前端
npm run build

# 类型检查
tsc --noEmit
```

## 打包产物

运行 `npm run tauri build` 后，产物在：

- **Windows**: `src-tauri/target/release/bundle/nsis/LightTodo_0.1.0_x64-setup.exe` (~3-5 MB)
- **macOS**: `src-tauri/target/release/bundle/dmg/LightTodo_0.1.0_x64.dmg`
- **Linux**: `src-tauri/target/release/bundle/deb/lighttodo_0.1.0_amd64.deb`

---

**文档版本**: v1.0  
**最后更新**: 2026-06-29  
**技术栈**: Tauri + React + Rust
