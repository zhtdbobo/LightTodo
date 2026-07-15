# LightTodo

一个轻量级、支持 WebDAV 同步的待办事项应用

## ✨ 特性

- 🪶 **极致轻量** - Tauri 架构，安装包仅 3-5 MB，内存占用低
- ✅ **待办管理** - 创建、编辑、删除待办，支持完成状态切换
- 📝 **多行支持** - 待办内容支持多行输入（Shift+Enter 换行）
- 🎯 **优先级** - 三级优先级标记（高🔴、中🟡、低⚪）
- 📁 **自定义分组** - 创建、重命名、删除分组，待办可移动到不同分组
- ⏰ **截止时间** - 设置 deadline 后自动进入“今日”，并按小时显示逾期时间
- 🖥️ **窗口置顶** - 小窗口始终在最前，方便随时查看
- 🗂️ **系统托盘** - 隐藏到托盘运行，右键菜单快速操作
- ☁️ **WebDAV 同步** - 支持坚果云、Nextcloud 等 WebDAV 云存储同步
- 🔄 **智能同步** - 双向同步、上传、下载三种模式，智能合并数据
- ⏰ **自动同步** - 启动时自动同步，支持定时后台同步（每 5 分钟）
- 🎨 **简洁设计** - 极简界面，专注于待办本身
- 💾 **自动保存** - 编辑后自动保存，无需手动操作
- 📱 **跨平台** - 支持 Windows、macOS、Linux
- 🔒 **本地优先** - 数据本地 SQLite 存储，隐私安全

## 🚀 快速开始

### 环境要求

#### 1. 安装 Node.js

