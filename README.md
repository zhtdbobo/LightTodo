# LightTodo

一个轻量级、支持 WebDAV 同步的待办事项应用
## 应用截图
<img width="240" height="359" alt="PixPin_2026-08-07_23-22-32" src="https://github.com/user-attachments/assets/9f13d598-76c1-41ee-a23c-da42c3f03f2b" />
<img width="239" height="359" alt="PixPin_2026-08-07_23-34-20" src="https://github.com/user-attachments/assets/e26dcb11-51fd-4bc0-b910-4b66a77556dc" />
<img width="570" height="500" alt="PixPin_2026-08-07_23-26-52" src="https://github.com/user-attachments/assets/e3e35e5c-d68d-4dea-ab54-ebffae78c385" />
<img width="566" height="502" alt="PixPin_2026-08-07_23-26-42" src="https://github.com/user-attachments/assets/0c14add9-5ce5-4e19-91a1-79b3cd450544" />
<img width="569" height="500" alt="PixPin_2026-08-07_23-27-19" src="https://github.com/user-attachments/assets/ec0e3622-08f8-458f-a6bd-e5b7e6e26f22" />
<img width="568" height="510" alt="PixPin_2026-08-07_23-27-32" src="https://github.com/user-attachments/assets/70a30f13-3c29-4660-98d5-b4fd05601178" />

当前版本：`v0.4.2` · [更新日志](CHANGELOG.md) · [功能状态](docs/FEATURE_STATUS.md)

## ✨ 特性

- 🪶 **极致轻量** - Tauri 架构，安装包仅 3-5 MB，内存占用低
- ✅ **待办管理** - 创建、编辑、删除待办，支持完成状态切换
- 📝 **多行支持** - 待办内容支持多行输入（Shift+Enter 换行）
- 🎯 **优先级** - 三级优先级标记（高🔴、中🟡、低⚪）
- 📁 **自定义分组** - 创建、重命名、删除分组，待办可移动到不同分组
- ⏰ **截止时间** - 设置 deadline 后自动进入“今日”，并按小时显示逾期时间
- 🔁 **周期任务** - 支持每天、每周、每月重复，完成后自动生成下一次待办
- 🖥️ **窗口置顶** - 小窗口始终在最前，方便随时查看
- 🗂️ **系统托盘** - 隐藏到托盘运行，右键菜单快速操作
- ☁️ **WebDAV 同步** - 支持坚果云、Nextcloud 等 WebDAV 云存储同步
- 🔄 **智能同步** - 双向同步、上传、下载三种模式，智能合并数据
- ⏰ **自动同步** - 启动时自动同步，支持定时后台同步（每 5 分钟）
- 🔐 **密码待办** - 内置密码生成器，使用 AES-256-GCM 加密并支持跨设备同步
- 📦 **本地备份** - 将全部待办、分组和标签导出为 JSON，并可通过事务安全恢复
- ⬆️ **应用内更新** - 自动检查、下载并安装签名更新包
- 🎨 **简洁设计** - 极简界面，专注于待办本身
- 💾 **自动保存** - 编辑后自动保存，无需手动操作
- 📱 **跨平台桌面端** - Windows 与 macOS 均支持普通待办、WebDAV 同步和密码待办；敏感凭据分别保存在 Windows Credential Manager 与 macOS Keychain
- 🔒 **本地优先** - 数据本地 SQLite 存储，隐私安全

## 🚀 快速开始

### 环境要求

#### 1. 安装 Node.js 与 pnpm

