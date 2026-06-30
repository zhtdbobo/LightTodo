import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useNotesStore } from './notesStore'

describe('useNotesStore', () => {
  beforeEach(() => {
    // 重置 store 状态
    const { setNotes, setSelectedNote, setSearchQuery, setFilterTags, setLoading } = useNotesStore.getState()
    setNotes([])
    setSelectedNote(null)
    setSearchQuery('')
    setFilterTags([])
    setLoading(false)
  })

  it('应该初始化为空状态', () => {
    const { result } = renderHook(() => useNotesStore())

    expect(result.current.notes).toEqual([])
    expect(result.current.selectedNote).toBeNull()
    expect(result.current.searchQuery).toBe('')
    expect(result.current.filterTags).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('应该能设置笔记列表', () => {
    const { result } = renderHook(() => useNotesStore())

    const mockNotes = [
      {
        id: '1',
        title: '测试笔记',
        content: '内容',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: [],
        groupId: 'todo',
        isTodo: true,
        isCompleted: false,
        pinned: false,
        priority: 0,
      },
    ]

    act(() => {
      result.current.setNotes(mockNotes)
    })

    expect(result.current.notes).toEqual(mockNotes)
  })

  it('应该能添加笔记', () => {
    const { result } = renderHook(() => useNotesStore())

    const newNote = {
      id: '1',
      title: '新笔记',
      content: '内容',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
      groupId: 'todo',
      isTodo: true,
      isCompleted: false,
      pinned: false,
      priority: 0,
    }

    act(() => {
      result.current.addNote(newNote)
    })

    expect(result.current.notes).toHaveLength(1)
    expect(result.current.notes[0]).toEqual(newNote)
  })

  it('应该能更新笔记', () => {
    const { result } = renderHook(() => useNotesStore())

    const note = {
      id: '1',
      title: '原始标题',
      content: '内容',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
      groupId: 'todo',
      isTodo: true,
      isCompleted: false,
      pinned: false,
      priority: 0,
    }

    act(() => {
      result.current.addNote(note)
    })

    const updatedNote = { ...note, title: '更新后的标题' }

    act(() => {
      result.current.updateNoteInStore(updatedNote)
    })

    expect(result.current.notes[0].title).toBe('更新后的标题')
  })

  it('应该能删除笔记', () => {
    const { result } = renderHook(() => useNotesStore())

    const note = {
      id: '1',
      title: '测试笔记',
      content: '内容',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
      groupId: 'todo',
      isTodo: true,
      isCompleted: false,
      pinned: false,
      priority: 0,
    }

    act(() => {
      result.current.addNote(note)
    })

    expect(result.current.notes).toHaveLength(1)

    act(() => {
      result.current.removeNote('1')
    })

    expect(result.current.notes).toHaveLength(0)
  })

  it('应该能设置选中的笔记', () => {
    const { result } = renderHook(() => useNotesStore())

    const note = {
      id: '1',
      title: '测试笔记',
      content: '内容',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
      groupId: 'todo',
      isTodo: true,
      isCompleted: false,
      pinned: false,
      priority: 0,
    }

    act(() => {
      result.current.setSelectedNote(note)
    })

    expect(result.current.selectedNote).toEqual(note)
  })

  it('删除笔记时应该清除选中状态', () => {
    const { result } = renderHook(() => useNotesStore())

    const note = {
      id: '1',
      title: '测试笔记',
      content: '内容',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
      groupId: 'todo',
      isTodo: true,
      isCompleted: false,
      pinned: false,
      priority: 0,
    }

    act(() => {
      result.current.addNote(note)
      result.current.setSelectedNote(note)
    })

    expect(result.current.selectedNote).toEqual(note)

    act(() => {
      result.current.removeNote('1')
    })

    expect(result.current.selectedNote).toBeNull()
  })

  it('应该能设置搜索查询', () => {
    const { result } = renderHook(() => useNotesStore())

    act(() => {
      result.current.setSearchQuery('测试')
    })

    expect(result.current.searchQuery).toBe('测试')
  })

  it('应该能设置筛选标签', () => {
    const { result } = renderHook(() => useNotesStore())

    act(() => {
      result.current.setFilterTags(['工作', '重要'])
    })

    expect(result.current.filterTags).toEqual(['工作', '重要'])
  })

  it('应该能设置加载状态', () => {
    const { result } = renderHook(() => useNotesStore())

    act(() => {
      result.current.setLoading(true)
    })

    expect(result.current.loading).toBe(true)

    act(() => {
      result.current.setLoading(false)
    })

    expect(result.current.loading).toBe(false)
  })
})
