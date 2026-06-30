import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getAllNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  searchNotes,
  getAllTags,
  toSnakeCase,
  toCamelCase,
} from './useNotes'

vi.mock('@tauri-apps/api/core')

describe('useNotes API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Case conversion utilities', () => {
    it('应该将 camelCase 转换为 snake_case', () => {
      const input = {
        firstName: 'John',
        lastName: 'Doe',
        createdAt: '2024-01-01',
      }

      const expected = {
        first_name: 'John',
        last_name: 'Doe',
        created_at: '2024-01-01',
      }

      expect(toSnakeCase(input)).toEqual(expected)
    })

    it('应该将 snake_case 转换为 camelCase', () => {
      const input = {
        first_name: 'John',
        last_name: 'Doe',
        created_at: '2024-01-01',
      }

      const expected = {
        firstName: 'John',
        lastName: 'Doe',
        createdAt: '2024-01-01',
      }

      expect(toCamelCase(input)).toEqual(expected)
    })

    it('应该处理嵌套对象', () => {
      const input = {
        user_info: {
          first_name: 'John',
          last_name: 'Doe',
        },
      }

      const expected = {
        userInfo: {
          firstName: 'John',
          lastName: 'Doe',
        },
      }

      expect(toCamelCase(input)).toEqual(expected)
    })

    it('应该处理数组', () => {
      const input = [
        { first_name: 'John' },
        { first_name: 'Jane' },
      ]

      const expected = [
        { firstName: 'John' },
        { firstName: 'Jane' },
      ]

      expect(toCamelCase(input)).toEqual(expected)
    })
  })

  describe('getAllNotes', () => {
    it('应该获取所有笔记', async () => {
      const mockNotes = [
        {
          id: '1',
          title: 'Test Note',
          content: 'Content',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ]

      ;(invoke as any).mockResolvedValue(mockNotes)

      const result = await getAllNotes()

      expect(invoke).toHaveBeenCalledWith('get_all_notes')
      expect(result[0]).toHaveProperty('createdAt')
      expect(result[0]).toHaveProperty('updatedAt')
    })
  })

  describe('getNoteById', () => {
    it('应该根据 ID 获取笔记', async () => {
      const mockNote = {
        id: '1',
        title: 'Test Note',
        content: 'Content',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      }

      ;(invoke as any).mockResolvedValue(mockNote)

      const result = await getNoteById('1')

      expect(invoke).toHaveBeenCalledWith('get_note_by_id', { id: '1' })
      expect(result).toHaveProperty('createdAt')
    })

    it('应该在笔记不存在时返回 null', async () => {
      ;(invoke as any).mockResolvedValue(null)

      const result = await getNoteById('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('createNote', () => {
    it('应该创建新笔记', async () => {
      const input = {
        title: 'New Note',
        content: 'Content',
        groupId: 'todo',
        isTodo: true,
        tags: [],
      }

      const mockResponse = {
        id: '1',
        title: 'New Note',
        content: 'Content',
        group_id: 'todo',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      }

      ;(invoke as any).mockResolvedValue(mockResponse)

      const result = await createNote(input)

      expect(invoke).toHaveBeenCalledWith('create_note', {
        input: expect.objectContaining({
          title: 'New Note',
          content: 'Content',
          group_id: 'todo',
        }),
      })
      expect(result).toHaveProperty('groupId')
      expect(result.groupId).toBe('todo')
    })
  })

  describe('updateNote', () => {
    it('应该更新笔记', async () => {
      const input = {
        id: '1',
        title: 'Updated Title',
      }

      const mockResponse = {
        id: '1',
        title: 'Updated Title',
        content: 'Content',
        created_at: '2024-01-01',
        updated_at: '2024-01-02',
      }

      ;(invoke as any).mockResolvedValue(mockResponse)

      const result = await updateNote(input)

      expect(invoke).toHaveBeenCalledWith('update_note', {
        input: expect.objectContaining({ id: '1', title: 'Updated Title' }),
      })
      expect(result.title).toBe('Updated Title')
    })
  })

  describe('deleteNote', () => {
    it('应该删除笔记', async () => {
      ;(invoke as any).mockResolvedValue(undefined)

      await deleteNote('1')

      expect(invoke).toHaveBeenCalledWith('delete_note', { id: '1' })
    })
  })

  describe('searchNotes', () => {
    it('应该搜索笔记', async () => {
      const mockResults = [
        {
          id: '1',
          title: 'Found Note',
          content: 'Search content',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ]

      ;(invoke as any).mockResolvedValue(mockResults)

      const result = await searchNotes('search query')

      expect(invoke).toHaveBeenCalledWith('search_notes', { query: 'search query' })
      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('createdAt')
    })
  })

  describe('getAllTags', () => {
    it('应该获取所有标签', async () => {
      const mockTags = [
        { id: '1', name: 'work' },
        { id: '2', name: 'personal' },
      ]

      ;(invoke as any).mockResolvedValue(mockTags)

      const result = await getAllTags()

      expect(invoke).toHaveBeenCalledWith('get_all_tags')
      expect(result).toEqual(mockTags)
    })
  })
})
