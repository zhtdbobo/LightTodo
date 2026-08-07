import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../../test-utils";

vi.mock("../../platform", () => ({ isMobileRuntime: true }));
vi.mock("../sync/WebDAVSettings", () => ({ WebDAVSettings: () => <div>同步内容</div> }));
vi.mock("../sync/LocalBackup", () => ({ LocalBackup: () => <div>备份内容</div> }));
vi.mock("./GeneralSettings", () => ({ GeneralSettings: () => <div>常规内容</div> }));
vi.mock("./AboutPage", () => ({ AboutPage: () => <div>关于内容</div> }));

import { SettingsPage } from "./SettingsPage";

describe("SettingsPage mobile drawer", () => {
  it("通过三横按钮打开抽屉，选择菜单后进入界面并关闭抽屉", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsPage />);

    const drawer = container.querySelector("#settings-drawer");
    expect(drawer).not.toBeNull();
    expect(drawer).toHaveAttribute("aria-hidden", "true");

    await user.click(screen.getByRole("button", { name: "打开设置菜单" }));
    expect(drawer).toHaveAttribute("aria-hidden", "false");

    await user.click(screen.getByRole("tab", { name: "常规" }));
    expect(screen.getByText("常规内容")).toBeInTheDocument();
    expect(drawer).toHaveAttribute("aria-hidden", "true");
  });

  it("仅通过三横按钮切换抽屉，不显示滑动提示和返回入口", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    expect(screen.queryByText(/从屏幕左边缘/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回待办" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开设置菜单" }));
    await user.click(screen.getByRole("button", { name: "关闭设置菜单" }));

    expect(screen.getByRole("button", { name: "打开设置菜单" })).toHaveAttribute("aria-expanded", "false");
  });

  it("通过顶部关闭按钮返回待办首页", async () => {
    const user = userEvent.setup();
    window.location.hash = "settings";
    render(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: "关闭设置" }));

    expect(window.location.hash).toBe("");
  });
});
