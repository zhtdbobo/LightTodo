import { useState, type ReactNode } from "react";
import { LocalBackup } from "../sync/LocalBackup";
import { WebDAVSettings } from "../sync/WebDAVSettings";
import { AboutPage } from "./AboutPage";
import { GeneralSettings } from "./GeneralSettings";
import { isMobileRuntime } from "../../platform";

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

interface SettingsPageProps {
  onBack?: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("sync");

  return (
    <div className={`settings-shell flex h-screen min-h-0 w-screen flex-row overflow-hidden bg-gray-50 text-gray-900 ${isMobileRuntime ? "mobile-app-shell" : ""}`}>
      <aside className="flex w-16 flex-shrink-0 flex-col border-r border-gray-200 bg-white py-3 sm:w-44 sm:py-5">
        <div className="flex flex-col items-center gap-2 px-1 pb-3 sm:block sm:px-3 sm:pb-5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center text-xl text-gray-500 sm:hidden"
              aria-label="返回待办"
            >
              ‹
            </button>
          )}
          <div className="hidden sm:block">
            <p className="text-lg font-semibold tracking-tight text-gray-900">设置</p>
            <p className="mt-0.5 text-xs text-gray-400">LightTodo</p>
          </div>
        </div>

        <nav aria-label="设置导航" className="flex flex-col gap-1 px-1 sm:px-3" role="tablist">
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
                className={`flex min-h-11 flex-shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center transition-colors sm:flex-row sm:gap-3 sm:px-3 sm:text-left ${
                  isActive
                    ? "bg-cyan-50 text-cyan-700"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                }`}
              >
                <span className={isActive ? "text-cyan-600" : "text-gray-400"}>
                  {item.icon}
                </span>
                <span className="min-w-0 truncate text-[11px] font-medium leading-none sm:text-sm sm:leading-snug">{item.label}</span>
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
