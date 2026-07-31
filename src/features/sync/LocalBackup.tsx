import { useState } from "react";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { emit } from "@tauri-apps/api/event";
import { exportBackup, importBackup } from "./backup";

const backupFilter = [{ name: "LightTodo 备份", extensions: ["json"] }];

const backupFileName = () => {
  const date = new Date();
  const value = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return `LightTodo-backup-${value}.json`;
};

export function LocalBackup() {
  const [operation, setOperation] = useState<"export" | "import" | null>(null);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const showError = (label: string, error: unknown) => {
    setIsError(true);
    setMessage(`${label}失败：${error instanceof Error ? error.message : String(error)}`);
  };

  const handleExport = async () => {
    try {
      const path = await save({
        defaultPath: backupFileName(),
        filters: backupFilter,
        title: "导出 LightTodo 备份",
      });
      if (!path) return;

      setOperation("export");
      setMessage("");
      setIsError(false);
      const result = await exportBackup(path);
      setMessage(`备份已导出：${result.noteCount} 条待办，${result.groupCount} 个分组`);
    } catch (error) {
      showError("导出", error);
    } finally {
      setOperation(null);
    }
  };

  const handleImport = async () => {
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: backupFilter,
        title: "导入 LightTodo 备份",
      });
      if (!path || Array.isArray(path)) return;

      const approved = await confirm(
        "导入会用备份内容替换当前全部待办和分组。此操作无法撤销，是否继续？",
        { title: "确认导入备份", kind: "warning", okLabel: "继续导入", cancelLabel: "取消" }
      );
      if (!approved) return;

      setOperation("import");
      setMessage("");
      setIsError(false);
      const result = await importBackup(path);
      await emit("local-backup-imported");
      setMessage(`备份已导入：${result.noteCount} 条待办，${result.groupCount} 个分组`);
    } catch (error) {
      showError("导入", error);
    } finally {
      setOperation(null);
    }
  };

  return (
    <section className="mt-8 border-t border-gray-200 pt-7" aria-labelledby="local-backup-title">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 id="local-backup-title" className="font-medium text-gray-900">本地备份</h3>
        <p className="mt-1 text-sm leading-6 text-gray-500">
          将全部待办和分组导出为 JSON 文件，或从备份文件完整恢复。
        </p>
        <p className="mt-2 text-xs leading-5 text-amber-700">
          备份文件包含密码条目的明文内容，请保存到安全位置，不要公开分享。
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={operation !== null}
            className="rounded-md bg-cyan-500 px-4 py-2 text-sm text-white transition-colors hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {operation === "export" ? "正在导出…" : "导出备份"}
          </button>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={operation !== null}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
          >
            {operation === "import" ? "正在导入…" : "导入备份"}
          </button>
        </div>

        {message && (
          <p
            role="status"
            className={`mt-4 rounded-md px-3 py-2 text-sm ${
              isError ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
            }`}
          >
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
