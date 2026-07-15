import { useState, useEffect, useRef } from "react";
import { useNotesStore } from "./features/notes/stores/notesStore";
import { getAllNotes, createNote, updateNote, deleteNote } from "./features/notes/hooks/useNotes";
import { getAllGroups, createGroup, deleteGroup } from "./features/notes/hooks/useGroups";
import type { Note, Group } from "./features/notes/types";
import { Window } from "@tauri-apps/api/window";
import { WebDAVSettings } from "./features/sync/WebDAVSettings";
import { syncNotes } from "./features/sync/api";
import { formatTimestamp, calculateDuration } from "./features/notes/utils/timeFormat";
import { SimpleMarkdown } from "./features/notes/components/SimpleMarkdown";
import { belongsToTodayGroup, fromDateTimeLocalValue, getDeadlineStatus, toDateTimeLocalValue } from "./features/notes/utils/deadline";

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
      await existingWindow.setFocus();
      return;
    }

    // 创建新窗口
    const settingsWindow = new WebviewWindow("settings", {
      url: "/#settings",
      title: "WebDAV 同步设置",
      width: 700,
      height: 600,
      resizable: true,
      center: true,
      decorations: true,
    });

    // 等待窗口创建完成
    settingsWindow.once('tauri://created', () => {
      console.log('Settings window created');
    });

    // 监听创建失败
    settingsWindow.once('tauri://error', (e) => {
      console.error('Failed to create settings window:', e);
    });
  } catch (error) {
    console.error("Failed to open settings window:", error);
  }
};

const SYNC_SUCCESS_MESSAGE_MS = 5000;
const SYNC_ERROR_MESSAGE_MS = 6000;

const groupNameCollator = new Intl.Collator("zh-CN", {
  sensitivity: "base",
  numeric: true,
});

const isEnglishGroupName = (name: string) => /^[A-Za-z]/.test(name.trimStart());

const sortGroupsByDefault = (items: Group[]) =>
  [...items].sort((a, b) => {
    const languageOrder =
      Number(!isEnglishGroupName(a.name)) - Number(!isEnglishGroupName(b.name));

    return languageOrder || groupNameCollator.compare(a.name, b.name);
  });

