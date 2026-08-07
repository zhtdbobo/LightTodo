import { useEffect, useState, type ReactNode } from "react";
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

interface SettingsNavigationProps {
  activeSection: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  tabIndex?: number;
}

function SettingsNavigation({ activeSection, onSelect, tabIndex }: SettingsNavigationProps) {
  return (
    <nav aria-label="设置导航" className="flex flex-col gap-1" role="tablist">
      {navigationItems.map((item) => {
        const isActive = activeSection === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            tabIndex={tabIndex}
            aria-selected={isActive}
            aria-controls={`settings-panel-${item.id}`}
            onClick={() => onSelect(item.id)}
            className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
              isActive
                ? "bg-cyan-50 text-cyan-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
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
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("sync");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDrawerOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawerOpen]);

  const handleSectionSelect = (section: SettingsSection) => {
    setActiveSection(section);
    if (isMobileRuntime) setIsDrawerOpen(false);
  };

  const activeLabel = navigationItems.find((item) => item.id === activeSection)?.label ?? "设置";

  return (
    <div
      className={`settings-shell relative flex h-screen min-h-0 w-screen overflow-hidden bg-gray-50 text-gray-900 ${isMobileRuntime ? "mobile-app-shell flex-col" : "flex-row"}`}
    >
      {isMobileRuntime ? (
        <>
          <header className="flex min-h-14 flex-shrink-0 items-center border-b border-gray-200 bg-white px-5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-gray-900">{activeLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                window.location.hash = "";
              }}
              className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center text-xl text-gray-500 active:text-gray-900"
              aria-label="关闭设置"
              title="关闭设置"
            >
              ✕
            </button>
          </header>

          <button
            type="button"
            aria-label="点击遮罩关闭设置菜单"
            tabIndex={isDrawerOpen ? 0 : -1}
            onClick={() => setIsDrawerOpen(false)}
            className={`absolute inset-0 z-30 bg-black/30 transition-opacity duration-200 ${
              isDrawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            }`}
          />

          <aside
            id="settings-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="设置菜单"
            aria-hidden={!isDrawerOpen}
            className={`settings-drawer-safe-area absolute bottom-0 left-0 top-0 z-40 flex w-[min(68vw,15rem)] flex-col bg-white shadow-2xl transition-transform duration-200 ease-out ${
              isDrawerOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="border-b border-gray-100 px-5 pb-5">
              <p className="text-lg font-semibold text-gray-900">设置</p>
              <p className="mt-1 text-xs text-gray-400">LightTodo</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <SettingsNavigation
                activeSection={activeSection}
                onSelect={handleSectionSelect}
                tabIndex={isDrawerOpen ? 0 : -1}
              />
            </div>
          </aside>

          <button
            type="button"
            onClick={() => setIsDrawerOpen((open) => !open)}
            className="settings-drawer-toggle absolute z-50 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-gray-600 shadow-lg ring-1 ring-gray-200 transition-colors active:bg-gray-100"
            aria-label={isDrawerOpen ? "关闭设置菜单" : "打开设置菜单"}
            aria-controls="settings-drawer"
            aria-expanded={isDrawerOpen}
          >
            <MenuIcon />
          </button>
        </>
      ) : (
        <aside className="flex w-44 flex-shrink-0 flex-col border-r border-gray-200 bg-white py-5">
          <div className="px-5 pb-5">
            <p className="text-lg font-semibold tracking-tight text-gray-900">设置</p>
            <p className="mt-1 text-xs text-gray-400">LightTodo</p>
          </div>
          <div className="px-3">
            <SettingsNavigation activeSection={activeSection} onSelect={handleSectionSelect} />
          </div>
        </aside>
      )}

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
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
                <h2 className="settings-content-title text-2xl font-semibold tracking-tight text-gray-900">备份</h2>
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
