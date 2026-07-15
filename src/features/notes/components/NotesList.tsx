import { useEffect, useState } from "react";
import { useNotesStore } from "../stores/notesStore";
import {
  getAllNotes,
  createNote,
  updateNote,
  deleteNote,
} from "../hooks/useNotes";
import { NoteCard } from "../components/NoteCard";
import type { Note } from "../types";

export function NotesList() {
  const {
    notes,
    setNotes,
    addNote,
    updateNoteInStore,
    removeNote,
    setSelectedNote,
    searchQuery,
    filterTags,
    setLoading,
  } = useNotesStore();

  const [isCreating, setIsCreating] = useState(false);

  // 加载所有便签
  useEffect(() => {
    loadNotes();
  }, []);

  const loadNotes = async () => {
    setLoading(true);
    try {
      const allNotes = await getAllNotes();
      setNotes(allNotes);
    } catch (error) {
      console.error("Failed to load notes:", error);
    } finally {
      setLoading(false);
    }
  };

  // 过滤便签
  const filteredNotes = notes.filter((note) => {
    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (
        !note.title.toLowerCase().includes(query) &&
        !note.content.toLowerCase().includes(query)
      ) {
        return false;
      }
    }

    // 标签过滤
    if (filterTags.length > 0) {
      if (!filterTags.some((tag) => note.tags.includes(tag))) {
        return false;
      }
    }

    return true;
  });

  // 创建新便签
  const handleCreateNote = async () => {
    setIsCreating(true);
    try {
      const newNote = await createNote({
        title: "新便签",
        content: "",
        isTodo: false,
        tags: [],
      });
      addNote(newNote);
      setSelectedNote(newNote);
    } catch (error) {
      console.error("Failed to create note:", error);
    } finally {
      setIsCreating(false);
    }
  };

  // 切换完成状态
  const handleToggleCompleted = async (note: Note, e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    try {
      const updated = await updateNote({
        id: note.id,
        isCompleted: !note.isCompleted,
      });
      updateNoteInStore(updated);
    } catch (error) {
      console.error("Failed to toggle completed:", error);
    }
  };

  // 删除便签
  const handleDelete = async (note: Note, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`确定要删除便签"${note.title}"吗？`)) {
      try {
        await deleteNote(note.id);
        removeNote(note.id);
      } catch (error) {
        console.error("Failed to delete note:", error);
      }
    }
  };

  // 点击便签
  const handleNoteClick = (note: Note) => {
    setSelectedNote(note);
  };

  return (
    <div className="p-6">
      {/* 所有便签 */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3 text-gray-700">
          📝 所有便签
        </h2>
        {filteredNotes.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            {searchQuery || filterTags.length > 0
              ? "没有找到匹配的便签"
              : "还没有便签，点击下方按钮创建"}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onClick={() => handleNoteClick(note)}
                onDelete={(e) => handleDelete(note, e)}
                onToggleCompleted={
                  note.isTodo ? (e) => handleToggleCompleted(note, e) : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* 新建按钮 */}
      <button
        onClick={handleCreateNote}
        disabled={isCreating}
        className="fixed bottom-8 right-8 bg-blue-500 hover:bg-blue-600 text-white rounded-full w-14 h-14 flex items-center justify-center text-3xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
        title="新建便签"
      >
        +
      </button>
    </div>
  );
}
