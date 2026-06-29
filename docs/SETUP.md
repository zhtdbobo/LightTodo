# LightTodo 开发环境搭建指南

## 当前状态

✅ Flutter 3.44.4 已安装  
✅ Windows 11 专业版  
✅ Chrome 已安装（Web 开发）  
⚠️ 需要安装 Visual Studio（Windows 桌面开发）  
❌ Android SDK（可选，暂不需要）

## 安装 Visual Studio

### 1. 下载 Visual Studio 2022 Community

访问：https://visualstudio.microsoft.com/zh-hans/downloads/

选择 **Visual Studio 2022 Community**（免费版）

### 2. 安装步骤

1. 运行安装程序
2. 在"工作负载"选项卡中，勾选：
   - ✅ **使用 C++ 的桌面开发**
3. 在右侧"安装详细信息"中，确保包含：
   - Windows SDK
   - MSVC C++ 生成工具
4. 点击"安装"（大约需要 5-10 GB 空间）

### 3. 验证安装

安装完成后，运行：

```bash
flutter doctor
```

应该看到 Visual Studio 项变为 ✅

### 4. 启用 Windows 桌面支持

```bash
flutter config --enable-windows-desktop
```

## 验证环境

```bash
# 查看所有支持的平台
flutter devices

# 应该看到 Windows 平台可用
```

## 开始开发

环境搭建完成后，运行：

```bash
cd d:\git\Util_type\LightTodo
flutter create .
```

这将初始化 Flutter 项目。

---

**注意**：
- Android SDK 不是必需的（我们只开发桌面端）
- 网络错误可以忽略（maven.google.com 是 Android 相关的）
- Visual Studio 安装可能需要 30-60 分钟
