import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "./test-utils";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("./platform", () => ({ isMobileRuntime: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: mocks.listen,
}));
vi.mock("@tauri-apps/api/window", () => ({ Window: vi.fn() }));
vi.mock("react-grab", () => ({ init: vi.fn(() => ({})) }));
vi.mock("./features/settings/SettingsPage", () => ({
  SettingsPage: () => <div>Settings</div>,
}));

import App from "./App";
import { useNotesStore } from "./features/notes/stores/notesStore";

describe("App mobile startup sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.location.hash = "";
    useNotesStore.setState({
      notes: [],
      selectedNote: null,
      searchQuery: "",
      filterTags: [],
      loading: false,
    });
    mocks.listeners.clear();
    mocks.listen.mockImplementation(async (
      eventName: string,
      handler: (event: { payload: unknown }) => void,
    ) => {
      mocks.listeners.set(eventName, handler);
      return () => mocks.listeners.delete(eventName);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows notes pulled by the automatic first-start sync without reopening the app", async () => {
    let syncFinished = false;
    const now = Date.now();
    const remoteNote = {
      id: "remote-note",
      title: "Pulled on first launch",
      content: "",
      isTodo: true,
      isCompleted: false,
      pinned: false,
      deadline: now + 60_000,
      priority: 0,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };

    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "get_all_notes") return syncFinished ? [remoteNote] : [];
      if (command === "get_all_groups") return [];
      if (command === "get_expand_today_on_open") return true;
      if (command === "get_webdav_config") {
        return {
          url: "https://dav.example.test",
          username: "mobile",
          password: "",
          has_password: true,
          enabled: true,
          auto_sync: true,
          directory: "LightTodo",
        };
      }
      if (command === "sync_notes") {
        syncFinished = true;
        return "Sync complete";
      }
      throw new Error("Unexpected command: " + command);
    });

    const view = render(<App />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText("Pulled on first launch")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(screen.getByText("Pulled on first launch")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("sync_notes");

    view.unmount();
  });

  it("shows item progress while a large first-start download is running", async () => {
    let finishSync: ((result: string) => void) | undefined;

    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "get_all_notes" || command === "get_all_groups") return [];
      if (command === "get_expand_today_on_open") return true;
      if (command === "get_webdav_config") {
        return {
          url: "https://dav.example.test",
          username: "mobile",
          password: "",
          has_password: true,
          enabled: true,
          auto_sync: true,
          directory: "LightTodo",
        };
      }
      if (command === "sync_notes") {
        mocks.listeners.get("sync-progress")?.({
          payload: {
            phase: "downloading",
            current: 40,
            total: 100,
            message: "正在下载待办 40/100",
          },
        });
        return await new Promise<string>((resolve) => {
          finishSync = resolve;
        });
      }
      throw new Error("Unexpected command: " + command);
    });

    const view = render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(screen.getByText("正在下载待办 40/100")).toBeInTheDocument();
    const progress = screen.getByRole("progressbar", { name: "正在下载待办 40/100" });
    expect(progress).toHaveAttribute("aria-valuenow", "40");
    expect(progress.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByText("40%")).not.toBeInTheDocument();

    await act(async () => {
      finishSync?.("下载完成 - 下载 100 个待办");
      await Promise.resolve();
    });
    expect(screen.getByText("下载完成 - 下载 100 个待办")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("下载完成 - 下载 100 个待办");
    view.unmount();
  });
});
