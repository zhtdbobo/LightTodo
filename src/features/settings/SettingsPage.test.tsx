import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import packageInfo from "../../../package.json";
import { render, screen } from "../../test-utils";
import { SettingsPage } from "./SettingsPage";

vi.mock("../sync/WebDAVSettings", () => ({
  WebDAVSettings: () => <div>同步配置内容</div>,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("检查到新版本后使用代理地址下载对应版本", async () => {
    const user = userEvent.setup();
    const [major, minor, patch] = packageInfo.version.split(".").map(Number);
    const latestVersion = `${major}.${minor}.${patch + 1}`;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: `v${latestVersion}` }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /关于/ }));
    await user.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText(`发现新版本 v${latestVersion}`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `下载 v${latestVersion}` }));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/zhtdbobo/LightTodo/releases/latest",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(openUrl).toHaveBeenCalledWith(
      `https://gh-proxy.com/github.com/zhtdbobo/LightTodo/releases/download/v${latestVersion}/LightTodo_${latestVersion}_x64-setup.exe`,
    );
  });

  it("没有新版本时提示当前已是最新版", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: `v${packageInfo.version}` }),
    }));
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /关于/ }));
    await user.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText(`当前已是最新版本 v${packageInfo.version}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /下载 v/ })).not.toBeInTheDocument();
  });
});
