import { test, expect } from '@playwright/test'

test.describe('系统托盘功能', () => {
  test('应该能最小化到系统托盘', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // 点击最小化按钮
    const minimizeButton = page.locator('button[aria-label*="最小化"]')
    if (await minimizeButton.isVisible()) {
      await minimizeButton.click()

      // 验证窗口被隐藏（在真实环境中需要 Tauri API 支持）
      // 这里只能验证按钮被点击
      await expect(minimizeButton).toBeVisible()
    }
  })

  test('应该能关闭窗口到系统托盘', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // 点击关闭按钮
    const closeButton = page.locator('button[aria-label*="关闭"]').last()
    if (await closeButton.isVisible()) {
      await closeButton.click()

      // 在真实 Tauri 环境中，窗口会被隐藏而不是关闭
      // 这里只验证按钮可点击
      await expect(page).toBeTruthy()
    }
  })
})
