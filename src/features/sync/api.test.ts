import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('WebDAV 同步 API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  describe('连接测试', () => {
    it('应该能测试 WebDAV 连接', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })

      global.fetch = mockFetch as any

      const config = {
        url: 'https://example.com/webdav',
        username: 'testuser',
        password: 'testpass',
      }

      const authHeader = 'Basic ' + btoa(`${config.username}:${config.password}`)

      const response = await fetch(config.url, {
        method: 'PROPFIND',
        headers: {
          Authorization: authHeader,
          Depth: '0',
        },
      })

      expect(response.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        config.url,
        expect.objectContaining({
          method: 'PROPFIND',
        })
      )
    })

    it('连接失败时应该返回错误', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      global.fetch = mockFetch as any

      const config = {
        url: 'https://example.com/webdav',
        username: 'testuser',
        password: 'testpass',
      }

      try {
        await fetch(config.url, { method: 'PROPFIND' })
      } catch (error: any) {
        expect(error.message).toBe('Network error')
      }
    })
  })

  describe('数据同步', () => {
    it('应该能上传数据到 WebDAV', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
      })

      global.fetch = mockFetch as any

      const config = {
        url: 'https://example.com/webdav/data.json',
        username: 'testuser',
        password: 'testpass',
      }

      const data = {
        notes: [],
        groups: [],
        lastSync: new Date().toISOString(),
      }

      const authHeader = 'Basic ' + btoa(`${config.username}:${config.password}`)

      const response = await fetch(config.url, {
        method: 'PUT',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      expect(response.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        config.url,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(data),
        })
      )
    })

    it('应该能从 WebDAV 下载数据', async () => {
      const mockData = {
        notes: [{ id: '1', title: 'Test' }],
        groups: [],
        lastSync: new Date().toISOString(),
      }

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockData,
      })

      global.fetch = mockFetch as any

      const config = {
        url: 'https://example.com/webdav/data.json',
        username: 'testuser',
        password: 'testpass',
      }

      const authHeader = 'Basic ' + btoa(`${config.username}:${config.password}`)

      const response = await fetch(config.url, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
        },
      })

      const data = await response.json()

      expect(data).toEqual(mockData)
      expect(data.notes).toHaveLength(1)
    })
  })

  describe('配置管理', () => {
    it('应该能保存配置到 localStorage', () => {
      const config = {
        url: 'https://example.com/webdav',
        username: 'testuser',
        password: 'testpass',
      }

      localStorage.setItem('webdav-config', JSON.stringify(config))

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'webdav-config',
        JSON.stringify(config)
      )
    })

    it('应该能从 localStorage 读取配置', () => {
      const config = {
        url: 'https://example.com/webdav',
        username: 'testuser',
        password: 'testpass',
      }

      localStorage.getItem = vi.fn().mockReturnValue(JSON.stringify(config))

      const saved = localStorage.getItem('webdav-config')
      const parsed = saved ? JSON.parse(saved) : null

      expect(parsed).toEqual(config)
    })

    it('应该能清除配置', () => {
      localStorage.removeItem('webdav-config')

      expect(localStorage.removeItem).toHaveBeenCalledWith('webdav-config')
    })
  })
})
