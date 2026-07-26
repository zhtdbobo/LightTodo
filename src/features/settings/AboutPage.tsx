import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type MouseEvent } from "react";
import appIcon from "../../../src-tauri/icons/icon-source.svg";
import packageInfo from "../../../package.json";

const repositoryUrl = "https://github.com/zhtdbobo/LightTodo";
const latestReleaseUrl = "https://api.github.com/repos/zhtdbobo/LightTodo/releases/latest";
const downloadBaseUrl = "https://gh-proxy.com/github.com/zhtdbobo/LightTodo/releases/download";

type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "latest"; version: string }
  | { state: "available"; version: string; downloadUrl: string }
  | { state: "error"; message: string };

function normalizeVersion(tagName: unknown) {
  if (typeof tagName !== "string") return null;
  return tagName.match(/^v?(\d+\.\d+\.\d+)$/)?.[1] ?? null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
  const latest = latestVersion.split(".").map(Number);
  const current = currentVersion.split(".").map(Number);

  for (let index = 0; index < Math.max(latest.length, current.length); index += 1) {
    const latestPart = latest[index] ?? 0;
    const currentPart = current[index] ?? 0;
    if (latestPart !== currentPart) return latestPart > currentPart;
  }

  return false;
}

function createDownloadUrl(version: string) {
  return `${downloadBaseUrl}/v${version}/LightTodo_${version}_x64-setup.exe`;
}

export function AboutPage() {
  const [openLinkError, setOpenLinkError] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });

  const handleOpenRepository = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setOpenLinkError("");

    try {
      await openUrl(repositoryUrl);
    } catch (error) {
      console.error("打开项目主页失败", error);
      setOpenLinkError("无法打开项目主页，请稍后重试。");
    }
  };

  const handleCheckForUpdates = async () => {
    setUpdateStatus({ state: "checking" });

    try {
      const response = await fetch(latestReleaseUrl, {
        cache: "no-store",
        headers: { Accept: "application/vnd.github+json" },
      });

      if (!response.ok) {
        throw new Error(`GitHub API 返回 ${response.status}`);
      }

      const release = (await response.json()) as { tag_name?: unknown };
      const latestVersion = normalizeVersion(release.tag_name);
      if (!latestVersion) {
        throw new Error("最新 Release 的版本号格式无效");
      }

      if (isNewerVersion(latestVersion, packageInfo.version)) {
        setUpdateStatus({
          state: "available",
          version: latestVersion,
          downloadUrl: createDownloadUrl(latestVersion),
        });
      } else {
        setUpdateStatus({ state: "latest", version: latestVersion });
      }
    } catch (error) {
      console.error("检查更新失败", error);
      setUpdateStatus({ state: "error", message: "检查更新失败，请确认网络连接后重试。" });
    }
  };

  const handleDownloadUpdate = async () => {
    if (updateStatus.state !== "available") return;

    try {
      await openUrl(updateStatus.downloadUrl);
    } catch (error) {
      console.error("打开更新下载地址失败", error);
      setUpdateStatus({ state: "error", message: "无法打开下载地址，请稍后重试。" });
    }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-8 py-10">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-cyan-50 shadow-sm ring-1 ring-cyan-100">
          <img src={appIcon} alt="LightTodo 图标" className="h-14 w-14" />
        </div>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-gray-900">
          LightTodo
        </h2>
        <p className="mt-1 text-sm text-gray-500">版本 {packageInfo.version}</p>
        <p className="mt-4 max-w-md text-sm leading-6 text-gray-600">
          一个轻量、简洁且支持 WebDAV 同步的待办事项应用，帮助你专注记录和完成真正重要的事。
        </p>
      </div>

      <div className="mt-9 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-50 text-lg"
            >
              ☁️
            </span>
            <div>
              <h3 className="text-sm font-medium text-gray-800">本地优先</h3>
              <p className="mt-0.5 text-xs leading-5 text-gray-500">
                数据保存在本地，可选 WebDAV 多端同步
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-50 text-lg"
            >
              🪶
            </span>
            <div>
              <h3 className="text-sm font-medium text-gray-800">轻巧高效</h3>
              <p className="mt-0.5 text-xs leading-5 text-gray-500">
                基于 Tauri 构建，快速启动、低资源占用
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white px-5">
        <div className="flex items-center justify-between gap-4 py-4 text-sm">
          <span className="text-gray-500">开源许可</span>
          <span className="font-medium text-gray-800">MIT License</span>
        </div>
        <div className="flex items-center justify-between gap-4 py-4 text-sm">
          <span className="text-gray-500">项目主页</span>
          <a
            href={repositoryUrl}
            onClick={handleOpenRepository}
            className="font-medium text-cyan-600 transition-colors hover:text-cyan-700 hover:underline"
          >
            GitHub
          </a>
        </div>
        <div className="flex items-center justify-between gap-4 py-4 text-sm">
          <div>
            <span className="text-gray-500">软件更新</span>
            {updateStatus.state === "latest" && (
              <p role="status" className="mt-1 text-xs text-emerald-600">
                当前已是最新版本 v{updateStatus.version}
              </p>
            )}
            {updateStatus.state === "available" && (
              <p role="status" className="mt-1 text-xs text-cyan-600">
                发现新版本 v{updateStatus.version}
              </p>
            )}
            {updateStatus.state === "error" && (
              <p role="alert" className="mt-1 text-xs text-red-600">
                {updateStatus.message}
              </p>
            )}
          </div>

          {updateStatus.state === "available" ? (
            <button
              type="button"
              onClick={handleDownloadUpdate}
              className="flex-shrink-0 rounded-lg bg-cyan-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-cyan-700"
            >
              下载 v{updateStatus.version}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCheckForUpdates}
              disabled={updateStatus.state === "checking"}
              className="flex-shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 transition-colors hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-700 disabled:cursor-wait disabled:opacity-60"
            >
              {updateStatus.state === "checking" ? "正在检查…" : "检查更新"}
            </button>
          )}
        </div>
      </div>

      {openLinkError && (
        <p role="alert" className="mt-3 text-center text-xs text-red-600">
          {openLinkError}
        </p>
      )}

      <p className="mt-auto pt-10 text-center text-xs text-gray-400">
        © 2026 zhtdbobo · 用心做好每一件小事
      </p>
    </div>
  );
}
