# React Grab 集成文档

## 简介

已为 LightTodo 项目集成 [react-grab](https://github.com/aidenybai/react-grab) - 一个用于检查和调试 React 组件的开发工具。

## 安装的包

- `react-grab` - GUI 调试工具
- `@types/node` - Node 类型定义（构建依赖）

## 使用方法

### 激活调试工具

**方法 1：快捷键**
- 按下 `Alt + Shift + G` 激活/关闭 react-grab

**方法 2：UI 按钮**
- 点击底部工具栏的 🔍 图标

### 功能特性

react-grab 提供以下调试功能：

1. **元素检查**
   - 悬停在任何 React 组件上查看组件信息
   - 显示组件名称、props、state

2. **源码定位**
   - 点击组件跳转到源代码位置

3. **组件树**
   - 查看完整的 React 组件层次结构

4. **实时编辑**
   - 在浏览器中实时修改组件 props 和 state

## 配置

在 [src/App.tsx](src/App.tsx) 中的配置：

```typescript
import { init as initReactGrab } from "react-grab";

// 初始化配置
grabApiRef.current = initReactGrab({
  activationMode: 'keyboard' as any,  // 使用快捷键激活
  theme: {
    background: 'rgba(6, 182, 212, 0.1)',  // 青色半透明背景
    border: '2px solid rgb(6, 182, 212)',   // 青色边框
  }
});
```

## 集成位置

- **导入**: [src/App.tsx:9](src/App.tsx#L9)
- **初始化**: [src/App.tsx:67-73](src/App.tsx#L67-L73)
- **切换按钮**: [src/App.tsx:933-943](src/App.tsx#L933-L943)

## 注意事项

1. **仅用于开发**: react-grab 仅在开发模式下使用，生产构建时应该被排除

2. **快捷键冲突**: 确保 `Alt + Shift + G` 不与其他应用快捷键冲突

3. **性能影响**: 调试工具激活时可能影响性能，使用完毕后记得关闭

## 常见问题

**Q: 快捷键不工作？**
A: 确保焦点在应用窗口内，不在系统托盘或其他窗口

**Q: 如何完全禁用？**
A: 移除相关代码或设置 `window.__REACT_GRAB_DISABLED__ = true`

**Q: 在生产环境中会运行吗？**
A: 不会，只要在生产构建中排除 react-grab 依赖即可

## 相关链接

- [react-grab GitHub](https://github.com/aidenybai/react-grab)
- [react-grab 文档](https://github.com/aidenybai/react-grab#readme)
