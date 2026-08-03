import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import packageInfo from "../../../package.json";
import { render, screen } from "../../test-utils";
import { SettingsPage } from "./SettingsPage";

vi.mock("../sync/WebDAVSettings", () => ({
  WebDAVSettings: () => <div>同步配置内容</div>,
}));

vi.mock("../sync/LocalBackup", () => ({
  LocalBackup: () => <div>本地备份内容</div>,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("默认展示同步界面，并可切换到关于界面", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    expect(screen.getByRole("tabpanel", { name: "同步设置" })).toBeInTheDocument();
    expect(screen.getByText("同步配置内容")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /同步/ })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: /关于/ }));

    expect(screen.getByRole("tabpanel", { name: "关于 LightTodo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "LightTodo" })).toBeInTheDocument();
    expect(screen.getByText(`版本 ${packageInfo.version}`)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /关于/ })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("link", { name: "GitHub" }));

    expect(openUrl).toHaveBeenCalledWith("https://github.com/zhtdbobo/LightTodo");
  });

  it("将备份作为独立设置选项展示", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: "备份" }));

    expect(screen.getByRole("tabpanel", { name: "备份设置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "备份" })).toBeInTheDocument();
    expect(screen.getByText("本地备份内容")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "备份" })).toHaveAttribute("aria-selected", "true");
  });

  it("每次启动时默认开启打开窗口展开今日分组，可在常规设置中切换", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_expand_today_on_open") return true;
      return undefined;
    });
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /常规/ }));

    const toggle = await screen.findByRole("switch", { name: "打开窗口时展开今日分组" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);

    expect(invoke).toHaveBeenCalledWith("set_expand_today_on_open", { enabled: false });
    expect(emit).toHaveBeenCalledWith("expand-today-on-open-changed", false);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("检查到新版本后在应用内下载、安装并重启", async () => {
    const user = userEvent.setup();
    const [major, minor, patch] = packageInfo.version.split(".").map(Number);
    const latestVersion = `${major}.${minor}.${patch + 1}`;
    let finishDownload = () => {};
    const downloadAndInstall = vi.fn(async (onEvent?: (event: DownloadEvent) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
      await new Promise<void>((resolve) => {
        finishDownload = resolve;
      });
      onEvent?.({ event: "Finished" });
    });
    vi.mocked(check).mockResolvedValue({
      version: latestVersion,
      downloadAndInstall,
    } as unknown as Update);
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /关于/ }));
    await user.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText(`发现新版本 v${latestVersion}`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `下载并安装 v${latestVersion}` }));

    expect(await screen.findByText("正在下载 40%")).toBeInTheDocument();
    expect(check).toHaveBeenCalledWith({ timeout: 30_000 });
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(openUrl).not.toHaveBeenCalled();

    finishDownload();

    expect(await screen.findByText(`正在安装 v${latestVersion}…`)).toBeInTheDocument();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("没有新版本时提示当前已是最新版", async () => {
    const user = userEvent.setup();
    vi.mocked(check).mockResolvedValue(null);
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /关于/ }));
    await user.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText(`当前已是最新版本 v${packageInfo.version}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /下载并安装 v/ })).not.toBeInTheDocument();
  });
});
