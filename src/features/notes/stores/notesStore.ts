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

  setNotes: (notes) => set({ notes }),

  addNote: (note) =>
    set((state) => ({ notes: [note, ...state.notes] })),

  updateNoteInStore: (note) =>
    set((state) => ({
      notes: state.notes.map((n) => (n.id === note.id ? note : n)),
      selectedNote: state.selectedNote?.id === note.id ? note : state.selectedNote,
    })),

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
