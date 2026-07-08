# Git Commit 规范

## 提交格式

本项目遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范，所有 commit message 使用以下格式：

```
<type>(<scope>): <中文描述>

[可选的详细说明]
```

### Type 类型

- **feat**: 新功能
- **fix**: 错误修复
- **docs**: 文档更新
- **style**: 代码格式调整（不影响功能）
- **refactor**: 重构（既不是新功能也不是修复）
- **test**: 测试相关
- **chore**: 构建、工具或辅助配置

### Scope 范围

根据修改的模块选择，例如：

- **core**: 核心功能
- **sync**: 同步功能
- **tray**: 系统托盘
- **todo**: 待办操作
- **groups**: 分组功能
- **app**: 应用配置
- **input**: 输入相关
- **readme**: README 文档
- **release**: 发布相关
- **init**: 项目初始化

### 示例

```bash
# 新功能
feat(sync): 实现 WebDAV 同步功能

# 错误修复
fix(todo): 修复当前分组中新待办聚焦和安装器配置

# 文档更新
docs(release): 添加中文发布规范

# 测试
test(core): 添加测试框架和核心功能单元测试

# 项目初始化
chore(init): 初始化项目
```

## 提交历史规范化

### 当前状态

项目早期存在重复提交（同一功能的英文和中文版本），需要清理和规范化。

### 规范化步骤

1. **创建备份分支**
   ```bash
   git branch backup-$(date +%Y%m%d)
   ```

2. **运行规范化脚本**
   ```bash
   bash rewrite-git-history.sh
   ```

3. **检查结果**
   ```bash
   git log --oneline -20
   ```

4. **强制推送到远程**（确认无误后）
   ```bash
   git push origin main --force
   ```

5. **如果有问题，恢复备份**
   ```bash
   git reset --hard backup-YYYYMMDD
   ```

### 重写后的标准历史

执行脚本后，历史提交将变为：

```
8b82c9e docs(release): 添加中文发布规范
decef2c fix(sync): 支持分组增量同步和软删除处理
b5265aa fix(sync): 优化同步提示换行显示
a84260a fix(todo): 修复当前分组中新待办聚焦和安装器配置
8bc0d96 fix(app): 更新图标资源、Tauri 配置与 UI 组件
0f035f6 fix(sync): 修复 WebDAV 同步逻辑并优化用户体验
6da785c test(core): 添加测试框架和核心功能单元测试
7beb483 feat(groups): 添加自定义分组功能
fbd5064 feat(sync): 实现 WebDAV 同步功能
e1cf83a docs(readme): 更新系统托盘功能说明
e9c7a0e feat(tray): 添加系统托盘功能和窗口关闭按钮
499a464 fix(input): 修复输入框和初始化问题
a71732d feat(core): 完成 v0.1.0 核心功能
055d0c8 chore(init): 初始化项目
```

所有重复的英文版本提交将被删除。

## 注意事项

⚠️ **重要警告**

- 重写历史会改变所有 commit 哈希值
- 如果远程仓库已有其他协作者，需要通知他们重新克隆仓库
- 执行前务必创建备份分支
- 建议在确认所有功能正常后再执行

## 后续维护

从现在开始，所有新提交都应严格遵循上述规范：

1. 提交前检查格式是否正确
2. 使用中文描述（而非英文）
3. 选择合适的 type 和 scope
4. 描述要简洁明了

### Git Hooks（可选）

可以配置 Git hooks 来自动检查提交格式：

```bash
# .git/hooks/commit-msg
#!/bin/bash
commit_msg=$(cat "$1")
pattern="^(feat|fix|docs|style|refactor|test|chore)\([a-z]+\): .+$"

if ! echo "$commit_msg" | grep -qE "$pattern"; then
    echo "❌ 提交信息格式不符合规范！"
    echo "格式：<type>(<scope>): <中文描述>"
    echo "示例：feat(sync): 实现 WebDAV 同步功能"
    exit 1
fi
```

## 参考资源

- [Conventional Commits](https://www.conventionalcommits.org/)
- [语义化版本](https://semver.org/lang/zh-CN/)
- 项目发布规范：[docs/RELEASE_STANDARD.md](docs/RELEASE_STANDARD.md)
