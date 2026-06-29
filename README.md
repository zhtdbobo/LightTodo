# LightTodo

一个轻量级、支持 WebDAV 同步的待办事项应用

## ✨ 特性

- 🪶 **极致轻量** - Tauri 架构，安装包仅 3-5 MB，内存占用低
- ✅ **待办管理** - 创建、编辑、删除待办，支持完成状态切换
- 🎯 **优先级** - 三级优先级标记（高🔴、中🟡、低⚪）
- 📌 **窗口置顶** - 小窗口始终在最前，方便随时查看
- 🎨 **简洁设计** - 极简界面，专注于待办本身
- 💾 **自动保存** - 编辑后自动保存，无需手动操作
- 📱 **跨平台** - 支持 Windows、macOS、Linux
- 🔒 **本地优先** - 数据本地 SQLite 存储，隐私安全

## 🚀 快速开始

### 环境要求

- **Node.js** 18+ - [下载地址](https://nodejs.org/)
- **Rust** 1.70+ - [下载地址](https://rustup.rs/)
- **Windows 构建工具**（仅 Windows）:
  - 方式 1: 安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 "C++ 生成工具"
  - 方式 2: 运行 `npm install --global windows-build-tools`（需要管理员权限）

### 克隆并启动项目

```bash
# 1. 克隆仓库
git clone https://github.com/jaridli/LightTodo.git
cd LightTodo

# 2. 安装前端依赖
npm install

# 3. 启动开发服务器
npm run tauri dev
```

### 首次启动说明

首次运行 `npm run tauri dev` 时：
- Rust 会下载并编译依赖，需要 5-10 分钟
- 编译完成后会自动启动应用
- 后续启动会快很多（热重载约 1-2 秒）

### 构建生产版本

```bash
# 打包为可执行文件
npm run tauri build

# 输出位置：
# Windows: src-tauri/target/release/LightTodo.exe
# macOS:   src-tauri/target/release/bundle/dmg/
# Linux:   src-tauri/target/release/bundle/appimage/
```

## 📖 使用说明

### 基础操作

#### 创建待办
1. 点击右上角 **+** 按钮
2. 输入待办内容
3. 自动保存（失焦后生效）
4. 如果不输入内容直接失焦，待办会自动删除

#### 编辑待办
- 直接点击待办文本即可编辑
- 修改后失焦自动保存

#### 切换优先级
- 点击待办左侧的圆圈图标
- 循环切换：⚪ 低优先级 → 🟡 中优先级 → 🔴 高优先级 → ⚪
- 待办会按优先级自动排序（高优先级在上）

#### 完成待办
- 点击待办左侧的复选框
- 已完成的待办会移到底部 "✓ 已完成" 区域

#### 删除待办
- 鼠标悬停在待办上，点击右侧出现的 **✕** 按钮
- 直接删除，无需二次确认

#### 窗口置顶
- 点击左上角的 📌 图标切换窗口置顶状态
- 📍 灰色 = 未置顶
- 📌 青色 = 已置顶

### 待办分组

- **📌 置顶** - 窗口置顶的待办（暂未实现待办项置顶功能）
- **待办事项** - 未完成的待办，按优先级排序
- **✓ 已完成** - 已完成的待办

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
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_todo INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,  -- 0=低, 1=中, 2=高
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at INTEGER
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

### v0.1.0 (当前版本) - 核心功能
- [x] 基础待办 CRUD（创建、编辑、删除）
- [x] Todo 勾选完成状态
- [x] 本地 SQLite 存储
- [x] 三级优先级标记
- [x] 按优先级自动排序
- [x] 窗口置顶功能
- [x] 自动保存
- [x] 简洁 UI 界面
- [x] 中文输入支持（关闭透明窗口）
- [ ] 待办项置顶功能
- [ ] 透明窗口 + IME 兼容（等待 Tauri 修复）

### v0.2.0 - WebDAV 同步
- [ ] WebDAV 配置界面
- [ ] 手动同步功能
- [ ] 自动同步开关
- [ ] 同步状态指示
- [ ] 冲突检测与处理
- [ ] 离线队列

### v0.3.0 - 增强功能
- [ ] 标签系统
- [ ] 颜色标记
- [ ] 全文搜索
- [ ] 深色模式
- [ ] 导入/导出 JSON
- [ ] 待办回收站

### v1.0.0 - 正式版
- [ ] 提醒功能（桌面通知）
- [ ] 重复任务设置
- [ ] 性能优化
- [ ] 快捷键系统
- [ ] 自动更新检查
- [ ] 系统托盘支持

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
3. 安装依赖：`npm install`
4. 创建特性分支：`git checkout -b feature/AmazingFeature`
5. 进行开发并测试：`npm run tauri dev`
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
│   │   └── notes/          # 待办功能
│   │       ├── hooks/      # API hooks
│   │       ├── stores/     # Zustand 状态管理
│   │       └── types/      # TypeScript 类型
│   ├── App.tsx             # 主应用组件
│   └── main.tsx            # 入口文件
├── src-tauri/               # Rust 后端代码
│   ├── src/
│   │   ├── commands/       # Tauri 命令
│   │   ├── database/       # SQLite 数据库
│   │   └── main.rs         # Rust 入口
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