- **Node.js** 18+ - [下载地址](https://nodejs.org/)
- **pnpm** 11+ - 可通过 `corepack enable` 启用
- 下载安装后验证：
  ```bash
  node --version
  pnpm --version
  ```

#### 2. 安装 Rust 1.85+

- 访问 [rustup.rs](https://rustup.rs/) 并按当前系统说明安装
- 安装后重启终端并运行 `rustc --version`、`cargo --version` 验证

#### 3. 安装 Windows 构建工具（仅 Windows）

- 方式 1: 安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 "C++ 生成工具"
- 方式 2: 运行 `pnpm add -g windows-build-tools`（需要管理员权限）

#### 4. 安装 macOS 构建工具（仅 macOS）

```bash
xcode-select --install
```

### 克隆并启动项目

```bash
# 1. 克隆仓库
git clone https://github.com/zhtdbobo/LightTodo.git
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
# 当前平台构建
pnpm run tauri build

# 在 macOS 上构建同时支持 Apple Silicon 与 Intel 的通用安装包
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm run tauri:build:mac

# 输出位置
# Windows: src-tauri/target/release/bundle/nsis/
# macOS:   src-tauri/target/universal-apple-darwin/release/bundle/dmg/
# Linux:   src-tauri/target/release/bundle/appimage/
```

macOS 安装包必须在 macOS 上构建。推送版本标签后，GitHub Actions 会同时生成 Windows `NSIS` 和 macOS 通用架构 `DMG`。

不使用付费 Apple Developer 账号也能分发 `DMG`。未签名版本首次启动时，需要在 Finder 中右键 LightTodo 选择“打开”并确认；配置 Apple 签名与公证后才可直接双击打开而不显示 Gatekeeper 警告。

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

#### 首次安装
- 首次启动会先完成本地待办和分组加载，再判断是否为空，避免短暂显示错误空状态
- 没有任何数据时以“新建待办”为首要操作；点击后直接创建并展开“未分类”
- 密码生成入口保留在“密码”分组内，不再占据首次安装首屏

#### 今日待办
- 在待办右侧菜单中设置截止日期和时间
- 所有设置了 deadline 的未完成待办会自动显示在“今日”
- 默认每次显示主窗口时展开“今日”分组；可在“设置 → 常规”中关闭，重新启动应用后开关恢复开启
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
- 应用已经运行时再次点击启动入口，只会唤起现有窗口，不会创建多个实例

### 待办分组

- **今日** - 自动显示所有已设置 deadline 的未完成待办，默认在每次显示窗口时展开
- **自定义分组** - 创建自己的分组；未完成分组默认折叠，并在名称后显示条目数
- **未分类** - 未分组的待办，按优先级排序，也支持折叠查看
- **✓ 已完成** - 已完成的待办

#### 分组操作
- **创建分组**：在待办的右键菜单中选择"移动到" → 输入新分组名 → 创建
- **重命名分组**：双击分组名称进行编辑
- **删除分组**：鼠标悬停在分组名称上，点击右侧的 **✕** 按钮，并在应用内弹窗确认（分组内的待办会移至"未分类"）
- **调整顺序**：鼠标悬停在分组名称上，点击 **↑/↓** 将分组移动到上方或下方；顺序会保存并参与同步
- **移动待办**：点击待办右侧的 **⋯** 按钮 → "移动到" → 选择目标分组

### 密码待办

- 在“密码”分组右侧打开生成菜单，可选择长度以及大写字母、小写字母、数字和特殊字符
- 点击生成后，第一行填写用途备注，第二行保存生成的密码
- 密码内容在本地使用 AES-256-GCM 加密；密钥保存在 Windows Credential Manager 或 macOS Keychain
- 使用 WebDAV 时，vault envelope 会帮助其他受信任设备解锁同步后的密码待办，云端不保存明文密码

### 应用更新

1. 打开设置中心的“关于”页面
2. 点击“检查更新”
3. 发现新版本后点击“下载并安装”，应用会验证签名、安装并重启

Windows 和 macOS 共用同一份更新清单；下载优先通过 `gh-proxy.com`，GitHub 直连作为回退。

### 本地备份

1. 打开设置中心独立的“备份”页面
2. 点击“导出备份”，通过系统文件对话框选择 JSON 文件的保存位置
3. 需要恢复时点击“导入备份”，选择文件并确认替换当前数据

导入会在一个数据库事务内替换待办、分组和标签；校验或写入失败时会完整回滚。为了支持密码待办跨设备恢复，导出的文件包含密码条目的明文内容，请只保存到可信位置。

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
  - 先读取一次云端 `manifest.json`
  - 只下载云端有变化或本地不存在的待办与分组
  - 如果本地和云端完全一致，显示"无需下载，本地已是最新"
  
- **⬆️ 上传**：从本地上传到云端
  - 只上传更新时间或文件哈希发生变化的待办与分组
  - 首次同步会上传所有本地待办
  - 通过删除墓碑把本地删除动作同步到云端
  
- **🔄 同步**：智能双向同步（推荐）
  - 先用 `manifest.json` 对比 ID、更新时间、删除时间和 SHA-256 哈希
  - 仅上传或下载实际变化的待办与分组
  - 删除动作会在设备间双向传播
  - 时间戳相同时使用文件哈希确定固定版本，避免设备间反复覆盖

- **🔧 重置**：重置同步状态
  - 将 `last_sync` 重置为 0
  - 自动关闭自动同步
  - 不删除本地或云端数据，也不会绕过 manifest 的冲突保护
  - 适用于清除同步时间记录后重新手动检查

#### 同步逻辑说明

本地数据继续保存在 SQLite；云端以逐条 JSON 文件保存内容，并使用 `manifest.json` 作为轻量同步索引。正常无变化同步只需要一次 manifest 下载，不再逐个请求所有待办文件。

同步目录结构固定为：

- `<同步目录>/manifest.json`：只保存待办/分组的 ID、更新时间、删除时间、SHA-256 哈希、对象 ETag，以及用于跨设备解锁密码待办的 vault envelope；不保存 WebDAV 密码或明文密码。
- `<同步目录>/notes/<ID>.json`：单条待办内容。
- `<同步目录>/groups/<ID>.json`：单个分组内容。

WebDAV 密码不会回填到 WebView，Windows 版本保存在 Windows Credential Manager，macOS 版本保存在系统 Keychain；密码待办标题使用 AES-256-GCM 加密，vault key 通过 manifest 中的 envelope 在设备间共享。

**同步结果计数含义**：
- **上传 (uploaded)**：本地修改后上传到云端的待办数量
- **下载 (downloaded)**：云端有但本地不存在的新待办
- **更新 (updated)**：云端版本比本地新，覆盖本地的待办数量
- **删除云端/本地 (deleted)**：删除墓碑传播后实际删除的数量

示例消息：`同步完成 - 上传 1 个待办，更新 1 个分组`

#### 删除同步
- 当你在本地删除待办后，使用"上传到云端"或"双向同步"，云端对应的文件也会被自动删除
- 删除时间会保存在 manifest 中，其他设备同步时也会删除对应的本地待办

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
- **UI**: Tailwind CSS
- **构建工具**: Vite
- **测试框架**: Vitest + React Testing Library + Playwright

**为什么选择 Tauri？**
- 安装包体积仅 3-5 MB（Electron 通常 50+ MB）
- 内存占用更低（使用系统 WebView2，无需打包浏览器）
- 原生性能更好（Rust 后端）
- 使用系统 WebView，无需随应用打包浏览器运行时
- 支持 Windows / macOS / Linux 跨平台打包；Windows 与 macOS 已接入系统凭据存储，Linux 仍需补充对应实现后才能启用 WebDAV 和密码待办

## 📁 数据存储

### 本地存储位置

- **Windows**: `%APPDATA%\lighttodo\notes.db`
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
  completed_at INTEGER,
  deadline INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at INTEGER
);

-- 分组表
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER
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
  password TEXT NOT NULL,              -- 兼容旧版本，迁移后保持为空；真实密码在系统凭据存储中
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
  "groupId": null,
  "deadline": 1780086400000,
  "createdAt": 1780000000000,
  "updatedAt": 1780000000000
}
```

## 📌 项目状态

README 只介绍当前可用能力，不再维护按旧版本划分的路线图。当前代码版本、已完成功能和尚未完成功能统一记录在 [功能状态文档](docs/FEATURE_STATUS.md)，历史版本变化记录在 [CHANGELOG](CHANGELOG.md)。

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
│   │   ├── sync/           # WebDAV 同步与本地备份
│   │   └── settings/       # 常规、同步、关于与更新设置
│   ├── App.tsx             # 主应用组件
│   └── main.tsx            # 入口文件
├── src-tauri/               # Rust 后端代码
│   ├── src/
│   │   ├── backup.rs       # JSON 备份导入与导出
│   │   ├── commands/       # Tauri 命令 (CRUD 操作)
│   │   ├── crypto.rs       # 密码待办加密与 vault 管理
│   │   ├── credential_store.rs # 系统凭据存储
│   │   ├── database/       # SQLite 数据库初始化
│   │   ├── models/         # 数据模型定义
│   │   ├── webdav.rs       # WebDAV 客户端实现
│   │   ├── sync.rs         # WebDAV 配置与同步入口
│   │   ├── sync_manifest.rs # 增量同步与冲突处理
│   │   └── main.rs         # Rust 入口 + 托盘配置
│   ├── tauri.conf.json     # 跨平台 Tauri 配置
│   ├── tauri.windows.conf.json # Windows NSIS 配置
│   ├── tauri.macos.conf.json   # macOS App/DMG 配置
│   └── Cargo.toml          # Rust 依赖
├── docs/                    # 开发、发布与功能状态文档
├── CHANGELOG.md             # 版本更新记录
└── README.md               # 本文件
```

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 💬 联系方式

- **Issues**: [GitHub Issues](https://github.com/zhtdbobo/LightTodo/issues)
- **Discussions**: [GitHub Discussions](https://github.com/zhtdbobo/LightTodo/discussions)

## 🙏 致谢

感谢所有为开源社区做出贡献的开发者

---

**注意**: 本项目正在积极开发中，欢迎反馈和建议
