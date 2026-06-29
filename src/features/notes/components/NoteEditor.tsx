import { useState, useEffect } from "react";
import { useNotesStore } from "../stores/notesStore";
import { updateNote } from "../hooks/useNotes";
import type { UpdateNoteInput } from "../types";

// 防抖 Hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// 颜色选项
const COLORS = [
  { name: "默认", value: undefined },
  { name: "金黄", value: "#FFD700" },
  { name: "红色", value: "#FF6B6B" },
  { name: "青色", value: "#4ECDC4" },
  { name: "薄荷绿", value: "#95E1D3" },
  { name: "粉红", value: "#F38181" },
  { name: "紫色", value: "#AA96DA" },
  { name: "樱花粉", value: "#FCBAD3" },
];

export function NoteEditor() {
  const { selectedNote, setSelectedNote, updateNoteInStore } = useNotesStore();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isTodo, setIsTodo] = useState(false);
  const [color, setColor] = useState<string | undefined>(undefined);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // 自动保存的 debounce 值
  const debouncedTitle = useDebounce(title, 500);
  const debouncedContent = useDebounce(content, 500);

  // 加载选中的便签
  useEffect(() => {
    if (selectedNote) {
      setTitle(selectedNote.title);
      setContent(selectedNote.content);
      setIsTodo(selectedNote.isTodo);
      setColor(selectedNote.color);
      setTags(selectedNote.tags);
    }
  }, [selectedNote?.id]);

  // 自动保存
  useEffect(() => {
    if (!selectedNote) return;

    const saveNote = async () => {
      try {
        const input: UpdateNoteInput = {
          id: selectedNote.id,
        };

        if (debouncedTitle !== selectedNote.title) {
          input.title = debouncedTitle;
        }
        if (debouncedContent !== selectedNote.content) {
          input.content = debouncedContent;
        }

        if (Object.keys(input).length > 1) {
          const updated = await updateNote(input);
          updateNoteInStore(updated);
        }
      } catch (error) {
        console.error("Failed to auto-save:", error);
      }
    };

    saveNote();
  }, [debouncedTitle, debouncedContent]);

  // 更新 Todo 状态
  const handleToggleTodo = async () => {
    if (!selectedNote) return;
    try {
      const updated = await updateNote({
        id: selectedNote.id,
        isTodo: !isTodo,
        isCompleted: false, // 切换类型时重置完成状态
      });
      updateNoteInStore(updated);
      setIsTodo(!isTodo);
    } catch (error) {
      console.error("Failed to toggle todo:", error);
    }
  };

  // 更新颜色
  const handleColorChange = async (newColor: string | undefined) => {
    if (!selectedNote) return;
    setColor(newColor);
    try {
      const updated = await updateNote({
        id: selectedNote.id,
        color: newColor,
      });
      updateNoteInStore(updated);
    } catch (error) {
      console.error("Failed to update color:", error);
    }
  };

  // 添加标签
  const handleAddTag = async () => {
    if (!selectedNote || !tagInput.trim()) return;
    if (tags.includes(tagInput.trim())) {
      setTagInput("");
      return;
    }

    const newTags = [...tags, tagInput.trim()];
    setTags(newTags);
    setTagInput("");

    try {
      const updated = await updateNote({
        id: selectedNote.id,
        tags: newTags,
      });
      updateNoteInStore(updated);
    } catch (error) {
      console.error("Failed to add tag:", error);
    }
  };

  // 删除标签
  const handleRemoveTag = async (tagToRemove: string) => {
    if (!selectedNote) return;

    const newTags = tags.filter((t) => t !== tagToRemove);
    setTags(newTags);

    try {
      const updated = await updateNote({
        id: selectedNote.id,
        tags: newTags,
      });
      updateNoteInStore(updated);
    } catch (error) {
      console.error("Failed to remove tag:", error);
    }
  };

  if (!selectedNote) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-lg">← 选择或创建一个便签</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* 工具栏 */}
      <div className="border-b border-gray-200 p-4 flex items-center gap-4">
        <button
          onClick={() => setSelectedNote(null)}
          className="text-gray-600 hover:text-gray-800"
          title="返回"
        >
          ← 返回
        </button>

        <button
          onClick={handleToggleTodo}
          className={`px-3 py-1 rounded ${
            isTodo
              ? "bg-blue-500 text-white"
              : "bg-gray-200 text-gray-700"
          }`}
          title="切换 Todo"
        >
          {isTodo ? "✅ Todo" : "📝 笔记"}
        </button>

        {/* 颜色选择器 */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">颜色:</span>
          {COLORS.map((c) => (
            <button
              key={c.name}
              onClick={() => handleColorChange(c.value)}
              className={`w-6 h-6 rounded-full border-2 ${
                color === c.value ? "border-blue-500" : "border-gray-300"
              }`}
              style={{ backgroundColor: c.value || "#FFFFFF" }}
              title={c.name}
            />
          ))}
        </div>
      </div>

      {/* 标题输入 */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="标题"
        className="text-2xl font-semibold p-4 border-b border-gray-200 focus:outline-none"
      />

      {/* 内容输入 */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="内容..."
        className="flex-1 p-4 resize-none focus:outline-none"
      />

      {/* 标签区域 */}
      <div className="border-t border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-gray-600">🏷️ 标签:</span>
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddTag();
              }
            }}
            placeholder="添加标签..."
            className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleAddTag}
            className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
          >
            添加
          </button>
        </div>

        <div className="flex gap-2 flex-wrap">
          {tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm flex items-center gap-1"
            >
              {tag}
              <button
                onClick={() => handleRemoveTag(tag)}
                className="text-blue-700 hover:text-blue-900"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
