import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createGroup, deleteGroup } from "../hooks/useGroups";
import { updateNote } from "../hooks/useNotes";
import { useNotesStore } from "../stores/notesStore";
import type { Group, Note, RepeatRule } from "../types";
import { DeadlineTimeInput } from "./DeadlineTimeInput";
import { SimpleMarkdown } from "./SimpleMarkdown";
import { calculateDuration, formatTimestamp } from "../utils/timeFormat";
import { fromDateTimeLocalValue, getDeadlineStatus, toDateTimeLocalValue } from "../utils/deadline";
import {
  hasExceededClickMovement,
  hasSelectedTextWithin,
} from "../utils/focus";
import {
  buildPasswordTitleMarkdown,
  isPasswordNote,
  parsePasswordTitleMarkdown,
} from "../utils/passwordNote";
import { isMobileRuntime } from "../../../platform";

export interface NoteItemProps {
  note: Note;
  notes: Note[];
  groups: Group[];
  currentTime: number;
  setGroups: Dispatch<SetStateAction<Group[]>>;
  setNotes: (notes: Note[]) => void;
  updateNoteInStore: (note: Note) => void;
  markNotesMutation: (deletedId?: string) => void;
  markGroupsMutation: (deletedId?: string) => void;
  onGroupCreated: (group: Group) => void;
  handleToggleCompleted: (note: Note) => Promise<void>;
  handleCyclePriority: (note: Note) => Promise<void>;
  handleEditTitle: (note: Note, newTitle: string) => Promise<boolean>;
  handleDelete: (note: Note, optimistic?: boolean) => Promise<void>;
  handleCreateNote: (
    forceCreate?: boolean,
    options?: Partial<Pick<Note, "groupId" | "deadline">>,
    focusOrigin?: Element | null,
  ) => Promise<void>;
  loadNotes: () => Promise<void>;
  loadGroups: () => Promise<void>;
  locallyDeletedGroupIdsRef: MutableRefObject<Set<string>>;
}

const MOBILE_LONG_PRESS_MS = 450;

const getDefaultDeadlineDate = () => {
  const now = new Date();
  const deadline = new Date(now.getTime() + 60 * 60 * 1000);
  if (
    deadline.getFullYear() !== now.getFullYear()
    || deadline.getMonth() !== now.getMonth()
    || deadline.getDate() !== now.getDate()
  ) {
    deadline.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
    deadline.setHours(23, 59, 0, 0);
  } else {
    deadline.setSeconds(0, 0);
  }
  return deadline;
};

const getPriorityEmoji = (priority: number) => {
  switch (priority) {
    case 2: return "🔴";
    case 1: return "🟡";
    default: return "";
  }
};

