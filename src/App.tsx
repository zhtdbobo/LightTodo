import { useState, useEffect, useRef } from "react";
import { useNotesStore } from "./features/notes/stores/notesStore";
import { getAllNotes, createNote, updateNote, deleteNote } from "./features/notes/hooks/useNotes";
import type { Note } from "./features/notes/types";
import { Window } from "@tauri-apps/api/window";

function App() {
  const { notes, setNotes, addNote, updateNoteInStore, removeNote } = useNotesStore();
  const [isWindowPinned, setIsWindowPinned] = useState(false);
  const hasInitialized = useRef(false);

  // 加载便签
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      loadNotes();
      checkWindowPinned();
    }
  }, []);

  const loadNotes = async () => {
    try {
      const allNotes = await getAllNotes();
      setNotes(allNotes);

      // 如果是首次使用（没有任何待办），创建一个示例待办
      if (allNotes.length === 0) {
        const firstNote = await createNote({
          title: "欢迎使用 LightTodo！点击可编辑，点击 ✓ 完成",
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

  // 创建新便签
  const handleCreateNote = async () => {
    console.log("Creating note...");

    // 先检查是否已有空标题的待办
    const emptyNote = notes.find(n => !n.title.trim() && !n.isCompleted);
    if (emptyNote) {
      // 如果已有空待办，直接聚焦到它
      setTimeout(() => {
        const inputs = document.querySelectorAll('input[type="text"]');
        const emptyInput = Array.from(inputs).find(
          (input) => (input as HTMLInputElement).value === ""
        ) as HTMLInputElement;
        if (emptyInput) {
          emptyInput.focus();
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
        const inputs = document.querySelectorAll('input[type="text"]');
        // 找到第一个空值的输入框（就是新建的那个）
        const emptyInput = Array.from(inputs).find(
          (input) => (input as HTMLInputElement).value === ""
        ) as HTMLInputElement;
        if (emptyInput) {
          emptyInput.focus();
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

  // 切换优先级
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

  // 处理输入框失焦
  const handleBlur = async (note: Note) => {
    // 如果标题为空，删除这条待办
    if (!note.title.trim()) {
      await handleDelete(note);
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
        <input
          type="text"
          value={localTitle}
          onChange={(e) => {
            setLocalTitle(e.target.value);
          }}
          onBlur={handleLocalBlur}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            setLocalTitle((e.target as HTMLInputElement).value);
          }}
          className={`flex-1 bg-transparent border-none outline-none text-sm ${
            note.isCompleted
              ? "line-through text-gray-300"
              : "text-gray-700"
          } placeholder:text-gray-300 placeholder:opacity-50`}
          placeholder="记点什么..."
          autoComplete="off"
          spellCheck="false"
        />
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
                <div className="text-xs text-gray-400 mb-2 px-1">待办事项</div>
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
                <div className="text-xs text-gray-400 mb-2 px-1">✓ 已完成</div>
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
    </div>
  );
}

export default App;