function App() {
  const { notes, setNotes, addNote, updateNoteInStore, removeNote } = useNotesStore();
  const [groups, setGroups] = useState<Group[]>([]);
  const [isWindowPinned, setIsWindowPinned] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [showSyncMenu, setShowSyncMenu] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(Date.now());
  const hasInitialized = useRef(false);
  const autoSyncInterval = useRef<number | null>(null);
  const grabApiRef = useRef<any>(null);
  const syncMenuRef = useRef<HTMLDivElement>(null);
  const resetConfirmRef = useRef<HTMLDivElement>(null);

  // 检查是否是设置页面
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (window.location.hash === "#settings") {
      setShowSettings(true);
    }

    // 仅在开发模式下初始化 react-grab
    if (import.meta.env.DEV && initReactGrab) {
      const initGrab = async () => {
        try {
          if (!grabApiRef.current) {
            const api = initReactGrab({
              activationMode: 'manual' as any,
            });
            grabApiRef.current = api;
            console.log('react-grab initialized:', api);
            console.log('Available methods:', Object.keys(api || {}));
          }
        } catch (error) {
          console.error('Failed to initialize react-grab:', error);
        }
      };
      initGrab();
    }
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
    };

    if (showSyncMenu || showResetConfirm) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSyncMenu, showResetConfirm]);

  // 加载便签
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      loadNotes();
      loadGroups();
      checkWindowPinned();
      // 启动时自动同步
      autoSyncOnStartup();
    }
  }, []);

  const autoSyncOnStartup = async () => {
    try {
      const { getWebDAVConfig } = await import('./features/sync/api');
      const config = await getWebDAVConfig();

      if (config && config.enabled && config.auto_sync) {
        // 延迟3秒后自动同步，避免启动时卡顿
        setTimeout(async () => {
          try {
            const result = await syncNotes();
            console.log('Auto sync on startup:', result);
            // 同步成功后重新加载笔记和分组
            loadNotes();
            loadGroups();
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
          const result = await syncNotes();
          console.log('Auto sync interval:', result);
          loadNotes();
          loadGroups();
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

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (autoSyncInterval.current) {
        clearInterval(autoSyncInterval.current);
      }
    };
  }, []);

  const loadNotes = async () => {
    try {
      const allNotes = await getAllNotes();
      setNotes(allNotes);

      // 如果是首次使用（没有任何待办），创建一个示例待办
      if (allNotes.length === 0) {
        const firstNote = await createNote({
          title: "欢迎使用 LightTodo！点击可编辑",
          content: "",
          isTodo: true,
          tags: [],
          priority: 0, // 低优先级
        });
        addNote(firstNote);
      }
    } catch (error) {
      console.error("Failed to load notes:", error);
    }
  };

  const loadGroups = async () => {
    try {
      const allGroups = await getAllGroups();
      setGroups(sortGroupsByDefault(allGroups));
    } catch (error) {
      console.error("Failed to load groups:", error);
    }
  };

  const handleRenameGroup = async (groupId: string, newName: string) => {
    if (!newName.trim()) return;
    try {
      const { updateGroup } = await import('./features/notes/hooks/useGroups');
      await updateGroup({ id: groupId, name: newName });
      loadGroups();
    } catch (error) {
      console.error("Failed to rename group:", error);
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
    console.log("Toggling window pin, current state:", isWindowPinned);
    try {
      const appWindow = new Window('main');
      await appWindow.setAlwaysOnTop(!isWindowPinned);
      setIsWindowPinned(!isWindowPinned);
      console.log("Window pin toggled to:", !isWindowPinned);
    } catch (error) {
      console.error("Failed to toggle window pin:", error);
    }
  };

  // 关闭窗口（隐藏到任务栏）
  const handleCloseWindow = async () => {
    console.log("Closing window...");
    try {
      const appWindow = new Window('main');
      await appWindow.hide();
      console.log("Window hidden successfully");
    } catch (error) {
      console.error("Failed to hide window:", error);
    }
  };

  const focusNoteTextarea = (noteId: string, delay = 100) => {
    setTimeout(() => {
      const textarea = document.querySelector(
        `textarea[data-note-id="${noteId}"]`
      ) as HTMLTextAreaElement | null;
      textarea?.focus();
    }, delay);
  };

  // 创建新便签
  const handleCreateNote = async (
    forceCreate: boolean = false,
    options: Partial<Pick<Note, "groupId" | "deadline">> = {}
  ) => {
    console.log("Creating note...");

    // 先检查是否已有空标题的待办（只在点击 + 按钮时检查，回车时强制创建）
    if (!forceCreate) {
      const emptyNote = notes.find(
        n =>
          !n.title.trim() &&
          !n.isCompleted &&
          n.groupId === options.groupId &&
          n.deadline === options.deadline
      );
      if (emptyNote) {
        focusNoteTextarea(emptyNote.id, 50);
        return;
      }
    }

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
      console.log("Note created:", newNote);
      addNote(newNote);

      focusNoteTextarea(newNote.id);
    } catch (error) {
      console.error("Failed to create note:", error);
    }
  };

  // 切换完成状态
  const handleToggleCompleted = async (note: Note) => {
    try {
      const updated = await updateNote({
        id: note.id,
        isCompleted: !note.isCompleted,
      });
      updateNoteInStore(updated);
    } catch (error) {
      console.error("Failed to toggle:", error);
    }
  };

  const handleCyclePriority = async (note: Note) => {
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
  const handleEditTitle = async (note: Note, newTitle: string) => {
    try {
      const updated = await updateNote({
        id: note.id,
        title: newTitle,
      });
      updateNoteInStore(updated);
    } catch (error) {
      console.error("Failed to edit:", error);
    }
  };

  // 删除便签
  const handleDelete = async (note: Note) => {
    try {
      await deleteNote(note.id);
      removeNote(note.id);
    } catch (error) {
      console.error("Failed to delete:", error);
    }
  };

  // 带截止时间的未完成待办只展示在“今日”智能分组中。
  const todayNotes = notes
    .filter(belongsToTodayGroup)
    .sort((a, b) => (a.deadline || 0) - (b.deadline || 0));
  const activeTodos = notes
    .filter((n) => n.deadline == null && !n.isCompleted && !n.groupId)
    .sort((a, b) => b.priority - a.priority);
  const completedTodos = notes.filter((n) => n.isCompleted);

  // 按分组分类待办
  const groupedNotes = groups.map((group) => ({
    group,
    notes: notes
      .filter((n) => n.groupId === group.id && n.deadline == null && !n.isCompleted)
      .sort((a, b) => b.priority - a.priority),
  }));

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

  // 优先级标识
  const getPriorityEmoji = (priority: number) => {
    switch (priority) {
      case 2: return "🔴"; // 高
      case 1: return "🟡"; // 中
      default: return ""; // 低/无
    }
  };

  // GroupTitle 组件 - 支持双击编辑
  const GroupTitle = ({
    group,
    onRename,
    onDelete,
    onAdd,
  }: {
    group: Group;
    onRename: (id: string, name: string) => void;
    onDelete: () => void;
    onAdd: () => void;
  }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(group.name);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [isEditing]);

    const handleSave = () => {
      if (editName.trim() && editName !== group.name) {
        onRename(group.id, editName.trim());
      } else {
        setEditName(group.name);
      }
      setIsEditing(false);
    };

    return (
      <div className="text-xs text-gray-400 mb-2 flex items-center justify-between group rounded px-1 py-0.5 transition-colors">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSave();
                } else if (e.key === 'Escape') {
                  setEditName(group.name);
                  setIsEditing(false);
                }
              }}
              className="flex-1 min-w-0 bg-white border border-cyan-400 rounded px-1 py-0.5 text-gray-700 outline-none"
            />
          ) : (
            <span
              onDoubleClick={() => setIsEditing(true)}
              className="cursor-pointer hover:text-gray-600 truncate"
              title="双击编辑"
            >
              {group.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onAdd}
            className="opacity-0 group-hover:opacity-100 text-cyan-400 hover:text-cyan-500 text-sm transition-opacity"
            title="新建待办"
          >
            +
          </button>
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-500 text-xs transition-opacity"
            title="删除分组"
          >
            ✕
          </button>
        </div>
      </div>
    );
  };

  // TodoItem 组件（需要使用 useRef 所以提取为组件）
  const TodoItem = ({ note }: { note: Note }) => {
    const [localTitle, setLocalTitle] = useState(note.title);
    const composingRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [showMenu, setShowMenu] = useState(false);
    const [showGroupInput, setShowGroupInput] = useState(false);
    const [deadlineValue, setDeadlineValue] = useState(toDateTimeLocalValue(note.deadline));
    const [newGroupName, setNewGroupName] = useState("");
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<{ groupId: string; groupName: string; noteCount: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // 点击外部关闭菜单
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
          setShowMenu(false);
          setShowGroupInput(false);
          setDeleteConfirm(null);
        }
      };

      if (showMenu) {
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
    }, [showMenu]);

    // 自动调整 textarea 高度的函数
    const adjustHeight = () => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
      }
    };

    // 同步外部变化到本地状态
    useEffect(() => {
      setLocalTitle(note.title);
    }, [note.title]);

    useEffect(() => {
      setDeadlineValue(toDateTimeLocalValue(note.deadline));
    }, [note.deadline]);

    // 当内容变化时调整高度
    useEffect(() => {
      adjustHeight();
    }, [localTitle, note.title]);

    useEffect(() => {
      if (isEditing) {
        textareaRef.current?.focus();
        adjustHeight();
      }
    }, [isEditing]);

    const handleLocalBlur = async () => {
      // 失焦时才保存到数据库
      if (localTitle.trim() !== note.title) {
        await handleEditTitle(note, localTitle);
      }

      // 如果标题为空，删除这条待办
      if (!localTitle.trim()) {
        await handleDelete(note);
      }

      setIsEditing(false);
    };

    const handleMoveToGroup = async (groupId: string | null) => {
      try {
        const updated = await updateNote({
          id: note.id,
          groupId: groupId ?? undefined,
        });
        updateNoteInStore(updated);
        setShowMenu(false);
        setShowGroupInput(false);
      } catch (error) {
        console.error("Failed to move to group:", error);
      }
    };

    const handleDeadlineChange = async (value: string) => {
      const deadline = fromDateTimeLocalValue(value);
      const updated = await updateNote({
        id: note.id,
        deadline,
        clearDeadline: deadline == null,
      });
      updateNoteInStore(updated);
      setDeadlineValue(value);
    };

    const handleCreateAndMoveToGroup = async () => {
      if (!newGroupName.trim()) return;

      try {
        const newGroup = await createGroup({ name: newGroupName });
        setGroups((currentGroups) => sortGroupsByDefault([...currentGroups, newGroup]));
        await handleMoveToGroup(newGroup.id);
        setNewGroupName("");
      } catch (error) {
        console.error("Failed to create group:", error);
      }
    };

    return (
      <div className="space-y-0.5">
        <div
          className={`flex items-start gap-2.5 py-1 group relative`}
        >
          <input
            type="checkbox"
            checked={note.isCompleted}
            onChange={() => handleToggleCompleted(note)}
            className="mt-0.5 w-4 h-4 cursor-pointer flex-shrink-0 accent-cyan-400"
          />
          <button
            onClick={() => handleCyclePriority(note)}
            className="text-xs transition flex-shrink-0 mt-0.5"
            title="切换优先级"
          >
            {getPriorityEmoji(note.priority) || "⚪"}
          </button>
          {isEditing || !localTitle.trim() ? (
          <textarea
            ref={textareaRef}
            data-note-id={note.id}
            value={localTitle}
            onChange={(e) => {
              setLocalTitle(e.target.value);
              // 自动调整高度
              adjustHeight();
            }}
            onBlur={handleLocalBlur}
            onFocus={() => setIsEditing(true)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              composingRef.current = false;
              setLocalTitle((e.target as HTMLTextAreaElement).value);
            }}
            onKeyDown={async (e) => {
              // Enter 键保存当前待办并创建新待办（不换行）
              if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
                e.preventDefault();

                const currentContent = localTitle.trim();

                // 如果当前待办为空，强制创建新待办
                if (!currentContent) {
                  await handleCreateNote(true, {
                    groupId: note.groupId,
                    deadline: note.deadline,
                  });
                  return;
                }

                // 先保存当前待办（如果有修改）
                if (currentContent !== note.title) {
                  await handleEditTitle(note, localTitle);
                }

                // 强制创建新待办
                await handleCreateNote(true, {
                  groupId: note.groupId,
                  deadline: note.deadline,
                });
              }
            }}
            onClick={() => {
              // 点击 textarea 时，如果是已完成的待办，展开/折叠详情
              if (note.isCompleted) {
                setIsExpanded(!isExpanded);
              }
            }}
            className={`flex-1 bg-transparent border-none outline-none text-sm resize-none overflow-hidden ${
              note.isCompleted
                ? "line-through text-gray-300"
                : "text-gray-700"
            } placeholder:text-gray-300 placeholder:opacity-50 leading-snug`}
            placeholder="记点什么..."
            autoComplete="off"
            spellCheck="false"
            rows={1}
            style={{ minHeight: '20px' }}
          />
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                if (note.isCompleted) {
                  setIsExpanded(!isExpanded);
                  return;
                }

                setIsEditing(true);
              }}
              onDoubleClick={() => setIsEditing(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "F2") {
                  event.preventDefault();
                  setIsEditing(true);
                }
              }}
              className={`simple-markdown-preview flex-1 min-w-0 cursor-text rounded-sm text-sm leading-snug outline-none focus:ring-1 focus:ring-cyan-200 ${
                note.isCompleted
                  ? "line-through text-gray-300 cursor-pointer"
                  : "text-gray-700"
              }`}
            >
              <SimpleMarkdown text={localTitle} />
            </div>
          )}

          {note.deadline != null && (() => {
            const status = getDeadlineStatus(note.deadline, currentTime);
            return (
              <span className={`text-[10px] whitespace-nowrap mt-0.5 ${status.overdue ? "text-red-500" : "text-orange-500"}`}>
                {status.label}
              </span>
            );
          })()}

          {/* 三点菜单按钮 */}
          <div className="relative flex-shrink-0" ref={menuRef}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 text-sm transition"
              title="更多操作"
            >
              ⋯
            </button>

            {/* 下拉菜单 */}
            {showMenu && (
              <div className="absolute right-0 top-6 bg-white border border-gray-200 rounded-md shadow-lg py-0.5 z-50 min-w-[100px] text-xs">
                {note.isCompleted ? (
                  <>
                    <button
                      onClick={() => {
                        handleToggleCompleted(note);
                        setShowMenu(false);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700"
                    >
                      恢复
                    </button>
                    <div className="border-t border-gray-100"></div>
                    <button
                      onClick={() => {
                        handleDelete(note);
                        setShowMenu(false);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-red-600"
                    >
                      删除
                    </button>
                  </>
                ) : (
                  <>
                    <div className="px-3 py-1.5 border-b border-gray-100">
                      <label className="block text-gray-500 mb-1">截止时间</label>
                      <input
                        aria-label="截止时间"
                        type="datetime-local"
                        value={deadlineValue}
                        onChange={(event) => void handleDeadlineChange(event.target.value)}
                        className="w-full border border-gray-200 rounded px-1 py-0.5 text-gray-700"
                      />
                      {note.deadline != null && (
                        <button
                          onClick={() => void handleDeadlineChange("")}
                          className="mt-1 text-red-500 hover:text-red-600"
                        >
                          清除截止时间
                        </button>
                      )}
                    </div>

                    {/* 移动到分组 */}
                    <div className="relative">
                      <button
                        onClick={() => setShowGroupInput(!showGroupInput)}
                        className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700 flex items-center justify-between"
                      >
                        <span>移动到</span>
                        <span className="text-gray-400">◂</span>
                      </button>

                      {/* 分组子菜单 - 弹出到左侧 */}
                      {showGroupInput && (
                        <div className="absolute right-full top-0 mr-0.5 bg-white border border-gray-200 rounded-md shadow-lg py-0.5 min-w-[120px]">
                          {groups.map((group) => (
                            <div
                              key={group.id}
                              className="group/item relative flex items-center justify-between px-3 py-1.5 hover:bg-gray-50"
                            >
                              <button
                                onClick={() => handleMoveToGroup(group.id)}
                                className="flex-1 text-left text-gray-700"
                              >
                                {group.name}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const groupNotes = notes.filter(n => n.groupId === group.id && !n.isCompleted);
                                  setDeleteConfirm({
                                    groupId: group.id,
                                    groupName: group.name,
                                    noteCount: groupNotes.length,
                                  });
                                }}
                                className="opacity-0 group-hover/item:opacity-100 text-red-400 hover:text-red-500 text-xs transition-opacity ml-2 flex-shrink-0"
                                title="删除分组"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                          <div className="border-t border-gray-100 my-0.5"></div>
                          <div className="px-2 py-1.5">
                            <input
                              type="text"
                              value={newGroupName}
                              onChange={(e) => setNewGroupName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleCreateAndMoveToGroup();
                                }
                              }}
                              placeholder="新分组..."
                              className="w-full px-2 py-1 text-xs border border-gray-300 rounded"
                              autoFocus
                            />
                            <button
                              onClick={handleCreateAndMoveToGroup}
                              className="w-full mt-1 px-2 py-1 text-xs bg-cyan-400 text-white rounded hover:bg-cyan-500"
                            >
                              创建
                            </button>
                          </div>

                          {/* 删除确认弹窗 */}
                          {deleteConfirm && (
                            <div className="absolute right-full top-0 mr-2 bg-white border border-gray-200 rounded-md shadow-xl p-3 w-48 z-50">
                              <div className="text-xs text-gray-700 mb-2">
                                确定删除分组 <span className="font-medium">"{deleteConfirm.groupName}"</span> 吗？
                                {deleteConfirm.noteCount > 0 && (
                                  <div className="mt-1 text-gray-500">
                                    分组内的 {deleteConfirm.noteCount} 个待办将移至未分类。
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => setDeleteConfirm(null)}
                                  className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 rounded"
                                >
                                  取消
                                </button>
                                <button
                                  onClick={async () => {
                                    await deleteGroup(deleteConfirm.groupId);
                                    loadGroups();
                                    loadNotes();
                                    setDeleteConfirm(null);
                                    setShowMenu(false);
                                    setShowGroupInput(false);
                                  }}
                                  className="px-2 py-1 text-xs text-white bg-red-500 hover:bg-red-600 rounded"
                                >
                                  确定
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-gray-100"></div>
                    <button
                      onClick={() => {
                        handleDelete(note);
                        setShowMenu(false);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-red-600"
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 展开的详细信息 - 只在已完成的待办展开时显示 */}
        {isExpanded && note.isCompleted && note.completedAt && (
          <div className="ml-7 mr-8 p-2 bg-gray-50 rounded border border-gray-200 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600">状态：</span>
              <span className="text-green-600 font-medium">已完成</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">创建时间：</span>
              <span className="text-gray-800">{formatTimestamp(note.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">完成时间：</span>
              <span className="text-gray-800">{formatTimestamp(note.completedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">用时：</span>
              <span className="text-blue-600 font-medium">
                {calculateDuration(note.createdAt, note.completedAt)}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {showSettings ? (
        <div className="h-screen flex flex-col bg-white">
          <WebDAVSettings />
        </div>
      ) : (
        <div className="h-screen w-screen flex flex-col bg-white rounded-lg shadow-2xl">
          {/* 可拖拽的顶部区域 */}
          <div className="flex items-center justify-between px-4 py-3 select-none flex-shrink-0" data-tauri-drag-region>
        <div className="flex items-center gap-2">
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
          <h1 className="text-sm font-medium text-gray-600">待办</h1>
        </div>

        {/* 时间水印 - 居中 */}
        <div className="absolute left-1/2 transform -translate-x-1/2 text-[10px] text-gray-400">
          {new Date().toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCreateNote();
            }}
            className="text-cyan-400 hover:text-cyan-500 text-xl transition-colors cursor-pointer"
            title="新建"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            +
          </button>
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
        </div>
      </div>

      {/* 待办列表区域 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4">
        {notes.length === 0 ? (
          <div className="text-center text-gray-300 text-xs py-16">
            <p>点击 + 创建待办</p>
          </div>
        ) : (
          <>
            {/* 今日智能分组 */}
            {(
              <div className="mb-4">
                <div className="text-xs text-gray-400 mb-2 flex items-center justify-between group">
                  <span>今日（{todayNotes.length}）</span>
                  <button
                    onClick={async () => {
                      const newNote = await createNote({
                        title: "",
                        content: "",
                        isTodo: true,
                        tags: [],
                        priority: 0,
                        deadline: Date.now() + 60 * 60 * 1000,
                      });
                      addNote(newNote);
                      focusNoteTextarea(newNote.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-cyan-400 hover:text-cyan-500 text-sm transition-opacity"
                    title="新建今日待办"
                  >
                    +
                  </button>
                </div>
                <div className="space-y-0.5 bg-cyan-50/20 rounded-lg p-2">
                  {todayNotes.length === 0 ? (
                    <div className="text-xs text-gray-300 py-1">暂无设置截止时间的待办</div>
                  ) : (
                    sortWithNewFirst(todayNotes).map((note) => (
                      <TodoItem key={note.id} note={note} />
                    ))
                  )}
                </div>
              </div>
            )}

            {/* 自定义分组 */}
            {groupedNotes.map(({ group, notes: groupNotes }) => (
              groupNotes.length > 0 && (
                <div key={group.id} className="mb-4">
                  <GroupTitle
                    group={group}
                    onRename={handleRenameGroup}
                    onDelete={async () => {
                      // 检查分组内是否有待办
                      const hasNotes = groupNotes.length > 0;
                      const message = hasNotes
                        ? `确定删除分组"${group.name}"吗？\n\n分组内的 ${groupNotes.length} 个待办将移至未分类。`
                        : `确定删除分组"${group.name}"吗？`;

                      if (confirm(message)) {
                        await deleteGroup(group.id);
                        loadGroups();
                        loadNotes();
                      }
                    }}
                    onAdd={async () => {
                      const newNote = await createNote({
                        title: "",
                        content: "",
                        isTodo: true,
                        tags: [],
                        priority: 0,
                        groupId: group.id,
                      });
                      addNote(newNote);
                      focusNoteTextarea(newNote.id);
                    }}
                  />
                  <div className="space-y-0.5">
                    {sortWithNewFirst(groupNotes).map((note) => (
                      <TodoItem key={note.id} note={note} />
                    ))}
                  </div>
                </div>
              )
            ))}

            {/* 未分类待办 */}
            {activeTodos.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-gray-400 mb-2 flex items-center justify-between group">
                  <span>未分类</span>
                  <button
                    onClick={async () => {
                      const newNote = await createNote({
                        title: "",
                        content: "",
                        isTodo: true,
                        tags: [],
                        priority: 0,
                      });
                      addNote(newNote);
                      focusNoteTextarea(newNote.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-cyan-400 hover:text-cyan-500 text-sm transition-opacity"
                    title="新建待办"
                  >
                    +
                  </button>
                </div>
                <div className="space-y-0.5">
                  {sortWithNewFirst(activeTodos).map((note) => (
                    <TodoItem key={note.id} note={note} />
                  ))}
                </div>
              </div>
            )}

            {/* 已完成 */}
            {completedTodos.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-2">已完成</div>
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
                              <TodoItem key={note.id} note={note} />
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
                            <TodoItem key={note.id} note={note} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部按钮区域 */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={async (e) => {
              e.stopPropagation();
              await openSettingsWindow();
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
                  onClick={async (e) => {
                    e.stopPropagation();
                    setShowSyncMenu(false);
                    try {
                      const { pullNotes } = await import('./features/sync/api');
                      const result = await pullNotes();
                      setSyncMessage(result);
                      setTimeout(() => {
                        setSyncMessage("");
                        loadNotes();
                        loadGroups();
                      }, SYNC_SUCCESS_MESSAGE_MS);
                    } catch (error) {
                      setSyncMessage(`下载失败: ${error}`);
                      setTimeout(() => setSyncMessage(""), SYNC_ERROR_MESSAGE_MS);
                    }
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 text-sm flex items-center justify-center gap-2"
                >
                  <span>⬇️</span>
                  <span>下载</span>
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    setShowSyncMenu(false);
                    try {
                      const { pushNotes } = await import('./features/sync/api');
                      const result = await pushNotes();
                      setSyncMessage(result);
                      setTimeout(() => setSyncMessage(""), SYNC_SUCCESS_MESSAGE_MS);
                    } catch (error) {
                      setSyncMessage(`上传失败: ${error}`);
                      setTimeout(() => setSyncMessage(""), SYNC_ERROR_MESSAGE_MS);
                    }
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 text-sm flex items-center justify-center gap-2"
                >
                  <span>⬆️</span>
                  <span>上传</span>
                </button>
                <div className="border-t border-gray-100 my-1"></div>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    setShowSyncMenu(false);
                    try {
                      const result = await syncNotes();
                      setSyncMessage(result);
                      setTimeout(() => {
                        setSyncMessage("");
                        loadNotes();
                        loadGroups();
                      }, SYNC_SUCCESS_MESSAGE_MS);
                    } catch (error) {
                      setSyncMessage(`同步失败: ${error}`);
                      setTimeout(() => setSyncMessage(""), SYNC_ERROR_MESSAGE_MS);
                    }
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 text-sm flex items-center justify-center gap-2"
                >
                  <span>🔄</span>
                  <span>同步</span>
                </button>
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
                重置会导致下次同步时重新上传所有待办，并关闭自动同步。确定继续吗？
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
                      setSyncMessage('同步状态已重置，自动同步已关闭');
                      setTimeout(() => setSyncMessage(""), SYNC_ERROR_MESSAGE_MS);
                    } catch (error) {
                      setSyncMessage(`重置失败: ${error}`);
                      setTimeout(() => setSyncMessage(""), SYNC_ERROR_MESSAGE_MS);
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

      {/* 同步消息提示 */}
      {syncMessage && (
        <div className="absolute bottom-14 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className="max-w-full min-w-0 px-4 py-2 bg-gray-800 text-white text-xs leading-relaxed text-center rounded-md shadow-lg whitespace-normal break-words pointer-events-auto">
            {syncMessage}
          </div>
        </div>
      )}
        </div>
      )}
    </>
  );
}

export default App;
