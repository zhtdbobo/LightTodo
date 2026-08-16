import {
  useState,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useNotesStore } from "./features/notes/stores/notesStore";
import { getAllNotes, createNote, updateNote, deleteNote } from "./features/notes/hooks/useNotes";
import { getAllGroups, updateGroup, reorderGroups, deleteGroup } from "./features/notes/hooks/useGroups";
import type { Note, Group } from "./features/notes/types";
import { Window } from "@tauri-apps/api/window";
import { listen as listenToEvent } from "@tauri-apps/api/event";
import { SettingsPage } from "./features/settings/SettingsPage";
import { syncNotes, cancelSync, type SyncProgress } from "./features/sync/api";
import { SyncStatusCard } from "./features/sync/components/SyncStatusCard";
import { GroupTitle, groupTitleFont } from "./features/notes/components/GroupTitle";
import { NoteItem } from "./features/notes/components/NoteItem";
import {
  PASSWORD_NOTE_MARKER,
  buildPasswordTitleMarkdown,
  generatePassword,
  isPasswordNote,
  type PasswordCharType,
} from "./features/notes/utils/passwordNote";
import { belongsToTodayGroup } from "./features/notes/utils/deadline";
import {
  canClaimNoteFocus,
} from "./features/notes/utils/focus";
import { moveGroupToTarget } from "./features/notes/utils/groupOrder";
import { isMobileRuntime } from "./platform";

// 仅在开发模式下导入 react-grab
const initReactGrab = import.meta.env.DEV
  ? (await import("react-grab")).init
  : null;

const openSettingsWindow = async () => {
  try {
    // 检查窗口是否已存在
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const allWindows = await WebviewWindow.getAll();
    const existingWindow = allWindows.find((w) => w.label === "settings");

    if (existingWindow) {
      await existingWindow.show();
      await existingWindow.setFocus();
      return;
    }

    // 创建新窗口
    const settingsWindow = new WebviewWindow("settings", {
      url: "/#settings",
      title: "LightTodo 设置",
      width: 760,
      height: 640,
      minWidth: 640,
      minHeight: 520,
      resizable: true,
      center: true,
      decorations: true,
    });

    // 等待窗口创建完成
  settingsWindow.once('tauri://created', () => undefined);

    // 监听创建失败
    settingsWindow.once('tauri://error', (e) => {
      console.error('Failed to create settings window:', e);
    });
  } catch (error) {
    console.error("Failed to open settings window:", error);
  }
};

const SYNC_SUCCESS_MESSAGE_MS = 3000;
const SYNC_ERROR_MESSAGE_MS = 4000;
const MOBILE_SYNC_SUCCESS_MESSAGE_MS = 2500;
const MOBILE_SYNC_ERROR_MESSAGE_MS = 3500;

const groupNameCollator = new Intl.Collator("zh-CN", {
  sensitivity: "base",
  numeric: true,
});

const isEnglishGroupName = (name: string) => /^[A-Za-z]/.test(name.trimStart());

const preserveBlankDraftOnCreateMouseDown = (event: ReactMouseEvent<HTMLButtonElement>) => {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLTextAreaElement
    && activeElement.dataset.noteId
    && !activeElement.value.trim()
  ) {
    // 点击创建按钮时不要先把空白草稿触发失焦删除，后续会复用这条草稿。
    event.preventDefault();
  }
};

const sortGroupsByDisplayOrder = (items: Group[]) =>
  [...items].sort((a, b) => {
    const orderA = Number.isFinite(a.displayOrder) ? a.displayOrder : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(b.displayOrder) ? b.displayOrder : Number.MAX_SAFE_INTEGER;
    const displayOrder = orderA - orderB;
    if (displayOrder !== 0) return displayOrder;

    const languageOrder =
      Number(!isEnglishGroupName(a.name)) - Number(!isEnglishGroupName(b.name));

    return languageOrder || groupNameCollator.compare(a.name, b.name);
  });



const getNoteCreationKey = (
  options: Partial<Pick<Note, "groupId" | "deadline">>
) => JSON.stringify([options.groupId ?? null]);

