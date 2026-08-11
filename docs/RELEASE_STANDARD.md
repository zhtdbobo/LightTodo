# LightTodo Release Standard

本文档用于统一 LightTodo 后续每次发布 GitHub Release 的内容格式、上传文件和操作流程。

## 1. Release 目标

每次发布都应做到：

- 有清晰的版本号和发布日期
- 有统一格式的 Release Note
- 有对应平台的安装包/构建产物
- 能明确看出本次版本新增了什么
- README 已同步当前版本号和本版本实际功能

## 2. Release Note 标准格式

Release Note 统一使用中文，并按下面结构编写：

```md
## 主要功能
- 功能 1
- 功能 2
- 功能 3
- 功能 4

## 发布说明
- `vX.Y.Z` 为 LightTodo 的 XXX 版本
- 本版本在 `vA.B.C` 的基础上新增了……
- 如果有重要修复、体验优化或发布限制，也在这里补充
```

### 2.1 写法要求

- `主要功能` 只写本版本实际提供的功能，不写空话
- 每条尽量短，使用“功能名：说明”的形式
- `发布说明` 只写 2-3 条，说明这个版本的定位和变化
- 不要在 Release Note 里重复写“Latest”“released this yesterday”等 GitHub 自动信息
- 不要把上一个版本的完整内容再抄一遍
- 如果是修复版，可以把标题写成“修复版本”或“补充构建版本”

### 2.2 推荐示例

```md
## 主要功能
- WebDAV 同步：支持配置 WebDAV 并进行连接测试
- 手动同步：支持下载、上传和双向同步
- 自动同步：支持启动时自动同步和定时后台同步
- 待办增强：支持置顶待办、自定义分组与分组管理

## 发布说明
- `v0.2.0` 为 LightTodo 的 WebDAV 同步版本
- 在 `v0.1.0` 的本地待办基础上，补充了云端同步与分组管理能力
- 同时完善了编辑体验、测试覆盖和桌面端打包资源
```

## 3. 需要上传到 Release 的文件

### 3.1 Windows 发布必须项

至少上传以下文件：

- `LightTodo_<version>_x64-setup.exe`

这是 Windows 用户最常用的安装包，属于必传文件。

### 3.2 macOS 安装包

- `LightTodo_<version>_universal.dmg`

该安装包同时支持 Apple Silicon 与 Intel Mac，也属于必传文件。

### 3.3 可选文件

如果构建流程产出这些文件，也可以一并上传：

- `*.msi`
- `*.dmg`
- `*.AppImage`
- `*.deb`
- `*.rpm`
- `*.zip`
- `*.sha256` 或其他校验文件

### 3.4 当前项目建议

LightTodo 当前发布 Windows `NSIS`、macOS 通用架构 `DMG` 和 Android `APK`，因此每次 release 至少要确保：

- `LightTodo_<version>_x64-setup.exe`
- `LightTodo_<version>_x64-setup.exe.sig`
- `LightTodo_<version>_universal.dmg`
- Tauri 生成的 Android APK（文件名以实际构建产物为准）
- macOS `*.app.tar.gz` 及其 `.sig`
- Android：直接下载分发；上架 Google Play 仍需配置 Android 签名
- `latest.json`
- Release Note 已更新为中文

其中签名文件和 `latest.json` 供 Windows 与 macOS 应用内自动更新使用。缺少任意一项时，旧版本仍可运行，但对应平台无法完成应用内更新。

## 4. Release 发布流程

### 4.1 发布前检查

1. 确认当前代码处于目标版本
2. 更新 README 的当前版本号和功能说明
3. 更新功能状态文档中的版本号和完成状态
4. 确认构建能成功
5. 确认要上传的文件已经生成
6. 确认 Release Note 已整理好

### 4.2 构建流程

首次启用自动更新时，将本机 `src-tauri/.updater/lighttodo.key` 的完整内容保存为仓库 Secret：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（内容见本机 `src-tauri/.updater/lighttodo.key.password`）

私钥不得提交到 Git，也不能丢失；后续版本必须始终使用同一把密钥签名。

面向普通用户分发 macOS 版本时，还应配置 Apple Developer 签名与公证 Secrets：

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

未配置这些 Secrets 时仍可生成 `DMG`，但 macOS Gatekeeper 会提示应用来自未识别的开发者。

推荐推送 `v<version>` tag，由 `.github/workflows/release.yml` 自动构建签名更新包和草稿 Release：

```bash
git tag v<version>
git push origin v<version>
```

本地验证 Windows 构建时，需要先设置签名私钥环境变量，再运行：

```bash
pnpm run tauri build
```

构建完成后，从下面路径找安装包：

```text
src-tauri/target/release/bundle/nsis/LightTodo_<version>_x64-setup.exe
src-tauri/target/universal-apple-darwin/release/bundle/dmg/LightTodo_<version>_universal.dmg
```

### 4.3 发布流程

1. 给当前版本打 tag 并推送
2. 等待 GitHub Actions 创建草稿 Release
3. 检查 Windows、macOS 安装包、签名文件和 `latest.json` 是否齐全
4. 完善 Release Note 后发布草稿
5. 发布后确认 `latest.json` 可以访问

Release 工作流会自动将 `latest.json` 中的安装包地址改为 `gh-proxy.com` 镜像，并保留客户端中的 GitHub 直连清单地址作为回退。发布后需要同时检查镜像清单和镜像安装包可访问。

## 5. 版本发布命名规范

- 版本号使用语义化版本号，如 `v0.1.0`、`v0.2.0`
- 版本说明尽量使用中文
- 标题统一为版本号，例如 `v0.2.0`
- Release Note 正文统一使用以下顺序：
  - `## 主要功能`
  - `## 发布说明`

## 6. 版本差异说明规则

如果本次版本需要说明和上一个版本的差异，建议只写一句到两句：

- 本版本在 `v0.1.0` 基础上增加了 WebDAV 同步能力
- 本版本在 `v0.2.0` 基础上修复了同步边界问题

不要写成长篇 diff，也不要重复历史版本所有功能。

## 7. 发布前最终检查清单

发布前请确认以下内容：

- [ ] 版本号正确
- [ ] README 已更新当前版本号和功能说明
- [ ] 功能状态文档已与当前版本对应
- [ ] Release Note 为中文
- [ ] `## 主要功能` 和 `## 发布说明` 结构完整
- [ ] Windows `NSIS` 安装包已上传
- [ ] macOS 通用架构 `DMG` 已上传
- [ ] Android `APK` 已上传
- [ ] 签名文件和 `latest.json` 已上传
- [ ] Release 页面没有多余旧资产
- [ ] 标题、正文、资产命名一致

## 8. 建议后续固定动作

以后每次发版，建议按这个顺序执行：

1. 更新 README、功能状态文档和版本号
2. 编写 Release Note
3. 构建安装包
4. 推送版本 tag，等待 Actions 完成签名构建
5. 完善并发布 GitHub Release 草稿
6. 检查安装包与自动更新资产是否完整

---

如果后续增加 Linux 发布包，本文件应同步补充对应平台的上传规范。
