import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { Group } from "../types";
import { isMobileRuntime } from "../../../platform";

export const groupTitleFont = {
  fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
};

export interface GroupTitleProps {
  group: Group;
  noteCount: number;
  isExpanded: boolean;
  onRename: (id: string, name: string) => void;
  onDelete: () => void;
  onAdd: () => void;
  onAddMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isDragging: boolean;
  isDragTarget: boolean;
  onDragStart: (groupId: string) => void;
  onDragMove: (clientX: number, clientY: number) => void;
  onDragEnd: () => void;
  onDragCancel: () => void;
}

export function GroupTitle({
  group,
  noteCount,
  isExpanded,
  onRename,
  onDelete,
  onAdd,
  onAddMouseDown,
  onToggle,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  isDragging,
  isDragTarget,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: GroupTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) {
      setEditName(group.name);
    }
  }, [group.name, isEditing]);

  const handleSave = () => {
    if (editName.trim() && editName !== group.name) {
      onRename(group.id, editName.trim());
    } else {
      setEditName(group.name);
    }
    setIsEditing(false);
  };

  return (
    <div className={`mb-2 -ml-2 flex items-center justify-between group rounded py-0.5 transition-colors ${
      isDragging ? "opacity-50" : isDragTarget ? "bg-cyan-50 ring-1 ring-cyan-200" : ""
    }`}>
      <div
        className="flex items-center gap-1.5 min-w-0 flex-1 text-[13px] text-gray-600"
        style={groupTitleFont}
      >
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex flex-shrink-0 items-center justify-center text-[9px] text-gray-400 hover:text-gray-600"
          aria-label={isExpanded ? `折叠分组 ${group.name}` : `展开分组 ${group.name}`}
          aria-expanded={isExpanded}
        >
          <span
            className="inline-block transition-transform"
            style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            ▶
          </span>
        </button>
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            onBlur={handleSave}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleSave();
              } else if (event.key === "Escape") {
                setEditName(group.name);
                setIsEditing(false);
              }
            }}
            className="flex-1 min-w-0 bg-white border border-cyan-400 rounded px-1 py-0.5 text-gray-700 outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-gray-700"
            aria-expanded={isExpanded}
          >
            <span
              onDoubleClick={(event) => {
                event.stopPropagation();
                setIsEditing(true);
              }}
              className="truncate"
              title="双击编辑"
            >
              {group.name}
            </span>
            <span className="flex-shrink-0 text-[11px] text-gray-400">({noteCount})</span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {isMobileRuntime ? (
          <button
            type="button"
            onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              onDragStart(group.id);
            }}
            onPointerMove={(event: PointerEvent<HTMLButtonElement>) => {
              onDragMove(event.clientX, event.clientY);
            }}
            onPointerUp={(event: PointerEvent<HTMLButtonElement>) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              onDragEnd();
            }}
            onPointerCancel={onDragCancel}
            className="mobile-group-drag-handle inline-flex h-8 w-8 flex-shrink-0 touch-none items-center justify-center text-lg text-gray-400 active:text-cyan-600"
            title="拖动分组"
            aria-label={`拖动分组 ${group.name}`}
          >
            ⠿
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-cyan-500 disabled:text-gray-200 disabled:hover:text-gray-200 text-xs transition-opacity"
              title="上移分组"
              aria-label={`上移分组 ${group.name}`}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-cyan-500 disabled:text-gray-200 disabled:hover:text-gray-200 text-xs transition-opacity"
              title="下移分组"
              aria-label={`下移分组 ${group.name}`}
            >
              ↓
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onAdd}
          onMouseDown={onAddMouseDown}
          data-note-create-button="true"
          className="opacity-0 group-hover:opacity-100 text-cyan-400 hover:text-cyan-500 text-sm transition-opacity"
          title="新建待办"
          aria-label={`在分组 ${group.name} 中新建待办`}
        >
          +
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-500 text-xs transition-opacity"
          title="删除分组"
          aria-label={`删除分组 ${group.name}`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
