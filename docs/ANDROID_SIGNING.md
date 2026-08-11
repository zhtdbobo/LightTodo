# Android 发布签名

LightTodo 的 Android Release APK 使用固定证书签名。后续版本必须继续使用同一 keystore，否则已安装用户无法覆盖升级。

## 本地备份

以下文件位于 Git 忽略的 `.android-signing/` 目录：

- `lighttodo-release.p12`：Release keystore，请额外备份到安全位置
- `lighttodo-signing.credential.xml`：由当前 Windows 用户加密的别名和密码
- `lighttodo-release-cert.pem`：公开证书

证书 SHA-256 指纹：

```text
EB:05:93:5E:ED:48:3E:51:7D:ED:2B:00:E4:6B:D2:CA:8C:01:3A:E8:F9:D3:75:E8:53:42:6D:25:78:81:A0:B5
```

## GitHub Actions Secrets

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Release 工作流会恢复 keystore，并通过 Gradle 的 `release` signing config 为各 ABI APK 签名。
