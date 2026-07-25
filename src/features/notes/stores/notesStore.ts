import { create } from "zustand";
import type { Note } from "../types";

interface NotesState {
  notes: Note[];
  selectedNote: Note | null;
  searchQuery: string;
  filterTags: string[];
  loading: boolean;

  // Actions
  setNotes: (notes: Note[]) => void;
  addNote: (note: Note) => void;
  updateNoteInStore: (note: Note) => void;
  removeNote: (id: string) => void;
  setSelectedNote: (note: Note | null) => void;
  setSearchQuery: (query: string) => void;
  setFilterTags: (tags: string[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useNotesStore = create<NotesState>((set) => ({
  notes: [],
  selectedNote: null,
  searchQuery: "",
  filterTags: [],
  loading: false,

  setNotes: (notes) =>
    set((state) => ({
      notes,
      selectedNote: state.selectedNote
        ? notes.find((note) => note.id === state.selectedNote?.id) ?? null
        : null,
    })),

  addNote: (note) =>
    set((state) => ({
      // IPC retries and sync refreshes may deliver the same object more than
      // once. Keep a single canonical row by ID instead of rendering ghosts.
      notes: [
        state.notes.find(
          (existing) => existing.id === note.id && existing.updatedAt > note.updatedAt,
        ) ?? note,
        ...state.notes.filter((existing) => existing.id !== note.id),
      ],
    })),

  updateNoteInStore: (note) =>
    set((state) => {
      const current = state.notes.find((item) => item.id === note.id);
      // A slower IPC response or a stale sync refresh must never put an older
      // revision back into the editor after a newer one has been rendered.
      if (current && current.updatedAt > note.updatedAt) return state;
      return {
        notes: state.notes.map((n) => (n.id === note.id ? note : n)),
        selectedNote: state.selectedNote?.id === note.id ? note : state.selectedNote,
      };
    }),

  removeNote: (id) =>
    set((state) => ({
      notes: state.notes.filter((n) => n.id !== id),
      selectedNote: state.selectedNote?.id === id ? null : state.selectedNote,
    })),

  setSelectedNote: (note) => set({ selectedNote: note }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setFilterTags: (tags) => set({ filterTags: tags }),

  setLoading: (loading) => set({ loading }),
}));
