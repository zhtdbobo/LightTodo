import { useRef, useState } from "react";
import { useNotesStore } from "../stores/notesStore";
import { getAllNotes, searchNotes } from "../hooks/useNotes";

export function SearchBar() {
  const { setNotes, setSearchQuery, searchQuery } = useNotesStore();
  const [isSearching, setIsSearching] = useState(false);
  const requestRef = useRef(0);

  const handleSearch = async (query: string) => {
    const requestId = ++requestRef.current;
    setSearchQuery(query);

    if (!query.trim()) {
      // 清空搜索时重新加载所有便签
      setIsSearching(false);
      try {
        const results = await getAllNotes();
        if (requestId === requestRef.current) setNotes(results);
      } catch (error) {
        console.error("Failed to reload notes:", error);
      }
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchNotes(query);
      if (requestId === requestRef.current) setNotes(results);
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      if (requestId === requestRef.current) setIsSearching(false);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="搜索便签..."
        className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
      />
      <span className="absolute left-3 top-2.5 text-gray-400">
        {isSearching ? "⏳" : "🔍"}
      </span>
    </div>
  );
}
