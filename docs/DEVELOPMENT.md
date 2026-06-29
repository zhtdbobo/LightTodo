# LightTodo - Flutter 开发说明书

## 项目概述

LightTodo 是一个基于 Flutter 构建的轻量级跨平台便签工具，支持 WebDAV 同步。

## 技术架构

### 核心技术栈

- **框架**: Flutter 3.24+
- **语言**: Dart 3.5+
- **状态管理**: Riverpod 2.x（轻量、类型安全）
- **本地数据库**: Drift (sqflite) - Flutter 最佳 SQLite 解决方案
- **WebDAV**: http + xml 包实现
- **路由**: go_router
- **UI**: Material Design 3 + 自定义组件

### 项目结构

```
lib/
├── main.dart                 # 应用入口
├── app/
│   ├── app.dart             # App 配置
│   └── router.dart          # 路由配置
├── features/                # 功能模块
│   ├── notes/               # 便签功能
│   │   ├── models/          # 数据模型
│   │   ├── providers/       # 状态管理
│   │   ├── repositories/    # 数据仓库
│   │   ├── services/        # 业务逻辑
│   │   └── widgets/         # UI 组件
│   ├── sync/                # 同步功能
│   │   ├── models/
│   │   ├── providers/
│   │   ├── services/
│   │   └── widgets/
│   └── settings/            # 设置功能
│       ├── models/
│       ├── providers/
│       └── widgets/
├── shared/                  # 共享模块
│   ├── database/            # 数据库配置
│   ├── utils/               # 工具函数
│   ├── widgets/             # 通用组件
│   └── theme/               # 主题配置
└── core/                    # 核心模块
    ├── constants/           # 常量
    └── extensions/          # 扩展方法
```

## 数据库设计

### 表结构

#### notes 表
```sql
CREATE TABLE notes (
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
```

#### tags 表
```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
```

#### note_tags 表（多对多关系）
```sql
CREATE TABLE note_tags (
  note_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (note_id, tag_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

#### sync_queue 表（同步队列）
```sql
CREATE TABLE sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'create', 'update', 'delete'
  timestamp INTEGER NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0
);
```

### 数据模型

```dart
class Note {
  final String id;
  final String title;
  final String content;
  final bool isTodo;
  final bool isCompleted;
  final String? color;
  final bool pinned;
  final List<String> tags;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? syncedAt;
}
```

## WebDAV 同步方案

### 同步流程

1. **上传流程**
   - 检测本地修改（通过 `sync_queue` 表）
   - 将便签序列化为 JSON
   - PUT 到 WebDAV 服务器：`/LightTodo/notes/{note_id}.json`
   - 更新 `synced_at` 字段
   - 清除同步队列

2. **下载流程**
   - PROPFIND 获取远程文件列表
   - 对比本地 `synced_at` 和远程 `getlastmodified`
   - GET 下载更新的文件
   - 合并到本地数据库

3. **冲突处理**
   - 如果 `local_updated_at > remote_modified_at > local_synced_at`
   - 创建冲突副本：原标题 + " (冲突副本)"
   - 保留两个版本供用户选择

### WebDAV 文件结构

```
/LightTodo/
├── notes/
│   ├── {uuid-1}.json
│   ├── {uuid-2}.json
│   └── ...
└── manifest.json          # 元数据清单（可选）
```

### JSON 格式

```json
{
  "id": "uuid-v4",
  "title": "便签标题",
  "content": "便签内容",
  "isTodo": true,
  "isCompleted": false,
  "tags": ["工作", "重要"],
  "color": "#FFD700",
  "pinned": false,
  "createdAt": "2026-06-29T10:00:00Z",
  "updatedAt": "2026-06-29T12:00:00Z"
}
```

## 核心功能实现

### 1. 便签 CRUD

```dart
// Repository 层
class NotesRepository {
  Future<List<Note>> getAllNotes();
  Future<Note?> getNoteById(String id);
  Future<void> createNote(Note note);
  Future<void> updateNote(Note note);
  Future<void> deleteNote(String id);
  Future<List<Note>> searchNotes(String query);
  Stream<List<Note>> watchAllNotes();
}
```

### 2. 自动保存

- 使用 `debounce` 延迟 500ms 保存
- 编辑时实时更新内存状态
- 防抖后触发数据库写入

### 3. 搜索功能

```sql
SELECT * FROM notes 
WHERE title LIKE ? OR content LIKE ?
ORDER BY pinned DESC, updated_at DESC;
```

### 4. 标签系统

- 标签输入框支持自动补全
- 点击标签筛选便签
- 支持多标签筛选（AND/OR 逻辑可配置）

### 5. 同步服务

```dart
class SyncService {
  Future<SyncResult> syncNow();
  Future<void> enableAutoSync();
  Future<void> disableAutoSync();
  Stream<SyncStatus> get syncStatusStream;
}
```

## UI/UX 设计

### 主界面布局

```
┌─────────────────────────────────────┐
│  LightTodo        🔍 搜索   ⚙️ 设置  │
├─────────────────────────────────────┤
│  📌 置顶便签                         │
│  ┌───────────────┐ ┌───────────────┐│
│  │ 📝 会议纪要    │ │ ✅ 买菜清单   ││
│  │ #工作         │ │ [✓] 西红柿    ││
│  │ 今天的会议... │ │ [✓] 鸡蛋      ││
│  │ 2小时前       │ │ [ ] 牛奶      ││
│  └───────────────┘ └───────────────┘│
│                                     │
│  📝 所有便签                         │
│  ┌───────────────┐ ┌───────────────┐│
│  │ 📖 读书笔记    │ │ 💡 想法       ││
│  │ #学习         │ │ #创意         ││
│  │ ...           │ │ ...           ││
│  └───────────────┘ └───────────────┘│
│                                     │
│           [+] 新建便签               │
└─────────────────────────────────────┘
```

### 编辑界面

```
┌─────────────────────────────────────┐
│  ← 返回          ⋮ 更多    🗑️ 删除  │
├─────────────────────────────────────┤
│  📌 [置顶] ✅ [Todo] 🎨 [颜色]       │
├─────────────────────────────────────┤
│  标题输入框                          │
├─────────────────────────────────────┤
│  正文输入框                          │
│  (多行)                             │
│                                     │
│                                     │
├─────────────────────────────────────┤
│  🏷️ 标签: [工作] [重要] + 添加      │
└─────────────────────────────────────┘
```

### 颜色方案

```dart
// 便签颜色预设
const noteColors = [
  null,           // 默认（跟随主题）
  '#FFD700',      // 金黄
  '#FF6B6B',      // 红色
  '#4ECDC4',      // 青色
  '#95E1D3',      // 薄荷绿
  '#F38181',      // 粉红
  '#AA96DA',      // 紫色
  '#FCBAD3',      // 樱花粉
];
```

## 性能优化

1. **数据库索引**
   ```sql
   CREATE INDEX idx_notes_pinned ON notes(pinned);
   CREATE INDEX idx_notes_updated_at ON notes(updated_at);
   CREATE INDEX idx_note_tags_note_id ON note_tags(note_id);
   CREATE INDEX idx_note_tags_tag_id ON note_tags(tag_id);
   ```

2. **懒加载**
   - 使用 `ListView.builder` 构建列表
   - 分页加载（每页 50 条）

3. **缓存策略**
   - 使用 Riverpod 缓存常用数据
   - 搜索结果缓存 30 秒

4. **同步优化**
   - 增量同步，只传输变更
   - 使用 `Isolate` 在后台处理同步逻辑

## 依赖包列表

```yaml
dependencies:
  flutter:
    sdk: flutter
  
  # 状态管理
  flutter_riverpod: ^2.5.0
  riverpod_annotation: ^2.3.0
  
  # 数据库
  drift: ^2.18.0
  sqlite3_flutter_libs: ^0.5.24
  path_provider: ^2.1.3
  path: ^1.9.0
  
  # WebDAV 同步
  http: ^1.2.1
  xml: ^6.5.0
  
  # 路由
  go_router: ^14.1.4
  
  # UI
  flutter_staggered_grid_view: ^0.7.0
  
  # 工具
  uuid: ^4.4.0
  intl: ^0.19.0
  shared_preferences: ^2.2.3
  
dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0
  
  # 代码生成
  build_runner: ^2.4.9
  riverpod_generator: ^2.4.0
  drift_dev: ^2.18.0
```

## 开发工具

- **IDE**: VS Code / Android Studio
- **插件**:
  - Flutter
  - Dart
  - Flutter Riverpod Snippets
- **调试**: Flutter DevTools
- **版本控制**: Git

## 测试策略

### 单元测试
- 数据模型序列化/反序列化
- Repository 层 CRUD 操作
- WebDAV 客户端功能

### Widget 测试
- 便签卡片组件
- 编辑器组件
- 搜索功能

### 集成测试
- 创建便签流程
- 同步流程
- 冲突处理

## 打包发布

### Windows
```bash
flutter build windows --release
```

### macOS
```bash
flutter build macos --release
```

### Linux
```bash
flutter build linux --release
```

### 安装包体积预估
- Windows: ~18 MB
- macOS: ~20 MB
- Linux: ~22 MB

## 常见问题

### Q: 如何处理大量便签的性能问题？
A: 使用虚拟滚动 + 分页加载 + 数据库索引优化

### Q: WebDAV 同步失败怎么办？
A: 记录到同步队列，下次联网时自动重试

### Q: 如何保证数据不丢失？
A: 本地 SQLite + 定期 WebDAV 备份 + 导出 JSON 功能

### Q: 支持哪些 WebDAV 服务？
A: 所有标准 WebDAV 服务（Nextcloud、坚果云、Synology 等）

## 后续扩展方向

1. **移动端适配** - 同一套代码编译到 iOS/Android
2. **Web 版本** - 编译为 PWA
3. **Markdown 支持** - 集成 `flutter_markdown`
4. **图片附件** - 支持图片上传和显示
5. **端到端加密** - 敏感便签加密存储

---

**文档版本**: v1.0  
**最后更新**: 2026-06-29  
**维护者**: jaridli
