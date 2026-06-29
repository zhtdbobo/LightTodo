import { useState, useEffect, useRef } from "react";
import { useNotesStore } from "./features/notes/stores/notesStore";
import { getAllNotes, createNote, updateNote, deleteNote } from "./features/notes/hooks/useNotes";
import type { Note } from "./features/notes/types";
import { Window } from "@tauri-apps/api/window";
import { WebDAVSettings } from "./features/sync/WebDAVSettings";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { syncNotes } from "./features/sync/api";

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
  const [isWindowPinned, setIsWindowPinned] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const hasInitialized = useRef(false);
  const autoSyncInterval = useRef<number | null>(null);

  // 检查是否是设置页面
  useEffect(() => {
    if (window.location.hash === "#settings") {
      setShowSettings(true);
    }
  }, []);

  // 加载便签
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      loadNotes();
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
  const handleCreateNote = async () => {
    console.log("Creating note...");

    // 先检查是否已有空标题的待办
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

  // 分组：置顶、未完成、已完成
  const pinnedNotes = notes
    .filter((n) => n.pinned && !n.isCompleted)
    .sort((a, b) => b.priority - a.priority);
  const activeTodos = notes
    .filter((n) => !n.pinned && !n.isCompleted)
    .sort((a, b) => b.priority - a.priority);
  const completedTodos = notes.filter((n) => n.isCompleted);

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

  // TodoItem 组件（需要使用 useRef 所以提取为组件）
  const TodoItem = ({ note, isPinned }: { note: Note; isPinned: boolean }) => {
    const [localTitle, setLocalTitle] = useState(note.title);
    const composingRef = useRef(false);

    // 同步外部变化到本地状态
    useEffect(() => {
      setLocalTitle(note.title);
    }, [note.title]);

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

    const showPinButton = !note.isCompleted;

    return (
      <div
        className={`flex items-start gap-2.5 py-1.5 group ${isPinned ? 'bg-cyan-50/30 rounded px-2' : ''}`}
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
          value={localTitle}
          onChange={(e) => {
            setLocalTitle(e.target.value);
            // 自动调整高度
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          onBlur={handleLocalBlur}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            setLocalTitle((e.target as HTMLTextAreaElement).value);
          }}
          onKeyDown={(e) => {
            // Enter 键创建新待办（不换行）
            if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
              e.preventDefault();
              handleLocalBlur();
              handleCreateNote();
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
        {showPinButton && (
          <button
            onClick={() => handleTogglePinned(note)}
            className={`opacity-0 group-hover:opacity-100 text-sm transition flex-shrink-0 ${
              note.pinned ? 'text-cyan-500' : 'text-gray-300 hover:text-cyan-400'
            }`}
            title={note.pinned ? "取消置顶" : "置顶"}
          >
            {note.pinned ? "📌" : "📍"}
          </button>
        )}
        <button
          onClick={() => handleDelete(note)}
          className="opacity-0 group-hover:opacity-100 text-cyan-300 hover:text-cyan-400 text-sm transition flex-shrink-0"
          title="删除"
        >
          ✕
        </button>
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
        <div className="h-screen flex flex-col bg-white rounded-lg shadow-2xl">
          {/* 可拖拽的顶部区域 */}
          <div className="flex items-center justify-between px-4 py-3 select-none" data-tauri-drag-region>
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
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {notes.length === 0 ? (
          <div className="text-center text-gray-300 text-xs py-16">
            <p>点击 + 创建待办</p>
          </div>
        ) : (
          <>
            {/* 置顶区域 */}
            {pinnedNotes.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-gray-400 mb-2 px-1">📌 置顶</div>
                <div className="space-y-2">
                  {sortWithNewFirst(pinnedNotes).map((note) => (
                    <TodoItem key={note.id} note={note} isPinned={true} />
                  ))}
                </div>
              </div>
            )}

            {/* 未完成待办 */}
            {activeTodos.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-gray-400 mb-2 px-1">未完成</div>
                <div className="space-y-2">
                  {sortWithNewFirst(activeTodos).map((note) => (
                    <TodoItem key={note.id} note={note} isPinned={false} />
                  ))}
                </div>
              </div>
            )}

            {/* 已完成 */}
            {completedTodos.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-2 px-1">已完成</div>
                <div className="space-y-2">
                  {completedTodos.map((note) => (
                    <TodoItem key={note.id} note={note} isPinned={false} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部时间水印 */}
      <div className="text-center text-[10px] text-gray-200 py-2">
        {new Date().toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>

      {/* 底部按钮区域 */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100">
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
        <div className="flex items-center gap-3">
          <button
            onClick={async (e) => {
              e.stopPropagation();
              try {
                const { pullNotes } = await import('./features/sync/api');
                const result = await pullNotes();
                setSyncMessage(result);
                setTimeout(() => {
                  setSyncMessage("");
                  // 重新加载笔记
                  loadNotes();
                }, 2000);
              } catch (error) {
                setSyncMessage(`下载失败: ${error}`);
                setTimeout(() => setSyncMessage(""), 3000);
              }
            }}
            className="text-gray-400 hover:text-cyan-400 text-base transition-colors cursor-pointer"
            title="从云端下载"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            ⬇️
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
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
            className="text-gray-400 hover:text-cyan-400 text-base transition-colors cursor-pointer"
            title="上传到云端"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            ⬆️
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              try {
                const result = await syncNotes();
                setSyncMessage(result);
                setTimeout(() => {
                  setSyncMessage("");
                  // 重新加载笔记
                  loadNotes();
                }, 2000);
              } catch (error) {
                setSyncMessage(`同步失败: ${error}`);
                setTimeout(() => setSyncMessage(""), 3000);
              }
            }}
            className="text-gray-400 hover:text-cyan-400 text-base transition-colors cursor-pointer"
            title="双向同步"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            🔄
          </button>
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
