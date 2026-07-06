# 测试文档

## 测试框架

### 单元测试 - Vitest
- **配置文件**: [vitest.config.ts](vitest.config.ts)
- **测试环境**: jsdom (模拟浏览器环境)
- **测试覆盖率**: v8

### E2E 测试 - Playwright
- **配置文件**: [playwright.config.ts](playwright.config.ts)
- **测试目录**: `e2e/`
- **基础 URL**: `http://localhost:1420`

## 测试文件结构

```
src/
├── setupTests.ts              # 测试环境配置
├── test-utils.tsx             # React 测试工具
├── features/
│   ├── notes/
│   │   ├── hooks/
│   │   │   ├── useNotes.test.ts      # Notes API 测试
│   │   │   └── useGroups.test.ts     # Groups API 测试
│   │   └── stores/
│   │       └── notesStore.test.ts    # Zustand Store 测试
│   └── sync/
│       └── api.test.ts               # WebDAV 同步测试
e2e/
├── todo-operations.spec.ts    # 待办操作 E2E 测试
├── groups.spec.ts             # 分组功能 E2E 测试
└── system-tray.spec.ts        # 系统托盘 E2E 测试
```

## 测试命令

### 运行所有单元测试
```bash
pnpm run test
```

### 监听模式
```bash
pnpm run test:watch
```

### 生成覆盖率报告
```bash
pnpm run test:coverage
```

### 运行 E2E 测试
```bash
pnpm run test:e2e
```

## 测试覆盖范围

### 1. Notes API 测试 (`useNotes.test.ts`)
✅ Case 转换工具（camelCase ↔ snake_case）
✅ 获取所有笔记
✅ 根据 ID 获取笔记
✅ 创建笔记
✅ 更新笔记
✅ 删除笔记
✅ 搜索笔记
✅ 获取标签

### 2. Groups API 测试 (`useGroups.test.ts`)
✅ 获取所有分组
✅ 创建分组
✅ 更新分组
✅ 删除分组

### 3. Notes Store 测试 (`notesStore.test.ts`)
✅ 初始化状态
✅ 设置笔记列表
✅ 添加笔记
✅ 更新笔记
✅ 删除笔记
✅ 设置选中笔记
✅ 删除时清除选中状态
✅ 搜索查询
✅ 筛选标签
✅ 加载状态

### 4. WebDAV 同步测试 (`api.test.ts`)
✅ 连接测试
✅ 连接失败处理
✅ 上传数据
✅ 下载数据
✅ 保存配置
✅ 读取配置
✅ 清除配置

### 5. E2E 测试（待实际运行）
📝 待办基本操作（添加、完成、删除、编辑）
📝 清空已完成
📝 自定义分组（创建、重命名、删除、移动待办）
📝 未分类保护
📝 系统托盘功能

## 测试结果

**单元测试**: ✅ 33 个测试全部通过
```
Test Files  4 passed (4)
Tests       33 passed (33)
Duration    2.91s
```

## Mock 配置

### Tauri API Mock
```typescript
vi.mock('@tauri-apps/api', () => ({
  invoke: vi.fn(),
}))
```

### localStorage Mock
```typescript
global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}
```

### fetch Mock
```typescript
global.fetch = vi.fn()
```

## 注意事项

1. **E2E 测试需要单独运行**: Playwright 测试不在 `pnpm run test` 中运行，需使用 `pnpm run test:e2e`

2. **Vitest 配置排除 e2e 目录**: E2E 测试文件被排除在单元测试外

3. **自动清理**: 每个测试后自动调用 `cleanup()` 清理 React 组件

4. **测试隔离**: 每个测试前清除 localStorage 和 mock 状态

## 下一步

- [ ] 运行 E2E 测试验证完整用户流程
- [ ] 增加组件级测试（如果有自定义组件）
- [ ] 设置 CI/CD 自动运行测试
- [ ] 提高测试覆盖率到 80%+