export function NoteItem({
  note,
  notes,
  groups,
  currentTime,
  setGroups,
  setNotes,
  updateNoteInStore,
  markNotesMutation,
  markGroupsMutation,
  onGroupCreated,
  handleToggleCompleted,
  handleCyclePriority,
  handleEditTitle,
  handleDelete,
  handleCreateNote,
  loadNotes,
  loadGroups,
  locallyDeletedGroupIdsRef,
}: NoteItemProps) {
    const isPwd = isPasswordNote(note);
    const hasDecryptionError = Boolean(note.decryptionError);
    const parsedPwd = isPwd ? parsePasswordTitleMarkdown(note.title) : null;
    const [localTitle, setLocalTitle] = useState(
      isPwd ? (parsedPwd?.remark ?? "") : note.title
    );
    const [localPassword, setLocalPassword] = useState(
      isPwd ? (parsedPwd?.password ?? "") : ""
    );
    const composingRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const previewMouseGestureRef = useRef<{
      startX: number;
      startY: number;
    } | null>(null);
    const previewTouchGestureRef = useRef<{
      startX: number;
      startY: number;
      startedAt: number;
      suppressNextClick: boolean;
    } | null>(null);
    const [showMenu, setShowMenu] = useState(false);
    const [showGroupInput, setShowGroupInput] = useState(false);
    const [deadlineDraftValue, setDeadlineDraftValue] = useState(toDateTimeLocalValue(note.deadline));
    const [repeatRuleDraft, setRepeatRuleDraft] = useState<RepeatRule | null>(note.repeatRule ?? null);
    const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
    const [deadlinePickerMonth, setDeadlinePickerMonth] = useState(
      () => new Date(note.deadline ?? Date.now())
    );
    const [newGroupName, setNewGroupName] = useState("");
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const editSessionRef = useRef(0);
    const [openMenuUpward, setOpenMenuUpward] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<{ groupId: string; groupName: string; noteCount: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);

    // 点击外部关闭菜单
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
          setShowMenu(false);
          setShowGroupInput(false);
          setShowDeadlinePicker(false);
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
      // 编辑期间以本地输入为准，避免自动同步或其他列表刷新把正在输入的内容覆盖掉。
      if (isEditing) return;

      if (isPasswordNote(note)) {
        const parsed = parsePasswordTitleMarkdown(note.title);
        setLocalTitle(parsed.remark);
        setLocalPassword(parsed.password);
      } else {
        setLocalTitle(note.title);
        setLocalPassword("");
      }
    }, [note.title, note.content, isEditing]);

    useEffect(() => {
      const nextDeadlineValue = toDateTimeLocalValue(note.deadline);
      setDeadlineDraftValue(nextDeadlineValue);
      setDeadlinePickerMonth(new Date(note.deadline ?? Date.now()));
      setRepeatRuleDraft(note.repeatRule ?? null);
    }, [note.deadline, note.repeatRule]);

    // 当内容变化时调整高度
    useEffect(() => {
      adjustHeight();
    }, [localTitle, localPassword, note.title, isEditing]);

    useLayoutEffect(() => {
      if (isEditing) {
        const textarea = textareaRef.current;
        if (textarea) {
          if (document.activeElement !== textarea) {
            textarea.focus({ preventScroll: true });
          }
          const end = textarea.value.length;
          textarea.setSelectionRange(end, end);
        }
        adjustHeight();
      }
    }, [isEditing]);

    const toggleMenu = () => {
      if (!showMenu) {
        const rect = menuButtonRef.current?.getBoundingClientRect();
        setOpenMenuUpward(rect ? window.innerHeight - rect.bottom < 260 : false);
        setShowGroupInput(false);
        setShowDeadlinePicker(false);
        setDeleteConfirm(null);
      }
      setShowMenu((current) => !current);
    };

    const handlePasswordEditorChange = (value: string) => {
      // 编辑态下 textarea 内是「代码块展开内容」：第 1 行备注，第 2 行起密码
      const normalized = value.replace(/\r\n/g, "\n");
      const lines = normalized.split("\n");
      setLocalTitle(lines[0] ?? "");
      setLocalPassword(lines.slice(1).join("\n"));
    };

    const beginEditing = () => {
      // 每次重新获得焦点都开启新的编辑会话，避免旧的异步 blur 保存完成后
      // 把用户已经重新输入的内容关闭或删除。
      editSessionRef.current += 1;
      setIsEditing(true);
    };

    const handlePreviewMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
      previewMouseGestureRef.current = event.button === 0
        ? { startX: event.clientX, startY: event.clientY }
        : null;
    };

    const handlePreviewTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
      const touch = event.touches[0];
      if (!touch) return;
      previewTouchGestureRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startedAt: Date.now(),
        suppressNextClick: false,
      };
    };

    const handlePreviewTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
      const gesture = previewTouchGestureRef.current;
      const touch = event.touches[0];
      if (!gesture || !touch || gesture.suppressNextClick) return;
      gesture.suppressNextClick = hasExceededClickMovement(
        gesture.startX,
        gesture.startY,
        touch.clientX,
        touch.clientY,
        6
      );
    };

    const finishPreviewTouch = (element: HTMLDivElement) => {
      const gesture = previewTouchGestureRef.current;
      if (!gesture) return;
      gesture.suppressNextClick = gesture.suppressNextClick
        || Date.now() - gesture.startedAt >= MOBILE_LONG_PRESS_MS
        || hasSelectedTextWithin(element);
    };

    const shouldKeepPreviewSelection = (
      element: HTMLDivElement,
      clientX: number,
      clientY: number
    ) => {
      const gesture = previewMouseGestureRef.current;
      previewMouseGestureRef.current = null;
      const wasDrag = gesture !== null && hasExceededClickMovement(
        gesture.startX,
        gesture.startY,
        clientX,
        clientY
      );

      const wasMobileSelectionGesture = isMobileRuntime
        && (previewTouchGestureRef.current?.suppressNextClick ?? false);
      previewTouchGestureRef.current = null;

      return wasDrag || wasMobileSelectionGesture || hasSelectedTextWithin(element);
    };

    const handleLocalBlur = async () => {
      const editSession = editSessionRef.current;

      if (isPasswordNote(note)) {
        const nextTitle = buildPasswordTitleMarkdown(localTitle, localPassword);
        const isBlankDraft = !localTitle.trim() && !localPassword.trim();
        if (editSessionRef.current === editSession && isBlankDraft) {
          await handleDelete(note, true);
          return;
        }
        if (nextTitle !== note.title) {
          const saved = await handleEditTitle(note, nextTitle);
          if (!saved) return;
        }
        if (editSessionRef.current === editSession) {
          setIsEditing(false);
        }
        return;
      }

      // 失焦时才保存到数据库
      if (editSessionRef.current === editSession && !localTitle.trim()) {
        await handleDelete(note, true);
        return;
      }
      if (localTitle.trim() !== note.title) {
        const saved = await handleEditTitle(note, localTitle);
        if (!saved) return;
      }

      if (editSessionRef.current === editSession) {
        setIsEditing(false);
      }
    };

    const handleMoveToGroup = async (groupId: string | null) => {
      markNotesMutation();
      try {
        const updated = await updateNote({
          id: note.id,
          ...(groupId === null
            ? { clearGroup: true }
            : { groupId }),
        });
        updateNoteInStore(updated);
        setShowMenu(false);
        setShowGroupInput(false);
      } catch (error) {
        console.error("Failed to move to group:", error);
      }
    };

    const handleDeadlineChange = async (
      value: string,
      repeatRule = repeatRuleDraft,
    ): Promise<boolean> => {
      markNotesMutation();
      try {
        const deadline = fromDateTimeLocalValue(value);
        const updated = await updateNote({
          id: note.id,
          deadline,
          clearDeadline: deadline == null,
          repeatRule: deadline == null ? null : repeatRule,
          clearRepeatRule: deadline == null,
        });
        updateNoteInStore(updated);
        return true;
      } catch (error) {
        console.error("Failed to update deadline:", error);
        setDeadlineDraftValue(toDateTimeLocalValue(note.deadline));
        setRepeatRuleDraft(note.repeatRule ?? null);
        return false;
      }
    };

    const handleRepeatRuleChange = async (value: RepeatRule | null) => {
      setRepeatRuleDraft(value);
      const draftDeadline = fromDateTimeLocalValue(deadlineDraftValue);
      if (!deadlineDraftValue || note.deadline == null || draftDeadline !== note.deadline) return;
      markNotesMutation();
      try {
        const updated = await updateNote({
          id: note.id,
          repeatRule: value,
          clearRepeatRule: value == null,
        });
        updateNoteInStore(updated);
      } catch (error) {
        console.error("Failed to update repeat rule:", error);
        setRepeatRuleDraft(note.repeatRule ?? null);
      }
    };

    const getDeadlineDraftDate = () => {
      const timestamp = fromDateTimeLocalValue(deadlineDraftValue);
      const date = timestamp == null ? getDefaultDeadlineDate() : new Date(timestamp);
      date.setSeconds(0, 0);
      return date;
    };
    const deadlineDraftDate = getDeadlineDraftDate();

    const updateDeadlineDraftDate = (date: Date) => {
      date.setSeconds(0, 0);
      setDeadlineDraftValue(toDateTimeLocalValue(date.getTime()));
      setDeadlinePickerMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    };

    const selectDeadlineDay = (day: number) => {
      const next = getDeadlineDraftDate();
      next.setFullYear(deadlinePickerMonth.getFullYear(), deadlinePickerMonth.getMonth(), day);
      updateDeadlineDraftDate(next);
    };

    const shiftDeadlinePickerMonth = (offset: number) => {
      setDeadlinePickerMonth(
        (current) => new Date(current.getFullYear(), current.getMonth() + offset, 1)
      );
    };

    const setDeadlineTimePart = (part: "hour" | "minute", value: string) => {
      if (!/^\d{1,2}$/.test(value)) return;
      const parsed = Number(value);

      const next = getDeadlineDraftDate();
      if (part === "hour") {
        next.setHours(Math.max(0, Math.min(23, parsed)));
      } else {
        next.setMinutes(Math.max(0, Math.min(59, parsed)));
      }
      updateDeadlineDraftDate(next);
    };

    const handleToggleDeadlinePicker = () => {
      const nextOpen = !showDeadlinePicker;
      if (nextOpen && !deadlineDraftValue) {
        const today = new Date();
        setDeadlinePickerMonth(new Date(today.getFullYear(), today.getMonth(), 1));
      }
      setShowDeadlinePicker(nextOpen);
    };

    const handleConfirmDeadline = async () => {
      const value = deadlineDraftValue || toDateTimeLocalValue(deadlineDraftDate.getTime());
      if (!await handleDeadlineChange(value)) return;
      setShowMenu(false);
      setShowGroupInput(false);
      setShowDeadlinePicker(false);
      setDeleteConfirm(null);
    };

    const handleClearDeadline = async () => {
      setDeadlineDraftValue("");
      setRepeatRuleDraft(null);
      if (!await handleDeadlineChange("", null)) {
        setDeadlineDraftValue(toDateTimeLocalValue(note.deadline));
        return;
      }
      setShowMenu(false);
      setShowGroupInput(false);
      setShowDeadlinePicker(false);
      setDeleteConfirm(null);
    };

    const handleCreateAndMoveToGroup = async () => {
      if (!newGroupName.trim()) return;

      markGroupsMutation();
      try {
        const newGroup = await createGroup({ name: newGroupName });
        onGroupCreated(newGroup);
        await handleMoveToGroup(newGroup.id);
        setNewGroupName("");
      } catch (error) {
        console.error("Failed to create group:", error);
      }
    };

    const todayDate = new Date(currentTime);
    const deadlineDisplayValue = deadlineDraftValue
      ? deadlineDraftValue.replace("T", " ")
      : "选择截止时间";
    const deadlineMonthLabel = deadlinePickerMonth.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
    });
    const firstDayOfDeadlineMonth = new Date(
      deadlinePickerMonth.getFullYear(),
      deadlinePickerMonth.getMonth(),
      1
    );
    const daysInDeadlineMonth = new Date(
      deadlinePickerMonth.getFullYear(),
      deadlinePickerMonth.getMonth() + 1,
      0
    ).getDate();
    const deadlineCalendarDays: Array<number | null> = [
      ...Array.from({ length: firstDayOfDeadlineMonth.getDay() }, () => null),
      ...Array.from({ length: daysInDeadlineMonth }, (_, index) => index + 1),
    ];
    while (deadlineCalendarDays.length % 7 !== 0) {
      deadlineCalendarDays.push(null);
    }
    const deadlineHour = String(deadlineDraftDate.getHours()).padStart(2, "0");
    const deadlineMinute = String(deadlineDraftDate.getMinutes()).padStart(2, "0");

    return (
      <div className="space-y-0.5">
        <div
          className={`flex items-start gap-2.5 py-1 group relative`}
        >
          <input
            type="checkbox"
            checked={note.isCompleted}
            onChange={() => handleToggleCompleted(note)}
            disabled={hasDecryptionError}
            className="mt-0.5 w-4 h-4 cursor-pointer flex-shrink-0 accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
          />
          {isPwd ? null : (
            <button
              onClick={() => handleCyclePriority(note)}
              className="text-xs transition flex-shrink-0 mt-0.5"
              title="切换优先级"
            >
              {getPriorityEmoji(note.priority) || "⚪"}
            </button>
          )}
          <div className="flex-1 min-w-0 space-y-0.5">
          {isPwd ? (
            hasDecryptionError ? (
              <div
                className="w-full min-w-0 rounded-sm text-sm leading-snug text-red-500"
                title={note.decryptionError ?? undefined}
              >
                {note.title}
              </div>
            ) : isEditing ? (
              <div className="password-code-editor w-full min-w-0">
                <textarea
                  ref={textareaRef}
                  data-note-id={note.id}
                  value={`${localTitle}\n${localPassword}`}
                  onChange={(e) => {
                    handlePasswordEditorChange(e.target.value);
                    adjustHeight();
                  }}
                  onBlur={handleLocalBlur}
                  onFocus={beginEditing}
                  onCompositionStart={() => {
                    composingRef.current = true;
                  }}
                  onCompositionEnd={(e) => {
                    composingRef.current = false;
                    handlePasswordEditorChange((e.target as HTMLTextAreaElement).value);
                  }}
                  onKeyDown={(e) => {
                    // Enter 在代码块内换行；Ctrl/Cmd+Enter 结束编辑
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !composingRef.current) {
                      e.preventDefault();
                      void handleLocalBlur();
                    }
                  }}
                  className="w-full bg-transparent border-none outline-none text-sm resize-none overflow-hidden text-gray-700 font-mono leading-snug"
                  placeholder={"备注\n密码"}
                  autoComplete="off"
                  spellCheck="false"
                  rows={2}
                  style={{ minHeight: "40px" }}
                />
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onMouseDown={handlePreviewMouseDown}
                onTouchStart={isMobileRuntime ? handlePreviewTouchStart : undefined}
                onTouchMove={isMobileRuntime ? handlePreviewTouchMove : undefined}
                onTouchEnd={isMobileRuntime
                  ? (event) => finishPreviewTouch(event.currentTarget)
                  : undefined}
                onTouchCancel={isMobileRuntime
                  ? (event) => finishPreviewTouch(event.currentTarget)
                  : undefined}
                onClick={(event) => {
                  if (shouldKeepPreviewSelection(
                    event.currentTarget,
                    event.clientX,
                    event.clientY
                  )) return;
                  beginEditing();
                }}
                onDoubleClick={beginEditing}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "F2") {
                    event.preventDefault();
                    beginEditing();
                  }
                }}
                className={`simple-markdown-preview w-full min-w-0 cursor-text rounded-sm text-sm leading-snug outline-none focus:ring-1 focus:ring-cyan-200 ${
                  note.isCompleted ? "line-through text-gray-300 cursor-pointer" : "text-gray-700"
                }`}
              >
                <SimpleMarkdown text={buildPasswordTitleMarkdown(localTitle, localPassword)} />
              </div>
            )
          ) : isEditing || !localTitle.trim() ? (
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
            onFocus={beginEditing}
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

                const focusOrigin = e.currentTarget;
                const currentContent = localTitle.trim();

                // 如果当前待办为空，强制创建新待办
                if (!currentContent) {
                  await handleCreateNote(true, {
                    groupId: note.groupId,
                    deadline: note.deadline,
                  }, focusOrigin);
                  return;
                }

                // 先保存当前待办（如果有修改）
                if (currentContent !== note.title) {
                  const saved = await handleEditTitle(note, localTitle);
                  if (!saved) return;
                }

                // 强制创建新待办
                await handleCreateNote(true, {
                  groupId: note.groupId,
                  deadline: note.deadline,
                }, focusOrigin);
              }
            }}
            onClick={() => {
              // 点击 textarea 时，如果是已完成的待办，展开/折叠详情
              if (note.isCompleted) {
                setIsExpanded(!isExpanded);
              }
            }}
            className={`w-full bg-transparent border-none outline-none text-sm resize-none overflow-hidden ${
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
              onMouseDown={handlePreviewMouseDown}
              onTouchStart={isMobileRuntime ? handlePreviewTouchStart : undefined}
              onTouchMove={isMobileRuntime ? handlePreviewTouchMove : undefined}
              onTouchEnd={isMobileRuntime
                ? (event) => finishPreviewTouch(event.currentTarget)
                : undefined}
              onTouchCancel={isMobileRuntime
                ? (event) => finishPreviewTouch(event.currentTarget)
                : undefined}
              onClick={(event) => {
                if (shouldKeepPreviewSelection(
                  event.currentTarget,
                  event.clientX,
                  event.clientY
                )) return;

                if (note.isCompleted) {
                  setIsExpanded(!isExpanded);
                  return;
                }

                beginEditing();
              }}
              onDoubleClick={beginEditing}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "F2") {
                  event.preventDefault();
                  beginEditing();
                }
              }}
              className={`simple-markdown-preview w-full min-w-0 cursor-text rounded-sm text-sm leading-snug outline-none focus:ring-1 focus:ring-cyan-200 ${
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
              <div className={`text-[10px] leading-none ${status.overdue ? "text-red-500" : "text-orange-500"}`}>
                {status.label}
              </div>
            );
          })()}
          </div>

          {/* 右侧操作 */}
          <div className="relative flex-shrink-0" ref={menuRef}>
            <button
              ref={menuButtonRef}
              onClick={toggleMenu}
              className="opacity-0 group-hover:opacity-100 text-sm transition text-gray-400 hover:text-gray-600"
              title="更多操作"
            >
              ⋯
            </button>

            {/* 下拉菜单 */}
            {showMenu && (
              <div className={`absolute right-0 ${openMenuUpward ? "bottom-6" : "top-6"} bg-white border border-gray-200 rounded-md shadow-lg py-0.5 z-50 w-60 max-w-[calc(100vw-2rem)] max-h-[min(420px,calc(100vh-80px))] overflow-y-auto text-xs`}>
                {hasDecryptionError ? (
                  <button
                    onClick={() => {
                      void handleDelete(note);
                      setShowMenu(false);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-red-600"
                  >
                    删除损坏的密码待办
                  </button>
                ) : note.isCompleted ? (
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
                    <div className="px-3 py-1 text-gray-500">移动到</div>
                    <button
                      onClick={() => void handleMoveToGroup(null)}
                      disabled={!note.groupId}
                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700 disabled:text-gray-300"
                    >
                      未分类
                    </button>
                    {groups.map((group) => (
                      <button
                        key={group.id}
                        onClick={() => void handleMoveToGroup(group.id)}
                        className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700"
                      >
                        {group.name}
                      </button>
                    ))}
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
                    {!isPwd && <div
                      className="px-3 py-1.5 border-b border-gray-100"
                      onMouseDown={() => {
                        setShowGroupInput(false);
                        setDeleteConfirm(null);
                      }}
                      onFocusCapture={() => {
                        setShowGroupInput(false);
                        setDeleteConfirm(null);
                      }}
                    >
                      <label className="block text-gray-500 mb-1">截止时间</label>
                      <button
                        type="button"
                        aria-label="截止时间"
                        onClick={handleToggleDeadlinePicker}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-left text-gray-700 hover:bg-gray-50"
                      >
                        <span className={deadlineDraftValue ? "" : "text-gray-400"}>
                          {deadlineDisplayValue}
                        </span>
                      </button>
                      {showDeadlinePicker && (
                        <div className="mt-1 rounded-md border border-gray-200 bg-white p-2 shadow-sm">
                          <div className="flex items-center justify-between mb-1">
                            <button
                              type="button"
                              onClick={() => shiftDeadlinePickerMonth(-1)}
                              className="w-7 h-6 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                              aria-label="上个月"
                            >
                              ‹
                            </button>
                            <div className="text-gray-700 font-medium">{deadlineMonthLabel}</div>
                            <button
                              type="button"
                              onClick={() => shiftDeadlinePickerMonth(1)}
                              className="w-7 h-6 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                              aria-label="下个月"
                            >
                              ›
                            </button>
                          </div>
                          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-gray-400 mb-0.5">
                            {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
                              <div key={day}>{day}</div>
                            ))}
                          </div>
                          <div className="grid grid-cols-7 gap-0.5">
                            {deadlineCalendarDays.map((day, index) => {
                              const isToday = day != null
                                && todayDate.getFullYear() === deadlinePickerMonth.getFullYear()
                                && todayDate.getMonth() === deadlinePickerMonth.getMonth()
                                && todayDate.getDate() === day;
                              const selected = day != null && (
                                deadlineDraftValue
                                  ? deadlineDraftDate.getFullYear() === deadlinePickerMonth.getFullYear()
                                    && deadlineDraftDate.getMonth() === deadlinePickerMonth.getMonth()
                                    && deadlineDraftDate.getDate() === day
                                  : isToday
                              );

                              return day == null ? (
                                <div key={`empty-${index}`} className="h-6" />
                              ) : (
                                <button
                                  key={day}
                                  type="button"
                                  onClick={() => selectDeadlineDay(day)}
                                  className={`h-6 rounded text-center ${
                                    selected
                                      ? "bg-cyan-400 text-white"
                                      : isToday
                                        ? "border border-cyan-300 bg-cyan-50 font-medium text-cyan-600 hover:bg-cyan-100"
                                        : "text-gray-700 hover:bg-gray-50"
                                  }`}
                                  aria-current={isToday ? "date" : undefined}
                                  aria-pressed={selected}
                                >
                                  {day}
                                </button>
                              );
                            })}
                          </div>
                          <div className="mt-2 flex items-center gap-1">
                            <DeadlineTimeInput
                              hour={deadlineHour}
                              minute={deadlineMinute}
                              onCommit={setDeadlineTimePart}
                            />
                            <div className="flex-1" />
                            {(note.deadline != null || deadlineDraftValue) && (
                              <button
                                type="button"
                                onClick={() => void handleClearDeadline()}
                                className="text-red-500 hover:text-red-600"
                              >
                                清除
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleConfirmDeadline()}
                              className="px-2 py-1 rounded bg-cyan-400 text-white hover:bg-cyan-500"
                            >
                              确定
                            </button>
                          </div>
                        </div>
                      )}
                      <label className="mt-2 flex items-center justify-between gap-2 text-gray-500">
                        <span>重复</span>
                        <select
                          aria-label="重复周期"
                          value={repeatRuleDraft ?? "none"}
                          disabled={!deadlineDraftValue}
                          onChange={(event) => {
                            const value = event.target.value;
                            void handleRepeatRuleChange(value === "none" ? null : value as RepeatRule);
                          }}
                          className="min-w-28 rounded border border-gray-200 bg-white px-2 py-1 text-gray-700 disabled:bg-gray-50 disabled:text-gray-400"
                        >
                          <option value="none">不重复</option>
                          <option value="daily">每天</option>
                          <option value="weekly">每周</option>
                          <option value="monthly">每月</option>
                        </select>
                      </label>
                    </div>}

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
                        <div className="mt-0.5 bg-white border border-gray-200 rounded-md shadow-lg py-0.5 w-full">
                          <button
                            type="button"
                            onClick={() => handleMoveToGroup(null)}
                            className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 ${
                              note.groupId ? "text-gray-700" : "text-gray-400"
                            }`}
                            disabled={!note.groupId}
                          >
                            未分类
                          </button>
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
                                  const groupNotes = notes.filter(n => n.groupId === group.id);
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
                            <div className="mx-2 my-1 bg-white border border-gray-200 rounded-md shadow-xl p-3">
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
                                    const groupId = deleteConfirm.groupId;
                                    markGroupsMutation(groupId);
                                    markNotesMutation();
                                    try {
                                      await deleteGroup(groupId);
                                      setGroups((current) => current.filter((group) => group.id !== groupId));
                                      setNotes(
                                        useNotesStore.getState().notes.map((note) =>
                                          note.groupId === groupId
                                            ? { ...note, groupId: undefined }
                                            : note
                                        )
                                      );
                                      await Promise.all([loadGroups(), loadNotes()]);
                                      setDeleteConfirm(null);
                                      setShowMenu(false);
                                      setShowGroupInput(false);
                                    } catch (error) {
                                      locallyDeletedGroupIdsRef.current.delete(groupId);
                                      console.error("Failed to delete group:", error);
                                    }
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
}
