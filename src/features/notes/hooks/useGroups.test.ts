import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getAllGroups,
  createGroup,
  updateGroup,
  deleteGroup,
} from './useGroups'

vi.mock('@tauri-apps/api/core')

describe('useGroups API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAllGroups', () => {
    it('应该获取所有分组', async () => {
      const mockGroups = [
        {
          id: 'todo',
          name: '未完成',
          is_default: true,
          created_at: '2024-01-01',
        },
        {
          id: 'done',
          name: '已完成',
          is_default: true,
          created_at: '2024-01-01',
        },
      ]

      ;(invoke as any).mockResolvedValue(mockGroups)

      const result = await getAllGroups()

      expect(invoke).toHaveBeenCalledWith('get_all_groups')
      expect(result[0]).toHaveProperty('isDefault')
      expect(result[0]).toHaveProperty('createdAt')
    })
  })

  describe('createGroup', () => {
    it('应该创建新分组', async () => {
      const input = {
        name: '工作',
      }

      const mockResponse = {
        id: 'custom-1',
        name: '工作',
        is_default: false,
        created_at: '2024-01-01',
      }

      ;(invoke as any).mockResolvedValue(mockResponse)

      const result = await createGroup(input)

      expect(invoke).toHaveBeenCalledWith('create_group', {
        input: { name: '工作' },
      })
      expect(result.name).toBe('工作')
      expect(result).toHaveProperty('isDefault')
    })
  })

  describe('updateGroup', () => {
    it('应该更新分组', async () => {
      const input = {
        id: 'custom-1',
        name: '个人',
      }

      const mockResponse = {
        id: 'custom-1',
        name: '个人',
        is_default: false,
        created_at: '2024-01-01',
        updated_at: '2024-01-02',
      }

      ;(invoke as any).mockResolvedValue(mockResponse)

      const result = await updateGroup(input)

      expect(invoke).toHaveBeenCalledWith('update_group', {
        input: { id: 'custom-1', name: '个人' },
      })
      expect(result.name).toBe('个人')
    })
  })

  describe('deleteGroup', () => {
    it('应该删除分组', async () => {
      ;(invoke as any).mockResolvedValue(undefined)

      await deleteGroup('custom-1')

      expect(invoke).toHaveBeenCalledWith('delete_group', { id: 'custom-1' })
    })
  })
})
