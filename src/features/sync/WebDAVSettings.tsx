import { useState, useEffect, useRef } from "react";
import {
  getWebDAVConfig,
  saveWebDAVConfig,
  testWebDAVConnection,
  type WebDAVConfig,
} from "../sync/api";
import { listen } from "@tauri-apps/api/event";
import { isMobileRuntime } from "../../platform";

export function WebDAVSettings() {
  const [config, setConfig] = useState<WebDAVConfig>({
    url: "",
    username: "",
    password: "",
    has_password: false,
    clear_password: false,
    enabled: false,
    auto_sync: false,
    directory: "LightTodo",
  });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const loadRequestRef = useRef(0);

  useEffect(() => {
    loadConfig();

    // 监听配置变化，实时刷新
    const unlisten = listen("webdav-config-changed", () => {
      loadConfig();
    });

    return () => {
      void unlisten
        .then((fn) => fn())
        .catch((error) => console.error("Failed to stop WebDAV config listener:", error));
    };
  }, []);

  const loadConfig = async () => {
    const requestId = ++loadRequestRef.current;
    try {
      const savedConfig = await getWebDAVConfig();
      if (savedConfig && requestId === loadRequestRef.current) {
        setConfig({ ...savedConfig, password: "", clear_password: false });
      }
    } catch (error) {
      console.error("Failed to load config:", error);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage("");
    try {
      await saveWebDAVConfig(config);
      await loadConfig();
      const { emit } = await import("@tauri-apps/api/event");
      await emit("webdav-config-changed");
      setMessage("配置已保存");

      // 如果启用了自动同步，通知主窗口重新启动定时器
      if (config.enabled && config.auto_sync) {
        setMessage("配置已保存，自动同步已启用（每5分钟同步一次）");
      }

      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      setMessage(`保存失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!config.url || !config.username || (!config.password && !config.has_password)) {
      setMessage("请填写完整的 WebDAV 信息");
      return;
    }

    setTesting(true);
    setMessage("");
    try {
      const success = await testWebDAVConnection(
        config.url,
        config.username,
        config.password
      );
      setMessage(success ? "✓ 连接成功" : "✗ 连接失败");
    } catch (error) {
      setMessage(`✗ 连接失败: ${error}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl p-8">
      <div className="mb-7">
        <h2 className="settings-content-title text-2xl font-semibold tracking-tight text-gray-900">同步</h2>
        <p className="mt-1 text-sm text-gray-500">配置 WebDAV，让待办数据安全地在设备间同步。</p>
      </div>

      <div className="space-y-4">
        {/* WebDAV URL */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            WebDAV 地址
          </label>
          <input
            type="text"
            value={config.url}
            onChange={(e) => setConfig({ ...config, url: e.target.value })}
            placeholder="https://dav.jianguoyun.com/dav"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            坚果云示例: https://dav.jianguoyun.com/dav
          </p>
        </div>

        {/* 同步目录 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            同步目录
          </label>
          <input
            type="text"
            value={config.directory}
            onChange={(e) =>
              setConfig({ ...config, directory: e.target.value })
            }
            placeholder="LightTodo"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            数据将保存在 WebDAV 根目录下的此文件夹中
          </p>
        </div>

        {/* 用户名 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            用户名
          </label>
          <input
            type="text"
            value={config.username}
            onChange={(e) =>
              setConfig({ ...config, username: e.target.value })
            }
            placeholder="username"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>

        {/* 密码 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            密码
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={config.password}
              onChange={(e) =>
                setConfig({
                  ...config,
                  password: e.target.value,
                  clear_password: false,
                })
              }
              placeholder={config.has_password ? "密码已安全保存；留空表示不修改" : "password"}
              autoComplete={isMobileRuntime ? "current-password" : undefined}
              autoCapitalize={isMobileRuntime ? "none" : undefined}
              spellCheck={isMobileRuntime ? false : undefined}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>
          {config.has_password && !config.clear_password && (
            <button
              type="button"
              onClick={() => setConfig({
                ...config,
                password: "",
                has_password: false,
                clear_password: true,
                enabled: false,
                auto_sync: false,
              })}
              className="mt-1 text-xs text-red-500 hover:text-red-600"
            >
              清除已保存密码
            </button>
          )}
        </div>

        {/* 开关 */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({
                ...config,
                enabled: e.target.checked,
                auto_sync: e.target.checked ? config.auto_sync : false,
              })}
              className="w-4 h-4"
            />
            <span className="text-sm text-gray-700">启用 WebDAV 同步</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.auto_sync}
              onChange={(e) =>
                setConfig({ ...config, auto_sync: e.target.checked })
              }
              disabled={!config.enabled}
              className="w-4 h-4 disabled:opacity-50"
            />
            <span className="text-sm text-gray-700">自动同步（每5分钟）</span>
          </label>
        </div>

        {/* 按钮组 */}
        <div className="flex gap-3 pt-4">
          <button
            onClick={handleTest}
            disabled={testing || !config.url}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {testing ? "测试中..." : "测试连接"}
          </button>

          <button
            onClick={handleSave}
            disabled={loading}
            className="px-4 py-2 bg-cyan-500 text-white rounded-md hover:bg-cyan-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "保存中..." : "保存配置"}
          </button>
        </div>

        {/* 消息提示 */}
        {message && (
          <div
            className={`p-3 rounded-md text-sm ${
              message.startsWith("✓")
                ? "bg-green-100 text-green-800"
                : message.startsWith("✗")
                ? "bg-red-100 text-red-800"
                : "bg-blue-100 text-blue-800"
            }`}
          >
            {message}
          </div>
        )}

        {/* 最后同步时间 */}
        {config.last_sync && (
          <div className="text-xs text-gray-500 pt-2">
            最后同步: {new Date(
              config.last_sync < 100_000_000_000
                ? config.last_sync * 1000
                : config.last_sync
            ).toLocaleString("zh-CN")}
          </div>
        )}
      </div>

      {/* 说明 */}
      <div className="mt-8 p-4 bg-gray-50 rounded-md">
        <h3 className="font-medium text-gray-800 mb-2">使用说明</h3>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• 支持标准 WebDAV 协议的云存储服务</li>
          <li>• 推荐使用: 坚果云、Nextcloud、ownCloud 等</li>
          <li>
            • <strong>坚果云配置</strong>：
            <ul className="ml-4 mt-1">
              <li>- WebDAV 地址: https://dav.jianguoyun.com/dav</li>
              <li>- 用户名: 你的邮箱</li>
              <li>- 密码: 在坚果云网页版"账户信息" → "安全选项" → "第三方应用管理"中生成应用密码</li>
              <li>- 同步目录: LightTodo（会自动在坚果云根目录创建）</li>
            </ul>
          </li>
          <li>• 同步索引：<code>{config.directory}/manifest.json</code></li>
          <li>• 待办文件：<code>{config.directory}/notes/&lt;ID&gt;.json</code></li>
          <li>• 分组文件：<code>{config.directory}/groups/&lt;ID&gt;.json</code></li>
        </ul>

        <h3 className="font-medium text-gray-800 mb-2 mt-4">同步说明</h3>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• 同步功能位于主界面底部，包含三种模式：</li>
          <li className="ml-4">- <strong>⬇️ 从云端下载</strong>：仅下载云端有变化的待办和分组</li>
          <li className="ml-4">- <strong>⬆️ 上传到云端</strong>：仅上传本地有变化的待办和分组</li>
          <li className="ml-4">- <strong>🔄 双向同步</strong>：按更新时间和文件哈希智能合并变化</li>
          <li className="ml-4">- 同步索引保存在 <code>manifest.json</code>，无变化时不会重复传输数据</li>
          <li>• <strong>自动同步</strong>：启用后，应用启动时自动同步，之后每5分钟自动同步一次</li>
          <li className="text-amber-700">⚠️ 建议首次同步时先备份数据</li>
        </ul>
      </div>
    </div>
  );
}
