import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function GeneralSettings() {
  const [expandTodayOnOpen, setExpandTodayOnOpen] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let disposed = false;

    void invoke<boolean>("get_expand_today_on_open")
      .then((enabled) => {
        if (!disposed && typeof enabled === "boolean") {
          setExpandTodayOnOpen(enabled);
        }
      })
      .catch((error) => console.error("Failed to load UI preferences:", error));

    return () => {
      disposed = true;
    };
  }, []);

  const handleToggle = async () => {
    const enabled = !expandTodayOnOpen;
    setExpandTodayOnOpen(enabled);
    setIsSaving(true);

    try {
      await invoke("set_expand_today_on_open", { enabled });
      const { emit } = await import("@tauri-apps/api/event");
      await emit("expand-today-on-open-changed", enabled);
    } catch (error) {
      setExpandTodayOnOpen(!enabled);
      console.error("Failed to save UI preferences:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-gray-900">常规</h1>
        <p className="mt-1 text-sm text-gray-500">调整窗口每次打开时的显示方式。</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex items-center justify-between gap-6">
          <div>
            <label htmlFor="expand-today-on-open" className="text-sm font-medium text-gray-800">
              打开窗口时展开今日分组
            </label>
            <p className="mt-1 text-xs leading-5 text-gray-400">
              每次启动应用时此选项都会恢复为开启。
            </p>
          </div>
          <button
            id="expand-today-on-open"
            type="button"
            role="switch"
            aria-checked={expandTodayOnOpen}
            aria-label="打开窗口时展开今日分组"
            disabled={isSaving}
            onClick={() => void handleToggle()}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-60 ${
              expandTodayOnOpen ? "bg-cyan-500" : "bg-gray-300"
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                expandTodayOnOpen ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
