import { useState, type ReactNode } from "react";
import { LocalBackup } from "../sync/LocalBackup";
import { WebDAVSettings } from "../sync/WebDAVSettings";
import { AboutPage } from "./AboutPage";
import { GeneralSettings } from "./GeneralSettings";

type SettingsSection = "general" | "sync" | "backup" | "about";

interface NavigationItem {
  id: SettingsSection;
  label: string;
  icon: ReactNode;
}

const navigationItems: NavigationItem[] = [
  {
    id: "general",
    label: "常规",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M7 12h10M9 18h6" />
        <circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="14" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="11" cy="18" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "sync",
    label: "同步",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7h-7.5a4.5 4.5 0 0 0-4.24 3M4 17h7.5a4.5 4.5 0 0 0 4.24-3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m17 4 3 3-3 3M7 14l-3 3 3 3" />
      </svg>
    ),
  },
  {
    id: "backup",
    label: "备份",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.5h16v11H4zM7 4.5h10l3 3H4z" />
        <path strokeLinecap="round" d="M9 12h6M12 9v6" />
      </svg>
    ),
  },
  {
    id: "about",
    label: "关于",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 10.5v5" />
        <circle cx="12" cy="7.5" r=".75" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("sync");

  return (
    <div className="flex h-screen min-h-0 w-screen overflow-hidden bg-gray-50 text-gray-900">
      <aside className="flex w-44 flex-shrink-0 flex-col border-r border-gray-200 bg-white px-3 py-5">
        <div className="px-3 pb-5">
          <p className="text-lg font-semibold tracking-tight text-gray-900">设置</p>
          <p className="mt-1 text-xs text-gray-400">LightTodo</p>
        </div>

        <nav aria-label="设置导航" className="space-y-1" role="tablist">
          {navigationItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`settings-panel-${item.id}`}
                onClick={() => setActiveSection(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? "bg-cyan-50 text-cyan-700"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                }`}
              >
                <span className={isActive ? "text-cyan-600" : "text-gray-400"}>
                  {item.icon}
                </span>
                <span className="min-w-0 truncate text-sm font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <section
          id={`settings-panel-${activeSection}`}
          role="tabpanel"
          aria-label={
            activeSection === "general"
              ? "常规设置"
              : activeSection === "sync"
                ? "同步设置"
                : activeSection === "backup"
                  ? "备份设置"
                  : "关于 LightTodo"
          }
          className="min-h-full"
        >
          {activeSection === "general" ? (
            <GeneralSettings />
          ) : activeSection === "sync" ? (
            <WebDAVSettings />
          ) : activeSection === "backup" ? (
            <div className="mx-auto w-full max-w-2xl p-8">
              <div className="mb-7">
                <h2 className="text-2xl font-semibold tracking-tight text-gray-900">备份</h2>
              </div>
              <LocalBackup />
            </div>
          ) : (
            <AboutPage />
          )}
        </section>
      </main>
    </div>
  );
}
