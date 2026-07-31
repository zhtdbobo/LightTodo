import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { emit } from "@tauri-apps/api/event";
import { render, screen } from "../../test-utils";
import { exportBackup, importBackup } from "./backup";
import { LocalBackup } from "./LocalBackup";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
}));

vi.mock("./backup", () => ({
  exportBackup: vi.fn(),
  importBackup: vi.fn(),
}));

describe("LocalBackup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("选择保存位置并导出完整备份", async () => {
    const user = userEvent.setup();
    vi.mocked(save).mockResolvedValue("D:\\Backup\\LightTodo.json");
    vi.mocked(exportBackup).mockResolvedValue({ noteCount: 12, groupCount: 3 });
    render(<LocalBackup />);

    await user.click(screen.getByRole("button", { name: "导出备份" }));

    expect(exportBackup).toHaveBeenCalledWith("D:\\Backup\\LightTodo.json");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "备份已导出：12 条待办，3 个分组"
    );
  });

  it("确认后导入备份并通知主窗口刷新", async () => {
    const user = userEvent.setup();
    vi.mocked(open).mockResolvedValue("D:\\Backup\\LightTodo.json");
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(importBackup).mockResolvedValue({ noteCount: 8, groupCount: 2 });
    render(<LocalBackup />);

    await user.click(screen.getByRole("button", { name: "导入备份" }));

    expect(confirm).toHaveBeenCalled();
    expect(importBackup).toHaveBeenCalledWith("D:\\Backup\\LightTodo.json");
    expect(emit).toHaveBeenCalledWith("local-backup-imported");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "备份已导入：8 条待办，2 个分组"
    );
  });
});