const noteSelector = (noteId: string) => {
  const escape = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS?.escape;
  const escaped = escape ? escape(noteId) : noteId.replace(/(["\\])/g, "\\$1");
  return `textarea[data-note-id="${escaped}"]`;
};


function App() {
  const { notes, setNotes, addNote, updateNoteInStore, removeNote } = useNotesStore();
  const [groups, setGroups] = useState<Group[]>([]);
  const [isWindowPinned, setIsWindowPinned] = useState(false);
  const [showSettings, setShowSettings] = useState(
    () => window.location.hash === "#settings"
  );
  const [syncMessage, setSyncMessage] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [showSyncMenu, setShowSyncMenu] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isInitialDataLoading, setIsInitialDataLoading] = useState(true);
  const [groupDeleteConfirm, setGroupDeleteConfirm] = useState<{
    groupId: string;
    groupName: string;
    noteCount: number;
  } | null>(null);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [expandedActiveGroups, setExpandedActiveGroups] = useState<Set<string>>(
    () => new Set(["active-today"])
  );
  const expandTodayOnOpenRef = useRef(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [isCompletedExpanded, setIsCompletedExpanded] = useState(false);
  const isReorderingGroupsRef = useRef(false);
  const [mobileGroupDrag, setMobileGroupDrag] = useState<{
    sourceId: string;
    overId: string;
  } | null>(null);
  const mobileGroupDragRef = useRef(mobileGroupDrag);
  mobileGroupDragRef.current = mobileGroupDrag;
  const [passwordLength, setPasswordLength] = useState(16);
  const [passwordCharTypes, setPasswordCharTypes] = useState<PasswordCharType[]>([
    "upper",
    "lower",
    "number",
  ]);
  const [showPasswordMenu, setShowPasswordMenu] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const hasInitialized = useRef(false);
  const autoSyncInterval = useRef<number | null>(null);
  const autoSyncStartupTimer = useRef<number | null>(null);
  const syncMessageTimerRef = useRef<number | null>(null);
  const syncInFlightRef = useRef(false);
  const grabApiRef = useRef<any>(null);
  const syncMenuRef = useRef<HTMLDivElement>(null);
  const resetConfirmRef = useRef<HTMLDivElement>(null);
  const passwordMenuRef = useRef<HTMLDivElement>(null);
  const pendingNoteCreationKeysRef = useRef(new Set<string>());
  const focusNoteTimerRef = useRef<number | null>(null);
  const loadNotesRequestRef = useRef(0);
  const loadGroupsRequestRef = useRef(0);
  const notesMutationVersionRef = useRef(0);
  const groupsMutationVersionRef = useRef(0);
  const locallyDeletedNoteIdsRef = useRef(new Set<string>());
  const locallyDeletedGroupIdsRef = useRef(new Set<string>());
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const markNotesMutation = (deletedId?: string) => {
    notesMutationVersionRef.current += 1;
    if (deletedId) {
      locallyDeletedNoteIdsRef.current.add(deletedId);
    }
  };

  const markGroupsMutation = (deletedId?: string) => {
    groupsMutationVersionRef.current += 1;
    if (deletedId) {
      locallyDeletedGroupIdsRef.current.add(deletedId);
    }
  };

  useEffect(() => {
    if (!groupDeleteConfirm) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDeletingGroup) {
        setGroupDeleteConfirm(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [groupDeleteConfirm, isDeletingGroup]);

  const showTimedSyncMessage = (message: string, duration: number) => {
    if (syncMessageTimerRef.current !== null) {
      clearTimeout(syncMessageTimerRef.current);
    }
    setSyncMessage(message);
    const visibleDuration = isMobileRuntime
      ? Math.min(duration, message.includes("失败")
        ? MOBILE_SYNC_ERROR_MESSAGE_MS
        : MOBILE_SYNC_SUCCESS_MESSAGE_MS)
      : duration;
    syncMessageTimerRef.current = window.setTimeout(() => {
      syncMessageTimerRef.current = null;
      setSyncMessage("");
    }, visibleDuration);
  };

  // 检查是否是设置页面
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const syncPageFromHash = () => {
      setShowSettings(window.location.hash === "#settings");
    };
    syncPageFromHash();
    window.addEventListener("hashchange", syncPageFromHash);

    // 仅在开发模式下初始化 react-grab
    if (import.meta.env.DEV && initReactGrab) {
      const initGrab = async () => {
        try {
          if (!grabApiRef.current) {
            const api = initReactGrab({
              activationMode: 'manual' as any,
            });
            grabApiRef.current = api;
          }
        } catch (error) {
          console.error('Failed to initialize react-grab:', error);
        }
      };
      initGrab();
    }
    return () => window.removeEventListener("hashchange", syncPageFromHash);
  }, []);

  // 点击外部关闭同步菜单和重置确认框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (syncMenuRef.current && !syncMenuRef.current.contains(event.target as Node)) {
        setShowSyncMenu(false);
      }
      if (resetConfirmRef.current && !resetConfirmRef.current.contains(event.target as Node)) {
        setShowResetConfirm(false);
      }
      if (passwordMenuRef.current && !passwordMenuRef.current.contains(event.target as Node)) {
        setShowPasswordMenu(false);
      }
    };

    if (showSyncMenu || showResetConfirm || showPasswordMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSyncMenu, showResetConfirm, showPasswordMenu]);

  // 加载便签
  useEffect(() => {
    if (!showSettings && !hasInitialized.current) {
      hasInitialized.current = true;
      void Promise.all([loadNotes(), loadGroups()]).finally(() => {
        setIsInitialDataLoading(false);
      });
      if (!isMobileRuntime) {
        checkWindowPinned();
      }
      // 启动时自动同步
      autoSyncOnStartup();
    }
  }, [showSettings]);

  const autoSyncOnStartup = async () => {
    try {
      const { getWebDAVConfig } = await import('./features/sync/api');
      const config = await getWebDAVConfig();

      if (config && config.enabled && config.auto_sync) {
        // 延迟3秒后自动同步，避免启动时卡顿
        autoSyncStartupTimer.current = window.setTimeout(async () => {
          autoSyncStartupTimer.current = null;
          try {
            await runSyncOperation(syncNotes);
          } catch (error) {
            console.error('Auto sync failed:', error);
          }
        }, 3000);

        // 启动定期自动同步（每5分钟）
        startAutoSyncInterval();
      }
    } catch (error) {
      console.error('Failed to check auto sync config:', error);
    }
  };

  const startAutoSyncInterval = () => {
    // 清除已有的定时器
    if (autoSyncInterval.current) {
      clearInterval(autoSyncInterval.current);
    }

    // 每5分钟自动同步一次
    autoSyncInterval.current = window.setInterval(async () => {
      try {
        const { getWebDAVConfig } = await import('./features/sync/api');
        const config = await getWebDAVConfig();

        if (config && config.enabled && config.auto_sync) {
          await runSyncOperation(syncNotes);
        } else {
          // 如果自动同步被关闭，停止定时器
          if (autoSyncInterval.current) {
            clearInterval(autoSyncInterval.current);
            autoSyncInterval.current = null;
          }
        }
      } catch (error) {
        console.error('Auto sync interval failed:', error);
      }
    }, 5 * 60 * 1000); // 5分钟
  };

  useEffect(() => {
    if (showSettings) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
      void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("webdav-config-changed", () => {
          void (async () => {
            try {
              const { getWebDAVConfig } = await import("./features/sync/api");
              const latest = await getWebDAVConfig();
              if (autoSyncInterval.current) {
                clearInterval(autoSyncInterval.current);
                autoSyncInterval.current = null;
              }
              if (latest?.enabled && latest.auto_sync) {
                startAutoSyncInterval();
              }
            } catch (error) {
              console.error("Failed to refresh WebDAV auto-sync configuration:", error);
            }
          })();
        })
      )
      .then((stopListening) => {
        if (disposed) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      })
      .catch((error) => console.error("Failed to listen for WebDAV config changes:", error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [showSettings]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenToEvent<SyncProgress>("sync-progress", (event) => {
      if (!disposed) {
        setSyncProgress(event.payload);
      }
    })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      })
      .catch((error) => console.error("Failed to listen for sync progress:", error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (showSettings) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("local-backup-imported", () => {
          void Promise.all([loadNotes(), loadGroups()]);
        })
      )
      .then((stopListening) => {
        if (disposed) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      })
      .catch((error) => console.error("Failed to listen for backup imports:", error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [showSettings]);

  useEffect(() => {
    if (showSettings) return;

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<boolean>("get_expand_today_on_open"))
      .then((enabled) => {
        if (!disposed && typeof enabled === "boolean") {
          expandTodayOnOpenRef.current = enabled;
        }
      })
      .catch((error) => console.error("Failed to load UI preferences:", error));

    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const stopPreferenceListener = await listen<boolean>(
          "expand-today-on-open-changed",
          (event) => {
            expandTodayOnOpenRef.current = event.payload;
          }
        );
        if (disposed) {
          stopPreferenceListener();
          return;
        }
        unlisteners.push(stopPreferenceListener);

        const stopWindowListener = await listen("main-window-opened", () => {
          if (!expandTodayOnOpenRef.current) return;
          setExpandedActiveGroups((current) => {
            if (current.has("active-today")) return current;
            const next = new Set(current);
            next.add("active-today");
            return next;
          });
        });
        if (disposed) {
          stopWindowListener();
          return;
        }
        unlisteners.push(stopWindowListener);
      })
      .catch((error) => console.error("Failed to listen for window open events:", error));

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [showSettings]);

  // 组件卸载时清理定时器
  // 注意:依赖须为 [],否则在移动端打开/关闭设置页(showSettings 翻转)时
  // cleanup 会提前清除 syncMessageTimerRef,导致同步 toast 永不消失。
  useEffect(() => {
    return () => {
      if (autoSyncInterval.current) {
        clearInterval(autoSyncInterval.current);
        autoSyncInterval.current = null;
      }
      if (autoSyncStartupTimer.current !== null) {
        clearTimeout(autoSyncStartupTimer.current);
        autoSyncStartupTimer.current = null;
      }
      if (focusNoteTimerRef.current !== null) {
        clearTimeout(focusNoteTimerRef.current);
      }
      if (syncMessageTimerRef.current !== null) {
        clearTimeout(syncMessageTimerRef.current);
        syncMessageTimerRef.current = null;
      }
    };
  }, []);

  const loadNotes = async () => {
    const requestId = ++loadNotesRequestRef.current;
    const mutationVersion = notesMutationVersionRef.current;
    try {
      const allNotes = await getAllNotes();
      if (requestId !== loadNotesRequestRef.current) return;
      const currentNotes = useNotesStore.getState().notes;
      const deletedIds = locallyDeletedNoteIdsRef.current;
      if (notesMutationVersionRef.current === mutationVersion && deletedIds.size === 0) {
        setNotes(allNotes);
        return;
      }

      const loadedIds = new Set(allNotes.map((note) => note.id));
      const currentById = new Map(currentNotes.map((note) => [note.id, note]));
      const merged = allNotes
        .filter((note) => !deletedIds.has(note.id))
        .map((note) => {
          const current = currentById.get(note.id);
          return current && current.updatedAt > note.updatedAt ? current : note;
        });
      for (const current of currentNotes) {
        if (!loadedIds.has(current.id) && !deletedIds.has(current.id)) {
          merged.push(current);
        }
      }
      deletedIds.clear();
      setNotes(merged);
    } catch (error) {
      console.error("Failed to load notes:", error);
    }
  };

  const loadGroups = async () => {
    const requestId = ++loadGroupsRequestRef.current;
    const mutationVersion = groupsMutationVersionRef.current;
    try {
      const allGroups = await getAllGroups();
      if (requestId !== loadGroupsRequestRef.current) return;
      const currentGroups = groupsRef.current;
      const deletedIds = locallyDeletedGroupIdsRef.current;
      if (groupsMutationVersionRef.current === mutationVersion && deletedIds.size === 0) {
        setGroups(sortGroupsByDisplayOrder(allGroups));
        return;
      }

      const loadedIds = new Set(allGroups.map((group) => group.id));
      const currentById = new Map(currentGroups.map((group) => [group.id, group]));
      const merged = allGroups
        .filter((group) => !deletedIds.has(group.id))
        .map((group) => {
          const current = currentById.get(group.id);
          return current
            && (current.updatedAt > group.updatedAt
              || current.displayOrder !== group.displayOrder)
            ? current
            : group;
        });
      for (const current of currentGroups) {
        if (!loadedIds.has(current.id) && !deletedIds.has(current.id)) {
          merged.push(current);
        }
      }
      deletedIds.clear();
      setGroups(sortGroupsByDisplayOrder(merged));
    } catch (error) {
      console.error("Failed to load groups:", error);
    }
  };

  const reloadAfterSync = async () => {
    if (!isMobileRuntime) {
      await Promise.all([loadNotes(), loadGroups()]);
      return;
    }

    const notesRequestId = ++loadNotesRequestRef.current;
    const groupsRequestId = ++loadGroupsRequestRef.current;
    const [allNotes, allGroups] = await Promise.all([getAllNotes(), getAllGroups()]);
    if (
      notesRequestId !== loadNotesRequestRef.current
      || groupsRequestId !== loadGroupsRequestRef.current
    ) return;

    locallyDeletedNoteIdsRef.current.clear();
    locallyDeletedGroupIdsRef.current.clear();
    setNotes(allNotes);
    setGroups(sortGroupsByDisplayOrder(allGroups));
    // A startup sync may finish before the initial local reads settle. Make
    // the freshly pulled snapshot visible immediately instead of leaving the
    // mobile list behind its initial loading state.
    setIsInitialDataLoading(false);
  };

  const handleRenameGroup = async (groupId: string, newName: string) => {
    if (!newName.trim()) return;
    markGroupsMutation();
    try {
      const updated = await updateGroup({ id: groupId, name: newName });
      setGroups((current) =>
        current.map((group) => (group.id === updated.id ? { ...group, ...updated } : group))
      );
    } catch (error) {
      console.error("Failed to rename group:", error);
    }
  };

  const runSyncOperation = async (
    operation: () => Promise<string>,
    reload = true,
  ): Promise<void> => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    setIsSyncing(true);
    setSyncProgress({
      phase: "preparing",
      current: 0,
      total: 0,
      message: "正在准备同步…",
    });
    try {
      const result = await operation();
      showTimedSyncMessage(result, SYNC_SUCCESS_MESSAGE_MS);
      if (reload) {
        await reloadAfterSync();
      }
    } catch (error) {
      showTimedSyncMessage(`同步失败: ${error}`, SYNC_ERROR_MESSAGE_MS);
    } finally {
      syncInFlightRef.current = false;
      setIsSyncing(false);
      setSyncProgress(null);
    }
  };

  const toggleActiveGroup = (groupId: string) => {
    setExpandedActiveGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const expandActiveGroup = (groupId: string) => {
    setExpandedActiveGroups((current) => {
      if (current.has(groupId)) return current;
      const next = new Set(current);
      next.add(groupId);
      return next;
    });
  };

  const persistGroupOrder = async (orderedGroups: Group[]) => {
    if (isReorderingGroupsRef.current) return;

    markGroupsMutation();
    isReorderingGroupsRef.current = true;
    // Update the rendered order immediately.  Waiting for the IPC response
    // makes the list appear to blink back and forth while the swap is saved.
    setGroups(orderedGroups);

    try {
      const persisted = await reorderGroups(orderedGroups.map((group) => group.id));
      setGroups((current) => {
        const persistedById = new Map(persisted.map((group) => [group.id, group]));
        const currentIds = current.map((group) => group.id).join("\0");
        const persistedIds = sortGroupsByDisplayOrder(persisted).map((group) => group.id).join("\0");
        if (currentIds === persistedIds) {
          return current.map((group) => ({
            ...group,
            ...(persistedById.get(group.id) ?? {}),
          }));
        }
        return sortGroupsByDisplayOrder(persisted);
      });
    } catch (error) {
      console.error("Failed to reorder groups:", error);
      await loadGroups();
    } finally {
      isReorderingGroupsRef.current = false;
    }
  };

  const handleMoveGroupTo = async (groupId: string, targetGroupId: string) => {
    const orderedGroups = moveGroupToTarget(groups, groupId, targetGroupId);
    if (orderedGroups === groups) return;
    await persistGroupOrder(orderedGroups);
  };

  const handleMoveGroup = async (groupId: string, offset: -1 | 1) => {
    const visibleGroupIds = groups
      .filter((group) => notes.some((note) => note.groupId === group.id && note.deadline == null && !note.isCompleted))
      .map((group) => group.id);
    const currentVisibleIndex = visibleGroupIds.indexOf(groupId);
    const targetGroupId = visibleGroupIds[currentVisibleIndex + offset];
    if (currentVisibleIndex < 0 || !targetGroupId) return;

    await handleMoveGroupTo(groupId, targetGroupId);
  };

  const handleMobileGroupDragStart = (groupId: string) => {
    if (!isMobileRuntime || isReorderingGroupsRef.current) return;
    const next = { sourceId: groupId, overId: groupId };
    mobileGroupDragRef.current = next;
    setMobileGroupDrag(next);
  };

  const handleMobileGroupDragMove = (clientX: number, clientY: number) => {
    const current = mobileGroupDragRef.current;
    if (!current) return;
    const target = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-mobile-group-id]")
      ?.dataset.mobileGroupId;
    if (!target || target === current.overId) return;

    const next = { ...current, overId: target };
    mobileGroupDragRef.current = next;
    setMobileGroupDrag(next);
  };

  const clearMobileGroupDrag = () => {
    mobileGroupDragRef.current = null;
    setMobileGroupDrag(null);
  };

  const handleMobileGroupDragEnd = () => {
    const completedDrag = mobileGroupDragRef.current;
    clearMobileGroupDrag();
    if (completedDrag && completedDrag.sourceId !== completedDrag.overId) {
      void handleMoveGroupTo(completedDrag.sourceId, completedDrag.overId);
    }
  };

  // 检查窗口是否置顶
  const checkWindowPinned = async () => {
    try {
      const appWindow = new Window('main');
      const pinned = await appWindow.isAlwaysOnTop();
      setIsWindowPinned(pinned);
    } catch (error) {
      console.error("Failed to check window pinned:", error);
    }
  };

  // 切换窗口置顶
  const toggleWindowPin = async () => {
    try {
      const appWindow = new Window('main');
      await appWindow.setAlwaysOnTop(!isWindowPinned);
      setIsWindowPinned(!isWindowPinned);
    } catch (error) {
      console.error("Failed to toggle window pin:", error);
    }
  };

  // 关闭窗口（隐藏到任务栏）
  const handleCloseWindow = async () => {
    try {
      const appWindow = new Window('main');
      await appWindow.hide();
    } catch (error) {
      console.error("Failed to hide window:", error);
    }
  };

  const focusNoteTextarea = (
    noteId: string,
    delay = 100,
    focusOrigin?: Element | null
  ) => {
    const focus = () => {
      const textarea = document.querySelector(
        noteSelector(noteId)
      ) as HTMLTextAreaElement | null;
      if (textarea) {
        if (!canClaimNoteFocus(textarea, focusOrigin)) return;
        if (document.activeElement !== textarea) {
          textarea.focus({ preventScroll: true });
        }
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
      }
    };

    const currentTextarea = document.querySelector(
      noteSelector(noteId)
    ) as HTMLTextAreaElement | null;
    if (currentTextarea && document.activeElement === currentTextarea) {
      const end = currentTextarea.value.length;
      currentTextarea.setSelectionRange(end, end);
      return;
    }

    if (focusNoteTimerRef.current !== null) {
      clearTimeout(focusNoteTimerRef.current);
    }
    focusNoteTimerRef.current = window.setTimeout(() => {
      focusNoteTimerRef.current = null;
      focus();
    }, delay);
  };

  // 创建新便签
  const handleCreateNote = async (
    forceCreate: boolean = false,
    options: Partial<Pick<Note, "groupId" | "deadline">> = {},
    focusOrigin: Element | null = document.activeElement
  ) => {
    const creationKey = getNoteCreationKey(options);

    // 新建待办后确保对应的折叠分组可见，方便立即编辑。
    if (options.groupId) {
      expandActiveGroup(options.groupId);
    } else if (options.deadline != null) {
      expandActiveGroup("active-today");
    } else if (options.deadline == null) {
      expandActiveGroup("active-no-group");
    }

    // 先检查是否已有空标题的待办（只在点击 + 按钮时检查，回车时强制创建）
    if (!forceCreate) {
      // createNote 是异步的；在请求返回前连续点击 + 时，notes 还没有更新。
      // 用创建中的 key 先行拦截，避免一次点击产生多条空白待办。
      if (pendingNoteCreationKeysRef.current.has(creationKey)) {
        return;
      }

      // 直接读取 store 的最新值，避免 React 尚未完成重渲染时使用旧的 notes 闭包。
      const emptyNote = useNotesStore.getState().notes.find(
        n =>
          n.isTodo &&
          !n.title.trim() &&
          !n.content.trim() &&
          !n.isCompleted &&
          (n.groupId ?? null) === (options.groupId ?? null)
      );
      if (emptyNote) {
        focusNoteTextarea(emptyNote.id, 50, focusOrigin);
        return;
      }

      pendingNoteCreationKeysRef.current.add(creationKey);
    }

    markNotesMutation();
    try {
      const newNote = await createNote({
        title: "",
        content: "",
        isTodo: true,
        tags: [],
        priority: 0,
        groupId: options.groupId,
        deadline: options.deadline,
      });
      addNote(newNote);

      focusNoteTextarea(newNote.id, 100, focusOrigin);
    } catch (error) {
      console.error("Failed to create note:", error);
    } finally {
      if (!forceCreate) {
        pendingNoteCreationKeysRef.current.delete(creationKey);
      }
    }
  };

  const handleGeneratePassword = async () => {
    markNotesMutation();
    try {
      expandActiveGroup("password");
      const password = generatePassword(passwordLength, passwordCharTypes);
      const newNote = await createNote({
        title: buildPasswordTitleMarkdown("", password),
        content: PASSWORD_NOTE_MARKER,
        isTodo: true,
        tags: [],
        priority: 0,
      });
      addNote(newNote);
      setShowPasswordMenu(false);
      focusNoteTextarea(newNote.id);
    } catch (error) {
      console.error("Failed to generate password note:", error);
    }
  };

  // 切换完成状态
  const handleToggleCompleted = async (note: Note) => {
    markNotesMutation();
    try {
      const updated = await updateNote({
        id: note.id,
        isCompleted: !note.isCompleted,
      });
      updateNoteInStore(updated);
      if (!note.isCompleted && note.repeatRule) {
        await loadNotes();
      }
    } catch (error) {
      console.error("Failed to toggle:", error);
    }
  };

  const handleCyclePriority = async (note: Note) => {
    markNotesMutation();
    try {
      // 循环: 0 -> 1 -> 2 -> 0
      const nextPriority = (note.priority + 1) % 3;
      const updated = await updateNote({
        id: note.id,
        priority: nextPriority,
      });
      updateNoteInStore(updated);
    } catch (error) {
      console.error("Failed to update priority:", error);
    }
  };

  // 编辑标题（内联编辑）
  const handleEditTitle = async (note: Note, newTitle: string): Promise<boolean> => {
    markNotesMutation();
    try {
      const updated = await updateNote({
        id: note.id,
        title: newTitle,
      });
      updateNoteInStore(updated);
      return true;
    } catch (error) {
      console.error("Failed to edit:", error);
      return false;
    }
  };

  // 删除便签
  const handleDelete = async (note: Note, optimistic = false) => {
    markNotesMutation(note.id);
    if (optimistic) {
      removeNote(note.id);
    }

    try {
      await deleteNote(note.id);
      if (!optimistic) {
        removeNote(note.id);
      }
    } catch (error) {
      locallyDeletedNoteIdsRef.current.delete(note.id);
      if (
        optimistic
        && !useNotesStore.getState().notes.some((item) => item.id === note.id)
      ) {
        addNote(note);
      }
      console.error("Failed to delete:", error);
    }
  };

  // 带截止时间的未完成待办只展示在“今日”智能分组中。
  const todayNotes = notes
    .filter(belongsToTodayGroup)
    .sort((a, b) => (a.deadline || 0) - (b.deadline || 0));
  const activeTodos = notes
    .filter(
      (n) =>
        n.deadline == null &&
        !n.isCompleted &&
        !n.groupId &&
        !isPasswordNote(n)
    )
    .sort((a, b) => b.priority - a.priority);
  const completedTodos = notes.filter((n) => n.isCompleted);
  const passwordGroupNotes = notes.filter(
    (note) =>
      note.deadline == null &&
      !note.isCompleted &&
      !note.groupId &&
      isPasswordNote(note)
  );

  // 按分组分类待办
  const groupedNotes = groups.map((group) => ({
    group,
    notes: notes
      .filter((n) => n.groupId === group.id && n.deadline == null && !n.isCompleted)
      .sort((a, b) => b.priority - a.priority),
  }));
  const activeGroupedNotes = groupedNotes.filter(({ notes: groupNotes }) => groupNotes.length > 0);

  // 按分组分类已完成的待办
  const completedByGroup = groups.map((group) => ({
    group,
    notes: notes
      .filter((n) => n.groupId === group.id && n.isCompleted)
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)),
  }));

  // 未分类的已完成待办
  const completedWithoutGroup = notes.filter((n) => n.isCompleted && !n.groupId);

  // 将新建的空待办放到最前面
  const sortWithNewFirst = (items: typeof notes) => {
    const newItems = items.filter(n => !n.title);
    const existingItems = items.filter(n => n.title);
    return [...newItems, ...existingItems];
  };

  const renderTodoItem = (note: Note) => (
    <NoteItem
      key={note.id}
      note={note}
      notes={notes}
      groups={groups}
      currentTime={currentTime}
      setGroups={setGroups}
      setNotes={setNotes}
      updateNoteInStore={updateNoteInStore}
      markNotesMutation={markNotesMutation}
      markGroupsMutation={markGroupsMutation}
      onGroupCreated={(group) => {
        setGroups((currentGroups) => sortGroupsByDisplayOrder([...currentGroups, group]));
        expandActiveGroup(group.id);
      }}
      handleToggleCompleted={handleToggleCompleted}
      handleCyclePriority={handleCyclePriority}
      handleEditTitle={handleEditTitle}
      handleDelete={handleDelete}
      handleCreateNote={handleCreateNote}
      loadNotes={loadNotes}
      loadGroups={loadGroups}
      locallyDeletedGroupIdsRef={locallyDeletedGroupIdsRef}
    />
  );


  return (
    <>
      {showSettings ? (
        <SettingsPage />
      ) : (
        <div className={`app-shell flex h-screen w-screen flex-col bg-white ${
          isMobileRuntime ? "mobile-app-shell" : "rounded-lg shadow-2xl"
        }`}>
          {/* 可拖拽的顶部区域 */}
          <div
            className={`flex flex-shrink-0 select-none items-center justify-between ${isMobileRuntime ? "px-5" : "px-4"} ${
              isMobileRuntime ? "min-h-14 py-2" : "py-3"
            }`}
            data-tauri-drag-region={isMobileRuntime ? undefined : true}
          >
        <div className="flex items-center gap-2">
          {!isMobileRuntime && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleWindowPin();
              }}
              className={`text-sm transition-colors cursor-pointer ${
                isWindowPinned ? "text-cyan-500" : "text-gray-400 hover:text-cyan-400"
              }`}
              title={isWindowPinned ? "取消窗口置顶" : "窗口置顶"}
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              {isWindowPinned ? "📌" : "📍"}
            </button>
          )}
          <h1 className="text-sm font-medium text-gray-600">待办</h1>
        </div>

        {!isMobileRuntime && (
          <div className="absolute left-1/2 transform -translate-x-1/2 text-[10px] text-gray-400">
            {new Date().toLocaleString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCreateNote();
            }}
            onMouseDown={preserveBlankDraftOnCreateMouseDown}
            data-note-create-button="true"
            className="text-cyan-400 hover:text-cyan-500 text-xl transition-colors cursor-pointer"
            title="新建"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            +
          </button>
          {!isMobileRuntime && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCloseWindow();
              }}
              className="text-gray-400 hover:text-gray-600 text-base font-bold transition-colors cursor-pointer w-5 h-5 flex items-center justify-center"
              title="隐藏到托盘"
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 待办列表区域 */}
      <div className={`flex-1 overflow-y-auto overflow-x-hidden ${isMobileRuntime ? "px-5" : "px-4"} pb-4 ${isMobileRuntime ? "mobile-scroll-area" : ""}`}>
        {isInitialDataLoading ? (
          <div
            className="py-16 text-center text-xs text-gray-300"
            role="status"
            aria-label="正在加载待办"
          >
            正在加载...
          </div>
        ) : notes.length === 0 && groups.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-xs text-gray-400">还没有待办</p>
            <button
              type="button"
              onClick={() => void handleCreateNote()}
              onMouseDown={preserveBlankDraftOnCreateMouseDown}
              data-note-create-button="true"
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded bg-cyan-400 px-3 text-xs text-white transition-colors hover:bg-cyan-500"
            >
              <span aria-hidden="true" className="text-base leading-none">+</span>
              <span>新建待办</span>
            </button>
          </div>
        ) : (
          <>
            {/* 今日智能分组 */}
            {todayNotes.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 -ml-2 flex items-center justify-between group">
                  <button
                    type="button"
                    onClick={() => toggleActiveGroup("active-today")}
                    className="flex items-center gap-1.5 text-[13px] text-amber-600 hover:text-amber-700"
                    style={groupTitleFont}
                    aria-expanded={expandedActiveGroups.has("active-today")}
                  >
                    <span
                      className="inline-block text-[9px] text-amber-500/70 transition-transform"
                      style={{
                        transform: expandedActiveGroups.has("active-today")
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                      }}
                    >
                      ▶
                    </span>
                    <span>今日</span>
                    <span className="text-[11px] text-amber-500/70">({todayNotes.length})</span>
                  </button>
                  <button
                    onClick={() => {
                      void handleCreateNote(false, {
                        deadline: Date.now() + 60 * 60 * 1000,
                      });
                    }}
                    onMouseDown={preserveBlankDraftOnCreateMouseDown}
                    data-note-create-button="true"
                    className="opacity-0 group-hover:opacity-100 text-cyan-400 hover:text-cyan-500 text-sm transition-opacity"
                    title="新建今日待办"
                  >
                    +
                  </button>
                </div>
                {expandedActiveGroups.has("active-today") && (
                  <div className="space-y-0.5 bg-cyan-50/20 rounded-lg">
                    {todayNotes.length === 0 ? (
                      <div className="text-xs text-gray-300 py-1">暂无设置截止时间的待办</div>
                    ) : (
                      sortWithNewFirst(todayNotes).map((note) => (
                        renderTodoItem(note)
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 自定义分组 */}
            {activeGroupedNotes.map(({ group, notes: groupNotes }, groupIndex) => {
              const isExpanded = expandedActiveGroups.has(group.id);

              return (
                <div
                  key={group.id}
                  className="mb-4"
                  data-mobile-group-id={isMobileRuntime ? group.id : undefined}
                >
                  <GroupTitle
                    group={group}
                    noteCount={groupNotes.length}
                    isExpanded={isExpanded}
                    onRename={handleRenameGroup}
                    onToggle={() => toggleActiveGroup(group.id)}
                    onMoveUp={() => handleMoveGroup(group.id, -1)}
                    onMoveDown={() => handleMoveGroup(group.id, 1)}
                    canMoveUp={groupIndex > 0}
                    canMoveDown={groupIndex < activeGroupedNotes.length - 1}
                    isDragging={mobileGroupDrag?.sourceId === group.id}
                    isDragTarget={
                      mobileGroupDrag?.overId === group.id
                      && mobileGroupDrag.sourceId !== group.id
                    }
                    onDragStart={handleMobileGroupDragStart}
                    onDragMove={handleMobileGroupDragMove}
                    onDragEnd={handleMobileGroupDragEnd}
                    onDragCancel={clearMobileGroupDrag}
                    onDelete={() => {
                      setGroupDeleteConfirm({
                        groupId: group.id,
                        groupName: group.name,
                        noteCount: notes.filter((note) => note.groupId === group.id).length,
                      });
                    }}
                    onAdd={() => {
                      void handleCreateNote(false, { groupId: group.id });
                    }}
                    onAddMouseDown={preserveBlankDraftOnCreateMouseDown}
                  />
                  {isExpanded && (
                    <div className="space-y-0.5">
                      {groupNotes.length > 0 ? (
                        sortWithNewFirst(groupNotes).map((note) => (
                          renderTodoItem(note)
                        ))
                      ) : (
                        <div className="py-1 text-xs text-gray-300">暂无未完成待办</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 未分类待办 */}
            {activeTodos.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 -ml-2 flex items-center justify-between group">
                  <button
                    type="button"
                    onClick={() => toggleActiveGroup("active-no-group")}
                    className="flex items-center gap-1.5 text-[13px] text-gray-600 hover:text-gray-700"
                    style={groupTitleFont}
                    aria-expanded={expandedActiveGroups.has("active-no-group")}
                  >
                    <span
                      className="inline-block text-[9px] text-gray-400 transition-transform"
                      style={{
                        transform: expandedActiveGroups.has("active-no-group")
                          ? "rotate(90deg)"
                          : "rotate(0deg)",
                      }}
                    >
                      ▶
                    </span>
                    <span>未分类</span>
                    <span className="text-[11px] text-gray-400">({activeTodos.length})</span>
                  </button>
                  <button
                    onClick={() => {
                      void handleCreateNote();
                    }}
                    onMouseDown={preserveBlankDraftOnCreateMouseDown}
                    data-note-create-button="true"
                    className="opacity-0 group-hover:opacity-100 text-cyan-400 hover:text-cyan-500 text-sm transition-opacity"
                    title="新建待办"
                  >
                    +
                  </button>
                </div>
                {expandedActiveGroups.has("active-no-group") && (
                  <div className="space-y-0.5">
                    {sortWithNewFirst(activeTodos).map((note) => (
                      renderTodoItem(note)
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mb-4">
              <div className="mb-2 -ml-2 flex items-center justify-between group rounded py-0.5 transition-colors">
                <button
                  type="button"
                  onClick={() => toggleActiveGroup("password")}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] text-gray-600 hover:text-gray-700"
                  style={groupTitleFont}
                  aria-expanded={expandedActiveGroups.has("password")}
                >
                  <span
                    className="inline-block text-[9px] text-gray-400 transition-transform"
                    style={{
                      transform: expandedActiveGroups.has("password")
                        ? "rotate(90deg)"
                        : "rotate(0deg)",
                    }}
                  >
                    ▶
                  </span>
                  <span>密码</span>
                  {passwordGroupNotes.length > 0 && (
                    <span className="text-[11px] text-gray-400">({passwordGroupNotes.length})</span>
                  )}
                </button>
                <div className="relative flex items-center gap-2" ref={passwordMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowPasswordMenu((current) => !current)}
                    onMouseDown={preserveBlankDraftOnCreateMouseDown}
                    data-note-create-button="true"
                    className="opacity-0 group-hover:opacity-100 text-cyan-400 hover:text-cyan-500 text-sm transition-opacity"
                    title="生成密码"
                  >
                    +
                  </button>
                  {showPasswordMenu && (
                    <div className="absolute right-0 top-6 z-50 w-64 rounded-md border border-gray-200 bg-white p-3 shadow-lg text-xs space-y-3">
                      <div>
                        <div className="mb-2 text-gray-500">字符类型</div>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            ["upper", "大写字母"],
                            ["lower", "小写字母"],
                            ["number", "数字"],
                            ["symbol", "特殊字符"],
                          ] as const).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-2 text-gray-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={passwordCharTypes.includes(key)}
                                onChange={(e) => {
                                  setPasswordCharTypes((current) =>
                                    e.target.checked
                                      ? Array.from(new Set([...current, key]))
                                      : current.filter((item) => item !== key)
                                  );
                                }}
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 text-gray-500">长度</div>
                        <input
                          type="range"
                          min={8}
                          max={32}
                          value={passwordLength}
                          onChange={(e) => setPasswordLength(Number(e.target.value))}
                          className="w-full"
                        />
                        <div className="mt-1 text-gray-600">{passwordLength} 位</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleGeneratePassword()}
                        onMouseDown={preserveBlankDraftOnCreateMouseDown}
                        data-note-create-button="true"
                        className="w-full rounded bg-cyan-400 px-3 py-2 text-white hover:bg-cyan-500"
                      >
                        生成密码
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {expandedActiveGroups.has("password") && (
                <div className="space-y-0.5">
                  {passwordGroupNotes.length > 0 ? (
                    sortWithNewFirst(passwordGroupNotes).map((note) => (
                      renderTodoItem(note)
                    ))
                  ) : (
                    <div className="text-xs text-gray-300 py-1">
                      点击加号生成密码：第一行写备注，第二行为密码（同一代码块）。
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 已完成 */}
            {completedTodos.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setIsCompletedExpanded((current) => !current)}
                  className="mb-2 -ml-2 flex items-center gap-1.5 text-left text-xs text-gray-400 hover:text-gray-600"
                  aria-expanded={isCompletedExpanded}
                >
                  <span
                    className="inline-block text-[9px] transition-transform"
                    style={{
                      transform: isCompletedExpanded ? "rotate(90deg)" : "rotate(0deg)",
                    }}
                  >
                    ▶
                  </span>
                  <span>已完成</span>
                  <span className="text-[11px] text-gray-400">({completedTodos.length})</span>
                </button>
                {isCompletedExpanded && (
                  <div className="space-y-3">
                  {/* 按分组显示已完成的待办 */}
                  {completedByGroup.map(({ group, notes: completedNotes }) => (
                    completedNotes.length > 0 && (
                      <div key={group.id}>
                        <button
                          onClick={() => {
                            setExpandedGroups(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(group.id)) {
                                newSet.delete(group.id);
                              } else {
                                newSet.add(group.id);
                              }
                              return newSet;
                            });
                          }}
                          className="w-full text-left text-xs text-gray-500 hover:text-gray-700 mb-1 flex items-center gap-1"
                        >
                          <span className="transition-transform" style={{
                            display: 'inline-block',
                            transform: expandedGroups.has(group.id) ? 'rotate(90deg)' : 'rotate(0deg)'
                          }}>
                            ▶
                          </span>
                          <span>{group.name}</span>
                          <span className="text-gray-400">({completedNotes.length})</span>
                        </button>
                        {expandedGroups.has(group.id) && (
                          <div className="space-y-0.5 ml-4">
                            {completedNotes.map((note) => (
                              renderTodoItem(note)
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  ))}

                  {/* 未分类的已完成待办 */}
                  {completedWithoutGroup.length > 0 && (
                    <div>
                      <button
                        onClick={() => {
                          setExpandedGroups(prev => {
                            const newSet = new Set(prev);
                            if (newSet.has('no-group')) {
                              newSet.delete('no-group');
                            } else {
                              newSet.add('no-group');
                            }
                            return newSet;
                          });
                        }}
                        className="w-full text-left text-xs text-gray-500 hover:text-gray-700 mb-1 flex items-center gap-1"
                      >
                        <span className="transition-transform" style={{
                          display: 'inline-block',
                          transform: expandedGroups.has('no-group') ? 'rotate(90deg)' : 'rotate(0deg)'
                        }}>
                          ▶
                        </span>
                        <span>未分类</span>
                        <span className="text-gray-400">({completedWithoutGroup.length})</span>
                      </button>
                      {expandedGroups.has('no-group') && (
                        <div className="space-y-0.5 ml-4">
                          {completedWithoutGroup.map((note) => (
                            renderTodoItem(note)
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部按钮区域 */}
      <div className={`flex flex-shrink-0 items-center justify-between border-t border-gray-100 ${isMobileRuntime ? "px-5" : "px-4"} ${isMobileRuntime ? "min-h-14 py-2" : "py-2"}`}>
        <div className="flex items-center gap-3">
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (isMobileRuntime) {
                window.location.hash = "settings";
              } else {
                await openSettingsWindow();
              }
            }}
            className="text-gray-400 hover:text-cyan-400 text-base transition-colors cursor-pointer"
            title="设置"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            ⚙️
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative" ref={syncMenuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowSyncMenu(!showSyncMenu);
              }}
              className="text-gray-400 hover:text-cyan-400 text-base transition-colors cursor-pointer"
              title="同步"
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              🔄
            </button>

            {/* 同步菜单 */}
            {showSyncMenu && (
              <div className="absolute right-0 bottom-full mb-2 bg-white border border-gray-200 rounded-md shadow-lg py-1 z-50 min-w-[100px]">
                <button
                  disabled={isSyncing}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setShowSyncMenu(false);
                    const { pullNotes } = await import('./features/sync/api');
                    await runSyncOperation(pullNotes);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>⬇️</span>
                  <span>下载</span>
                </button>
                <button
                  disabled={isSyncing}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setShowSyncMenu(false);
                    const { pushNotes } = await import('./features/sync/api');
                    await runSyncOperation(pushNotes, false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>⬆️</span>
                  <span>上传</span>
                </button>
                <div className="border-t border-gray-100 my-1"></div>
                <button
                  disabled={isSyncing}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setShowSyncMenu(false);
                    await runSyncOperation(syncNotes);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>🔄</span>
                  <span>同步</span>
                </button>
                {isSyncing && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await cancelSync();
                        showTimedSyncMessage("正在取消同步…", SYNC_ERROR_MESSAGE_MS);
                      } catch (error) {
                        showTimedSyncMessage(`取消同步失败: ${error}`, SYNC_ERROR_MESSAGE_MS);
                      }
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-amber-600 text-sm flex items-center justify-center gap-2"
                  >
                    <span>⏹</span>
                    <span>取消同步</span>
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSyncMenu(false);
                    setShowResetConfirm(true);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-600 text-sm flex items-center justify-center gap-2"
                >
                  <span>🔧</span>
                  <span>重置</span>
                </button>
              </div>
            )}
          </div>

          {/* 重置确认弹窗 */}
          {showResetConfirm && (
            <div
              ref={resetConfirmRef}
              className="absolute bottom-14 right-2 bg-white rounded-lg shadow-lg border border-gray-200 p-4 w-64 z-50"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm text-gray-700 mb-3">
                重置会清除“上次同步”时间并关闭自动同步，不会删除或强制覆盖本地、云端数据。确定继续吗？
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 rounded"
                >
                  取消
                </button>
                <button
                  onClick={async () => {
                    setShowResetConfirm(false);
                    try {
                      const { resetSyncState, getWebDAVConfig, saveWebDAVConfig } = await import('./features/sync/api');

                      // 关闭自动同步
                      const config = await getWebDAVConfig();
                      if (config) {
                        await saveWebDAVConfig({ ...config, auto_sync: false });

                        // 发送事件通知设置页面刷新
                        const { emit } = await import('@tauri-apps/api/event');
                        await emit('webdav-config-changed');
                      }

                      // 重置同步状态
                      await resetSyncState();
                      showTimedSyncMessage('同步状态已重置，自动同步已关闭', SYNC_ERROR_MESSAGE_MS);
                    } catch (error) {
                      showTimedSyncMessage(`重置失败: ${error}`, SYNC_ERROR_MESSAGE_MS);
                    }
                  }}
                  className="px-3 py-1.5 text-sm text-white bg-red-500 hover:bg-red-600 rounded"
                >
                  确定
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <SyncStatusCard
        isSyncing={isSyncing}
        syncProgress={syncProgress}
        syncMessage={syncMessage}
        onDismiss={() => {
          if (syncMessageTimerRef.current !== null) {
            clearTimeout(syncMessageTimerRef.current);
            syncMessageTimerRef.current = null;
          }
          setSyncMessage("");
        }}
      />
      {groupDeleteConfirm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isDeletingGroup) {
              setGroupDeleteConfirm(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-delete-title"
            aria-describedby="group-delete-description"
            className="w-full max-w-[280px] rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
          >
            <h2 id="group-delete-title" className="text-sm font-medium text-gray-800">
              删除分组
            </h2>
            <div id="group-delete-description" className="mt-2 text-xs leading-5 text-gray-600">
              <p className="break-words">
                确定删除分组 <span className="font-medium text-gray-800">“{groupDeleteConfirm.groupName}”</span> 吗？
              </p>
              {groupDeleteConfirm.noteCount > 0 && (
                <p className="mt-1 text-gray-500">
                  分组内的 {groupDeleteConfirm.noteCount} 个待办将移至未分类。
                </p>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeletingGroup}
                onClick={() => setGroupDeleteConfirm(null)}
                className="rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                autoFocus
                disabled={isDeletingGroup}
                onClick={async () => {
                  const { groupId } = groupDeleteConfirm;
                  setIsDeletingGroup(true);
                  markGroupsMutation(groupId);
                  markNotesMutation();
                  try {
                    await deleteGroup(groupId);
                    setGroups((current) => current.filter((item) => item.id !== groupId));
                    setNotes(
                      useNotesStore.getState().notes.map((note) =>
                        note.groupId === groupId
                          ? { ...note, groupId: undefined }
                          : note
                      )
                    );
                    setGroupDeleteConfirm(null);
                    await Promise.all([loadGroups(), loadNotes()]);
                  } catch (error) {
                    locallyDeletedGroupIdsRef.current.delete(groupId);
                    console.error("Failed to delete group:", error);
                  } finally {
                    setIsDeletingGroup(false);
                  }
                }}
                className="min-w-14 rounded bg-red-500 px-3 py-1.5 text-xs text-white hover:bg-red-600 disabled:cursor-wait disabled:opacity-60"
              >
                {isDeletingGroup ? "删除中..." : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}
        </div>
      )}
    </>
  );
}

export default App;
