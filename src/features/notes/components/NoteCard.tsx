import { useState } from "react";
import type { Note } from "../types";
import { formatTimestamp, calculateDuration } from "../utils/timeFormat";

interface NoteCardProps {
  note: Note;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onTogglePinned: (e: React.MouseEvent) => void;
  onToggleCompleted?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function NoteCard({
  note,
  onClick,
  onDelete,
  onTogglePinned,
  onToggleCompleted,
}: NoteCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const backgroundColor = note.color || "#FFFFFF";

  const handleCardClick = () => {
    // 如果是待办，点击卡片切换展开/折叠
    if (note.isTodo) {
      setIsExpanded(!isExpanded);
    } else {
      // 如果不是待办，执行原来的编辑逻辑
      onClick();
    }
  };

  return (
    <div
      className="rounded-lg p-4 cursor-pointer hover:shadow-lg transition-shadow border border-gray-200"
      style={{ backgroundColor }}
      onClick={handleCardClick}
    >
      {/* 头部 */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-1">
          {note.isTodo && onToggleCompleted && (
            <input
              type="checkbox"
              checked={note.isCompleted}
              onChange={onToggleCompleted}
              onClick={(e) => e.stopPropagation()}
              className="w-4 h-4 cursor-pointer"
            />
          )}
          <h3
            className={`font-semibold text-lg ${
              note.isCompleted ? "line-through text-gray-500" : ""
            }`}
          >
            {note.title || "无标题"}
          </h3>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePinned(e);
          }}
          className="text-xl hover:scale-110 transition-transform"
          title={note.pinned ? "取消置顶" : "置顶"}
        >
          {note.pinned ? "📌" : "📍"}
        </button>
      </div>

      {/* 内容预览 */}
      <p
        className={`text-sm text-gray-600 mb-3 line-clamp-3 ${
          note.isCompleted ? "line-through" : ""
        }`}
      >
        {note.content || "无内容"}
      </p>

      {/* 展开的详细信息 */}
      {isExpanded && note.isTodo && (
        <div className="mt-3 p-3 bg-gray-50 rounded border border-gray-200 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-600">状态：</span>
            <span className={note.isCompleted ? "text-green-600 font-medium" : "text-orange-600"}>
              {note.isCompleted ? "已完成" : "进行中"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">创建时间：</span>
            <span className="text-gray-800">{formatTimestamp(note.createdAt)}</span>
          </div>
          {note.completedAt && (
            <>
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
            </>
          )}
        </div>
      )}

      {/* 底部：标签和删除按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 flex-wrap">
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(e);
          }}
          className="text-red-500 hover:text-red-700 text-lg"
          title="删除"
        >
          🗑️
        </button>
      </div>

      {/* 时间戳 */}
      <div className="mt-2 text-xs text-gray-400">
        {new Date(note.updatedAt * 1000).toLocaleString("zh-CN")}
      </div>
    </div>
  );
}
