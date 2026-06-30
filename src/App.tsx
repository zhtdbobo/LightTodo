import { useState, useEffect, useRef } from "react";
import { useNotesStore } from "./features/notes/stores/notesStore";
import { getAllNotes, createNote, updateNote, deleteNote } from "./features/notes/hooks/useNotes";
import { getAllGroups, createGroup, deleteGroup } from "./features/notes/hooks/useGroups";
import type { Note, Group } from "./features/notes/types";
import { Window } from "@tauri-apps/api/window";
import { WebDAVSettings } from "./features/sync/WebDAVSettings";
import { syncNotes } from "./features/sync/api";

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

function App() {
  const { notes, setNotes, addNote, updateNoteInStore, removeNote } = useNotesStore();
  const [groups, setGroups] = useState<Group[]>([]);
  const [isWindowPinned, setIsWindowPinned] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [showSyncMenu, setShowSyncMenu] = useState(false);
  const hasInitialized = useRef(false);
  const autoSyncInterval = useRef<number | null>(null);
  const grabApiRef = useRef<any>(null);
  const syncMenuRef = useRef<HTMLDivElement>(null);

  // 检查是否是设置页面
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

  // 点击外部关闭同步菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (syncMenuRef.current && !syncMenuRef.current.contains(event.target as Node)) {
        setShowSyncMenu(false);
      }
    };

    if (showSyncMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSyncMenu]);

  // 点击外部关闭同步菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (syncMenuRef.current && !syncMenuRef.current.contains(event.target as Node)) {
        setShowSyncMenu(false);
      }
    };

    if (showSyncMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSyncMenu]);

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
            // 同步成功后重新加载笔记
            loadNotes();
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
      setGroups(allGroups);
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

  // 创建新便签
  const handleCreateNote = async (forceCreate: boolean = false) => {
    console.log("Creating note...");

    // 先检查是否已有空标题的待办（只在点击 + 按钮时检查，回车时强制创建）
    if (!forceCreate) {
      const emptyNote = notes.find(n => !n.title.trim() && !n.isCompleted);
      if (emptyNote) {
        // 如果已有空待办，直接聚焦到它
        setTimeout(() => {
          const textareas = document.querySelectorAll('textarea');
          const emptyTextarea = Array.from(textareas).find(
            (textarea) => (textarea as HTMLTextAreaElement).value === ""
          ) as HTMLTextAreaElement;
          if (emptyTextarea) {
            emptyTextarea.focus();
          }
        }, 50);
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
      });
      console.log("Note created:", newNote);
      addNote(newNote);

      // 延迟聚焦到新建的输入框（空标题的第一个）
      setTimeout(() => {
        const textareas = document.querySelectorAll('textarea');
        // 找到第一个空值的输入框（就是新建的那个）
        const emptyTextarea = Array.from(textareas).find(
          (textarea) => (textarea as HTMLTextAreaElement).value === ""
        ) as HTMLTextAreaElement;
        if (emptyTextarea) {
          emptyTextarea.focus();
        }
      }, 100);
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

  // 切换置顶状态
  const handleTogglePinned = async (note: Note) => {
    try {
      const updated = await updateNote({
        id: note.id,
        pinned: !note.pinned,
      });
      updateNoteInStore(updated);
    } catch (error) {
      console.error("Failed to toggle pinned:", error);
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

  // 分组：置顶、自定义分组、未完成、已完成
  const pinnedNotes = notes
    .filter((n) => n.pinned && !n.isCompleted)
    .sort((a, b) => b.priority - a.priority);
  const activeTodos = notes
    .filter((n) => !n.pinned && !n.isCompleted && !n.groupId)
    .sort((a, b) => b.priority - a.priority);
  const completedTodos = notes.filter((n) => n.isCompleted);

  // 按分组分类待办
  const groupedNotes = groups.map((group) => ({
    group,
    notes: notes
      .filter((n) => n.groupId === group.id && !n.isCompleted)
      .sort((a, b) => b.priority - a.priority),
  }));

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
    onAdd
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
      <div className="text-xs text-gray-400 mb-2 flex items-center justify-between group">
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
            className="flex-1 bg-white border border-cyan-400 rounded px-1 py-0.5 text-gray-700 outline-none"
          />
        ) : (
          <span
            onDoubleClick={() => setIsEditing(true)}
            className="cursor-pointer hover:text-gray-600"
            title="双击编辑"
          >
            {group.name}
          </span>
        )}
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
    const [newGroupName, setNewGroupName] = useState("");
    const menuRef = useRef<HTMLDivElement>(null);

    // 点击外部关闭菜单
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
          setShowMenu(false);
          setShowGroupInput(false);
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

    // 当内容变化时调整高度
    useEffect(() => {
      adjustHeight();
    }, [localTitle, note.title]);

    const handleLocalBlur = async () => {
      // 失焦时才保存到数据库
      if (localTitle.trim() !== note.title) {
        await handleEditTitle(note, localTitle);
      }

      // 如果标题为空，删除这条待办
      if (!localTitle.trim()) {
        await handleDelete(note);
      }
    };

    const handleMoveToGroup = async (groupId: string | null) => {
      try {
        const updated = await updateNote({
          id: note.id,
          groupId: groupId ?? undefined,
          pinned: false, // 移动到分组时取消置顶
        });
        updateNoteInStore(updated);
        setShowMenu(false);
        setShowGroupInput(false);
      } catch (error) {
        console.error("Failed to move to group:", error);
      }
    };

    const handleCreateAndMoveToGroup = async () => {
      if (!newGroupName.trim()) return;

      try {
        const newGroup = await createGroup({ name: newGroupName });
        setGroups([...groups, newGroup]);
        await handleMoveToGroup(newGroup.id);
        setNewGroupName("");
      } catch (error) {
        console.error("Failed to create group:", error);
      }
    };

    return (
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
        <textarea
          ref={textareaRef}
          value={localTitle}
          onChange={(e) => {
            setLocalTitle(e.target.value);
            // 自动调整高度
            adjustHeight();
          }}
          onBlur={handleLocalBlur}
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
                await handleCreateNote(true);
                return;
              }

              // 先保存当前待办（如果有修改）
              if (currentContent !== note.title) {
                await handleEditTitle(note, localTitle);
              }

              // 强制创建新待办
              await handleCreateNote(true);
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
                  <button
                    onClick={() => {
                      handleTogglePinned(note);
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700"
                  >
                    {note.pinned ? "取消置顶" : "置顶"}
                  </button>

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
                        <button
                          onClick={() => handleMoveToGroup(null)}
                          className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700"
                        >
                          无分组
                        </button>
                        {groups.map((group) => (
                          <button
                            key={group.id}
                            onClick={() => handleMoveToGroup(group.id)}
                            className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700"
                          >
                            {group.name}
                          </button>
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
            {/* 置顶区域 */}
            {pinnedNotes.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-gray-400 mb-2 flex items-center justify-between group">
                  <span>置顶</span>
                  <button
                    onClick={async () => {
                      const newNote = await createNote({
                        title: "",
                        content: "",
                        isTodo: true,
                        tags: [],
                        priority: 0,
                        pinned: true, // 新建时直接置顶
                      });
                      addNote(newNote);
                      setTimeout(() => {
                        const textareas = document.querySelectorAll('textarea');
                        const emptyTextarea = Array.from(textareas).find(
                          (textarea) => (textarea as HTMLTextAreaElement).value === ""
                        ) as HTMLTextAreaElement;
                        if (emptyTextarea) {
                          emptyTextarea.focus();
                        }
                      }, 100);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-cyan-400 hover:text-cyan-500 text-sm transition-opacity"
                    title="新建置顶待办"
                  >
                    +
                  </button>
                </div>
                <div className="space-y-0.5 bg-cyan-50/20 rounded-lg p-2">
                  {sortWithNewFirst(pinnedNotes).map((note) => (
                    <TodoItem key={note.id} note={note} />
                  ))}
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
                      if (confirm(`确定删除分组"${group.name}"？分组内的待办将移至未完成。`)) {
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
                      setTimeout(() => {
                        const textareas = document.querySelectorAll('textarea');
                        const emptyTextarea = Array.from(textareas).find(
                          (textarea) => (textarea as HTMLTextAreaElement).value === ""
                        ) as HTMLTextAreaElement;
                        if (emptyTextarea) {
                          emptyTextarea.focus();
                        }
                      }, 100);
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

            {/* 未完成待办 */}
            {activeTodos.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-gray-400 mb-2 flex items-center justify-between group">
                  <span>未完成</span>
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
                      setTimeout(() => {
                        const textareas = document.querySelectorAll('textarea');
                        const emptyTextarea = Array.from(textareas).find(
                          (textarea) => (textarea as HTMLTextAreaElement).value === ""
                        ) as HTMLTextAreaElement;
                        if (emptyTextarea) {
                          emptyTextarea.focus();
                        }
                      }, 100);
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
                <div className="space-y-2">
                  {completedTodos.map((note) => (
                    <TodoItem key={note.id} note={note} />
                  ))}
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
                      }, 2000);
                    } catch (error) {
                      setSyncMessage(`下载失败: ${error}`);
                      setTimeout(() => setSyncMessage(""), 3000);
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
                      setTimeout(() => setSyncMessage(""), 2000);
                    } catch (error) {
                      setSyncMessage(`上传失败: ${error}`);
                      setTimeout(() => setSyncMessage(""), 3000);
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
                      }, 2000);
                    } catch (error) {
                      setSyncMessage(`同步失败: ${error}`);
                      setTimeout(() => setSyncMessage(""), 3000);
                    }
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 text-sm flex items-center justify-center gap-2"
                >
                  <span>🔄</span>
                  <span>同步</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 同步消息提示 */}
      {syncMessage && (
        <div className="absolute bottom-14 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-gray-800 text-white text-xs rounded-md shadow-lg z-50 whitespace-nowrap">
          {syncMessage}
        </div>
      )}
        </div>
      )}
    </>
  );
}

export default App;