- **Node.js** 18+ - [下载地址](https://nodejs.org/)
- 下载安装后，验证安装：
  ```bash
  node --version
  pnpm --version
  ```

#### 2. 安装 Rust

- **Rust** 1.70+ - [下载地址](https://rustup.rs/)
- **安装步骤**：
  1. 访问 https://rustup.rs/ 下载 `rustup-init.exe`（Windows）
  2. 运行安装器，选择默认安装（输入 `1` 然后回车）
  3. **重启终端**（让环境变量生效）
  4. 验证安装：
     ```bash
     rustc --version
     cargo --version
     ```

#### 3. 安装 Windows 构建工具（仅 Windows）

- 方式 1: 安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 "C++ 生成工具"
- 方式 2: 运行 `pnpm add -g windows-build-tools`（需要管理员权限）

### 克隆并启动项目

```bash
# 1. 克隆仓库
git clone https://github.com/jaridli/LightTodo.git
cd LightTodo

# 2. 安装前端依赖
pnpm install

# 3. 启动开发服务器
pnpm run tauri dev
```

### 首次启动说明

首次运行 `pnpm run tauri dev` 时：
- Rust 会下载并编译依赖，需要 5-10 分钟
- 编译完成后会自动启动应用
- 后续启动会快很多（热重载约 1-2 秒）

### 构建生产版本

```bash
# 打包为可执行文件
pnpm run tauri build

# 输出位置：
# Windows: src-tauri/target/release/LightTodo.exe
# macOS:   src-tauri/target/release/bundle/dmg/
# Linux:   src-tauri/target/release/bundle/appimage/
```

## 🧪 测试

### 运行单元测试

```bash
# 运行所有单元测试
pnpm test

# 监听模式（开发时使用）
pnpm run test:watch

# 生成覆盖率报告
pnpm run test:coverage
```

### 运行 E2E 测试

```bash
# 安装 Playwright 浏览器（首次运行）
pnpm dlx playwright install

# 运行 E2E 测试
pnpm run test:e2e

# 交互式 UI 模式
pnpm run test:e2e:ui

# 调试模式
pnpm run test:e2e:debug
```

## 📖 使用说明

### 基础操作

#### 创建待办
1. 点击右上角 **+** 按钮
2. 输入待办内容
3. 按 **Enter** 键保存当前待办并创建下一条（支持连续输入）
4. 自动保存（失焦后生效）
5. 如果不输入内容直接失焦，待办会自动删除

#### 编辑待办
- 直接点击待办文本即可编辑
- 修改后失焦自动保存
- 按 **Enter** 键快速创建下一条待办

#### 切换优先级
- 点击待办左侧的圆圈图标
- 循环切换：⚪ 低优先级 → 🟡 中优先级 → 🔴 高优先级 → ⚪
- 待办会按优先级自动排序（高优先级在上）

#### 完成待办
- 点击待办左侧的复选框
- 已完成的待办会移到底部 "✓ 已完成" 区域
- 在已完成的待办上点击 **⋯** 可选择"恢复"或"删除"

#### 删除待办
- 鼠标点击待办右侧的 **⋯** 按钮，选择"删除"
- 或者将待办内容清空后失焦，会自动删除

#### 今日待办
- 在待办右侧菜单中设置截止日期和时间
- 所有设置了 deadline 的未完成待办会自动显示在“今日”
- 到期后按小时显示逾期时间，完成后自动进入“已完成”

#### 窗口置顶
- 点击左上角的 📌 图标切换窗口置顶状态
- 📍 灰色 = 未置顶
- 📌 青色 = 已置顶

#### 系统托盘
- 点击右上角 **✕** 按钮隐藏窗口到系统托盘
- 左键点击托盘图标：显示/隐藏窗口
- 右键点击托盘图标：显示菜单
  - **显示窗口** - 重新打开窗口
  - **退出** - 完全退出应用

### 待办分组

- **今日** - 自动显示所有已设置 deadline 的未完成待办
- **自定义分组** - 创建自己的分组（双击分组名可重命名，悬停显示删除按钮）
- **未完成** - 未分组的待办，按优先级排序
- **✓ 已完成** - 已完成的待办

#### 分组操作
- **创建分组**：在待办的右键菜单中选择"移动到" → 输入新分组名 → 创建
- **重命名分组**：双击分组名称进行编辑
- **删除分组**：鼠标悬停在分组名称上，点击右侧的 **✕** 按钮（分组内的待办会移至"未完成"）
- **移动待办**：点击待办右侧的 **⋯** 按钮 → "移动到" → 选择目标分组

### WebDAV 同步

#### 配置步骤
1. 点击底部 **⚙️** 按钮打开设置界面
2. 填写 WebDAV 信息：
   - **WebDAV 地址**：如 `https://dav.jianguoyun.com/dav`
   - **同步目录**：数据保存的子目录，如 `LightTodo`
   - **用户名**：云存储账号
   - **密码**：应用专用密码（坚果云需在网页版生成）
3. 点击 **测试连接** 验证配置
4. 点击 **保存配置**
5. 勾选 **启用 WebDAV 同步**

#### 坚果云配置示例
- **WebDAV 地址**: `https://dav.jianguoyun.com/dav`
- **用户名**: 你的邮箱
- **密码**: 在坚果云网页版 **账户信息 → 安全选项 → 第三方应用管理** 中生成
- **同步目录**: `LightTodo`（会自动创建）

#### 同步模式

- **⬇️ 下载**：从云端下载到本地
  - 只下载云端比本地新的待办（通过 `updated_at` 时间戳对比）
  - 本地不存在的待办也会下载
  - 如果本地和云端完全一致，显示"无需下载，本地已是最新"
  
- **⬆️ 上传**：从本地上传到云端
  - 只上传 `updated_at > last_sync` 的待办（本地修改过的）
  - 首次同步会上传所有本地待办
  - 自动删除云端多余的文件（本地已删除的待办）
  
- **🔄 同步**：智能双向同步（推荐）
  - **上传**：本地修改过的待办（`updated_at >= last_sync`）
  - **下载**：云端有但本地不存在的待办
  - **更新**：云端版本比本地新的待办（`remote_updated > local_updated`）
  - **删除**：自动删除云端本地已删除的待办
  - 以最新修改时间为准，智能合并数据

- **🔧 重置**：重置同步状态
  - 将 `last_sync` 重置为 0
  - 自动关闭自动同步
  - 下次同步会重新上传所有待办
  - 适用于同步出错时的修复

#### 同步逻辑说明

**双向同步的四个计数含义**：
- **上传 (uploaded)**：本地修改后上传到云端的待办数量
- **下载 (downloaded)**：云端有但本地不存在的新待办
- **更新 (updated)**：云端版本比本地新，覆盖本地的待办数量
- **删除 (deleted)**：云端被删除的待办数量

示例消息：`同步完成 (上传 1, 下载 1, 更新 1, 删除 0)`

#### 删除同步
- 当你在本地删除待办后，使用"上传到云端"或"双向同步"，云端对应的文件也会被自动删除
- 这确保了本地和云端数据的完全一致性

#### 同步按钮位置
- **主界面底部**：快速同步三个按钮
- **设置界面**：完整的同步控制和状态显示

### 已知问题

⚠️ **中文输入限制**：由于 Tauri 在 Windows 上的透明窗口与 IME（输入法）的兼容性问题，当前版本关闭了窗口透明效果以确保中文输入正常工作。这是 Tauri 框架的已知限制，等待官方修复。

## 🛠️ 技术栈

- **桌面框架**: Tauri 2.x（比 Electron 更轻量，包体积小 10 倍以上）
- **前端**: React 18 + TypeScript
- **状态管理**: Zustand（轻量级）
- **本地存储**: SQLite（Rust 后端，使用 rusqlite）
- **WebDAV 客户端**: Rust reqwest + roxmltree
- **UI**: Tailwind CSS + shadcn/ui
- **构建工具**: Vite
- **测试框架**: Vitest + React Testing Library + Playwright

**为什么选择 Tauri？**
- 安装包体积仅 3-5 MB（Electron 通常 50+ MB）
- 内存占用更低（使用系统 WebView2，无需打包浏览器）
- 原生性能更好（Rust 后端）
- 无需 Visual Studio（只需 Rust 工具链）
- 支持 Windows / macOS / Linux 跨平台打包

## 📁 数据存储

### 本地存储位置

- **Windows**: `%LOCALAPPDATA%\lighttodo\notes.db`
- **macOS**: `~/Library/Application Support/lighttodo/notes.db`
- **Linux**: `~/.local/share/lighttodo/notes.db`

### 数据库结构

```sql
-- 待办表
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_todo INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,  -- 0=低, 1=中, 2=高
  group_id TEXT,                         -- 所属分组ID
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at INTEGER
);

-- 分组表
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 标签表（预留功能）
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- WebDAV 配置表
CREATE TABLE webdav_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  url TEXT NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  auto_sync INTEGER NOT NULL DEFAULT 0,
  directory TEXT NOT NULL DEFAULT 'LightTodo',
  last_sync INTEGER
);
```

### 待办数据格式

```json
{
  "id": "uuid-v4",
  "title": "完成项目文档",
  "content": "",
  "isTodo": true,
  "isCompleted": false,
  "priority": 2,
  "pinned": false,
  "createdAt": "2026-06-29T10:00:00Z",
  "updatedAt": "2026-06-29T12:00:00Z"
}
```

## 🗺️ 开发路线图

### v0.1.0 - 核心功能 ✅
- [x] 基础待办 CRUD（创建、编辑、删除）
- [x] Todo 勾选完成状态
- [x] 本地 SQLite 存储
- [x] 三级优先级标记
- [x] 按优先级自动排序
- [x] 窗口置顶功能
- [x] 系统托盘支持
- [x] 托盘右键菜单
- [x] 自动保存
- [x] 简洁 UI 界面
- [x] 中文输入支持（关闭透明窗口）
- [x] Enter 键快速创建待办（连续输入）
- [x] 窗口位置和大小记忆

### v0.2.0 - WebDAV 同步 ✅
- [x] WebDAV 配置界面
- [x] 测试连接功能
- [x] 手动同步功能（双向同步）
- [x] 上传到云端（单向推送）
- [x] 从云端下载（单向拉取）
- [x] 同步状态提示
- [x] 智能合并策略（按更新时间）
- [x] 多行待办支持
- [x] 删除同步（删除本地待办后自动删除云端文件）
- [x] 自动同步开关（启动时自动同步）
- [x] 定时自动同步（每 5 分钟）
- [x] Deadline 与今日智能分组
- [x] 自定义分组功能
- [x] 单元测试框架搭建（Vitest + React Testing Library）
- [x] E2E 测试框架搭建（Playwright）
- [x] 核心 hooks 单元测试（useNotes, useGroups）
- [x] Store 单元测试（notesStore）
- [x] API 层单元测试（WebDAV sync api）
- [ ] 冲突检测与处理（版本控制）
- [ ] 离线队列
- [ ] 透明窗口 + IME 兼容（等待 Tauri 修复）

### v0.3.0 - 增强功能
- [ ] 标签系统
- [ ] 颜色标记
- [ ] 全文搜索
- [ ] 深色模式
- [ ] 导入/导出 JSON
- [ ] 待办回收站
- [ ] 子任务支持

### v1.0.0 - 正式版
- [ ] 提醒功能（桌面通知）
- [ ] 重复任务设置
- [ ] 性能优化
- [ ] 快捷键系统
- [ ] 自动更新检查

### 未来计划
- [ ] Markdown 基础支持
- [ ] 多设备同步历史查看
- [ ] 附件支持（图片）
- [ ] 待办模板
- [ ] 加密存储选项

## 🤝 贡献

欢迎贡献代码、报告 bug 或提出新功能建议！

### 开发流程

1. Fork 本仓库
2. 克隆到本地：`git clone https://github.com/你的用户名/LightTodo.git`
3. 安装依赖：`pnpm install`
4. 创建特性分支：`git checkout -b feature/AmazingFeature`
5. 进行开发并测试：`pnpm run tauri dev`
6. 提交更改：`git commit -m 'Add some AmazingFeature'`
7. 推送到分支：`git push origin feature/AmazingFeature`
8. 提交 Pull Request

### 代码规范

- 使用 TypeScript 编写前端代码
- 遵循 ESLint 规则
- Rust 代码使用 `cargo fmt` 格式化
- 提交信息使用清晰的描述

### 项目结构

```
LightTodo/
├── src/                      # React 前端代码
│   ├── features/            # 功能模块
│   │   ├── notes/          # 待办功能
│   │   │   ├── hooks/      # API hooks (useNotes.ts, useGroups.ts)
│   │   │   ├── stores/     # Zustand 状态管理
│   │   │   └── types/      # TypeScript 类型定义
│   │   └── sync/           # WebDAV 同步功能
│   │       ├── api.ts      # 同步 API 调用
│   │       └── WebDAVSettings.tsx  # 设置界面
│   ├── App.tsx             # 主应用组件
│   └── main.tsx            # 入口文件
├── src-tauri/               # Rust 后端代码
│   ├── src/
│   │   ├── commands/       # Tauri 命令 (CRUD 操作)
│   │   ├── database/       # SQLite 数据库初始化
│   │   ├── models/         # 数据模型定义
│   │   ├── webdav.rs       # WebDAV 客户端实现
│   │   ├── sync.rs         # 同步逻辑
│   │   └── main.rs         # Rust 入口 + 托盘配置
│   ├── tauri.conf.json     # Tauri 配置
│   └── Cargo.toml          # Rust 依赖
├── public/                  # 静态资源
└── README.md               # 本文件
```

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 💬 联系方式

- **Issues**: [GitHub Issues](https://github.com/jaridli/LightTodo/issues)
- **Discussions**: [GitHub Discussions](https://github.com/jaridli/LightTodo/discussions)

## 🙏 致谢

感谢所有为开源社区做出贡献的开发者

---

**注意**: 本项目正在积极开发中，欢迎反馈和建议
